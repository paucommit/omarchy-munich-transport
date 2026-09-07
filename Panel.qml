import QtQuick
import Quickshell
import qs.Commons
import qs.Ui as Ui
import "Model.js" as Model

Ui.Panel {
  id: root
  moduleName: "paucommit.munichtransport"
  ipcTarget: moduleName
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root
  property var station: null
  property var searchResults: []
  property var departures: []
  property var searchRequest: null
  property var departureRequest: null
  property int searchGeneration: 0
  property int departureGeneration: 0
  property double nowMs: Date.now()
  property double lastDepartureRequestAt: 0
  property double nextDepartureRequestAt: 0
  property double lastUpdatedAt: 0
  property int failureBackoffMs: 60000
  property string searchError: ""
  property string departureError: ""
  property bool searching: false
  property bool loading: false
  property bool saving: false
  property string appliedTransportTypesKey: ""
  property var transportTypes: []
  readonly property var visibleRows: Model.visibleDepartures(departures, nowMs, transportTypes, 8)

  function validStation(value) {
    return value && String(value.id || "") !== "" && String(value.name || "") !== ""
  }
  property var createRequest: function() { return new XMLHttpRequest() }
  function syncSettings() {
    var beforeId = station ? String(station.id) : ""
    var modes = setting("transportTypes", [])
    if (!Array.isArray(modes)) modes = []
    var modeKey = JSON.stringify(modes)
    var modesChanged = appliedTransportTypesKey !== "" && appliedTransportTypesKey !== modeKey
    if (appliedTransportTypesKey !== modeKey) transportTypes = modes
    appliedTransportTypesKey = modeKey
    loadSetting()
    if (!modesChanged || !station || String(station.id) !== beforeId) return
    stopRequests()
    departures = []
    lastUpdatedAt = 0
    lastDepartureRequestAt = 0
    nextDepartureRequestAt = 0
    departureError = ""
    failureBackoffMs = 60000
    if (opened) refresh()
  }
  function loadSetting() {
    var configured = setting("station", null)
    if (!validStation(configured)) {
      if (station) stopRequests()
      station = null; departures = []
      departureError = ""; failureBackoffMs = 60000
      return
    }
    if (!station || station.id !== configured.id) {
      stopRequests()
      station = configured
      departures = []
      lastUpdatedAt = 0
      lastDepartureRequestAt = 0
      nextDepartureRequestAt = 0
      departureError = ""
      failureBackoffMs = 60000
      if (opened) refresh()
    } else station = configured
  }
  function open() {
    nowMs = Date.now()
    controller.show()
    loadSetting()
    if (station) refresh()
    else Qt.callLater(function() { searchField.forceActiveFocus() })
  }
  function close() {
    controller.hide()
    stopRequests()
    retryTimer.stop()
  }
  function toggle() { opened ? close() : open() }
  function closeForPopoutSwitch() {
    popoutSwitchClosing = true
    close()
    Qt.callLater(function() { popoutSwitchClosing = false })
  }
  function switchPanel(direction) {
    if (bar && typeof bar.switchPanelFrom === "function")
      return bar.switchPanelFrom(barIdentity, direction)
    return false
  }
  function stopRequests() {
    searchGeneration++
    departureGeneration++
    if (searchRequest) searchRequest.abort()
    if (departureRequest) departureRequest.abort()
    searchRequest = null
    departureRequest = null
    searching = false
    loading = false
    searchTimeout.stop()
    departureTimeout.stop()
    refreshThrottle.stop()
  }
  function search(query) {
    var text = query === undefined ? searchField.text.trim() : String(query).trim()
    if (!opened || !text || searchRequest) return
    searchError = ""
    searching = true
    searchResults = []
    var generation = ++searchGeneration
    var request = null
    try { request = createRequest() }
    catch (error) { searching = false; searchError = "Station search failed"; return }
    searchRequest = request
    searchTimeout.restart()
    request.onreadystatechange = function() {
      if (request.readyState !== XMLHttpRequest.DONE) return
      if (generation !== searchGeneration || request !== searchRequest) return
      searchTimeout.stop(); searchRequest = null; searching = false
      if (!opened) return
      try {
        if (request.status < 200 || request.status >= 300) throw new Error("HTTP " + request.status)
        searchResults = Model.parseStations(request.responseText)
        if (!searchResults.length) searchError = "No stations found"
      } catch (error) { searchError = "Station search failed" }
    }
    try {
      request.open("GET", Model.searchUrl(text))
      request.send()
    } catch (error) {
      if (generation !== searchGeneration) return
      searchTimeout.stop(); searchRequest = null; searching = false
      searchError = "Station search failed"
    }
  }
  function selectStation(selected) {
    if (!validStation(selected) || saving) return
    saving = true
    searchError = ""
    saveTimeout.restart()
    Quickshell.execDetached(Model.saveStationCommand(moduleName, selected))
  }
  function changeStation() {
    stopRequests()
    station = null
    departures = []
    departureError = ""
    failureBackoffMs = 60000
    searchResults = []
    Qt.callLater(function() { searchField.text = ""; searchField.forceActiveFocus() })
  }
  function refresh() {
    if (!opened || !station || departureRequest) return
    var wait = Math.max(nextDepartureRequestAt, lastDepartureRequestAt + 10000) - Date.now()
    if (wait > 0) { refreshThrottle.interval = Math.ceil(wait); refreshThrottle.restart(); return }
    refreshThrottle.stop()
    lastDepartureRequestAt = Date.now()
    loading = true
    var selectedId = String(station.id)
    var generation = ++departureGeneration
    var request = null
    try { request = createRequest() }
    catch (error) { loading = false; departureFailed(); return }
    departureRequest = request
    departureTimeout.restart()
    request.onreadystatechange = function() {
      if (request.readyState !== XMLHttpRequest.DONE) return
      if (generation !== departureGeneration || request !== departureRequest) return
      departureTimeout.stop(); departureRequest = null; loading = false
      if (!opened || !station || String(station.id) !== selectedId) return
      try {
        if (request.status < 200 || request.status >= 300) throw new Error("HTTP " + request.status)
        departures = Model.parseDepartures(request.responseText)
        departureError = ""
        lastUpdatedAt = Date.now(); nextDepartureRequestAt = 0
        failureBackoffMs = 60000; retryTimer.stop()
      } catch (error) { departureFailed() }
    }
    try {
      request.open("GET", Model.departuresUrl(selectedId, transportTypes))
      request.send()
    } catch (error) {
      if (generation !== departureGeneration) return
      departureTimeout.stop(); departureRequest = null; loading = false
      departureFailed()
    }
  }
  function departureFailed() {
    departureError = "Could not refresh departures"
    if (opened) {
      nextDepartureRequestAt = Date.now() + failureBackoffMs
      retryTimer.interval = failureBackoffMs
      retryTimer.restart()
      failureBackoffMs = Math.min(300000, failureBackoffMs * 2)
    }
  }
  function ageLabel() {
    if (!lastUpdatedAt) return ""
    var minutes = Math.max(0, Math.floor((nowMs - lastUpdatedAt) / 60000))
    return minutes === 0 ? "updated just now" : "updated " + minutes + " min ago"
  }

  onSettingsChanged: syncSettings()
  Component.onCompleted: syncSettings()

  Timer { id: clockTimer; interval: 1000; repeat: true; running: root.opened; onTriggered: root.nowMs = Date.now() }
  Timer { id: pollTimer; interval: 60000; repeat: true; running: root.opened && !!root.station; onTriggered: root.refresh() }
  Timer { id: retryTimer; onTriggered: root.refresh() }
  Timer { id: refreshThrottle; onTriggered: root.refresh() }
  Timer {
    id: saveTimeout; interval: 9500
    onTriggered: {
      root.saving = false
      root.searchError = "Could not save station"
    }
  }
  Timer {
    id: searchTimeout; interval: 12000
    onTriggered: {
      var request = root.searchRequest
      root.searchGeneration++; root.searchRequest = null; root.searching = false
      if (request) request.abort()
      if (root.opened) root.searchError = "Station search timed out"
    }
  }
  Timer {
    id: departureTimeout; interval: 12000
    onTriggered: {
      var request = root.departureRequest
      root.departureGeneration++; root.departureRequest = null; root.loading = false
      if (request) request.abort()
      if (root.opened) root.departureFailed()
    }
  }

  Ui.KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: true
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(440))
    contentHeight: panel.fittedContentHeight(contentColumn.implicitHeight, Style.space(620))

    Item {
      id: keyCatcher
      anchors.fill: parent
      focus: true
      Keys.priority: Keys.BeforeItem
      Keys.onEscapePressed: root.close()

      Flickable {
        anchors.fill: parent
        contentWidth: width
        contentHeight: contentColumn.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        Column {
          id: contentColumn
          width: parent.width
          spacing: Style.space(10)

          Row {
            width: parent.width
            spacing: Style.space(8)
            Text {
              width: parent.width - actions.width - parent.spacing
              text: root.station ? Model.stationLabel(root.station) : "Munich transport"
              textFormat: Text.PlainText; elide: Text.ElideRight
              color: root.barForeground; font.family: Style.font.family
              font.pixelSize: Style.font.title; font.bold: true
            }
            Row {
              id: actions; spacing: Style.space(4)
              Ui.PanelActionButton { iconText: "󰑐"; tooltipText: "Refresh"; focusable: true; enabled: !!root.station && !root.loading; onClicked: root.refresh() }
              Ui.PanelActionButton { iconText: "󰏫"; tooltipText: "Change station"; focusable: true; visible: !!root.station; onClicked: root.changeStation() }
            }
          }

          Column {
            visible: !root.station
            width: parent.width
            spacing: Style.space(8)
            Row {
              width: parent.width; spacing: Style.space(8)
              Ui.TextField {
                id: searchField
                width: parent.width - searchButton.width - parent.spacing
                placeholderText: "Search for a station"
                enabled: !root.searching && !root.saving
                onAccepted: root.search()
                Keys.onEscapePressed: root.close()
              }
              Ui.Button { id: searchButton; text: root.searching ? "Searching…" : "Search"; focusable: true; enabled: searchField.text.trim() !== "" && !root.searching; onClicked: root.search() }
            }
            Text { visible: root.searchError !== ""; text: root.searchError; color: Color.urgent; font.family: Style.font.family; font.pixelSize: Style.font.body }
            Repeater {
              model: root.searchResults
              Ui.Button {
                required property var modelData
                width: contentColumn.width
                height: Style.space(34)
                leftAlign: true; bordered: true; focusable: true
                enabled: !root.saving
                onClicked: root.selectStation(modelData)
                Text {
                  anchors.left: parent.left
                  anchors.leftMargin: Style.spacing.controlPaddingX
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  text: Model.stationLabel(parent.modelData)
                  textFormat: Text.PlainText
                  elide: Text.ElideRight
                  color: root.barForeground
                  font.family: Style.font.family
                  font.pixelSize: Style.font.body
                }
              }
            }
          }

          Text {
            visible: !!root.station && root.loading && !root.departures.length
            text: "Loading departures…"; color: root.barForeground
            font.family: Style.font.family; font.pixelSize: Style.font.body
          }
          Text {
            visible: !!root.station && root.departureError !== ""
            text: root.departureError + (root.departures.length ? " · showing stale data, " + root.ageLabel() : "")
            color: Color.urgent; font.family: Style.font.family; font.pixelSize: Style.font.caption
          }
          Text {
            visible: !!root.station && !root.loading && !root.departureError && !root.visibleRows.length
            text: "No upcoming departures"; color: root.barForeground
            font.family: Style.font.family; font.pixelSize: Style.font.body
          }
          Repeater {
            model: root.visibleRows
            Item {
              required property var modelData
              width: contentColumn.width; height: Style.space(42)
              Row {
                anchors.fill: parent; spacing: Style.space(10)
                Text { width: Style.space(48); text: modelData.line || "—"; textFormat: Text.PlainText; elide: Text.ElideRight; color: root.barForeground; font.family: Style.font.family; font.pixelSize: Style.font.title; font.bold: true }
                Column {
                  width: parent.width - Style.space(48) - countdown.width - parent.spacing * 2
                  Text { width: parent.width; text: modelData.destination || "Unknown destination"; textFormat: Text.PlainText; elide: Text.ElideRight; color: root.barForeground; font.family: Style.font.family; font.pixelSize: Style.font.body }
                  Text {
                    width: parent.width; elide: Text.ElideRight
                    text: (modelData.platform ? "Platform " + modelData.platform : "No platform")
                      + (modelData.platformChanged ? " · changed" : "")
                      + (modelData.cancelled ? " · cancelled" : (modelData.realtime ? " · live" : " · scheduled"))
                      + (modelData.delay > 0 ? " · +" + modelData.delay + " min" : "")
                    textFormat: Text.PlainText; color: modelData.cancelled ? Color.urgent : Qt.darker(root.barForeground, 1.4)
                    font.family: Style.font.family; font.pixelSize: Style.font.caption
                  }
                }
                Text { id: countdown; text: Model.departureLabel(modelData, root.nowMs); textFormat: Text.PlainText; color: modelData.cancelled ? Color.urgent : root.barForeground; font.family: Style.font.family; font.pixelSize: Style.font.title; font.bold: true }
              }
            }
          }
          Text { visible: !!root.station && root.lastUpdatedAt > 0 && root.departureError === ""; text: root.ageLabel(); color: Qt.darker(root.barForeground, 1.4); font.family: Style.font.family; font.pixelSize: Style.font.caption }
        }
      }
    }
  }
}
