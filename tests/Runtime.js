var state = null

function check(value, message) {
    if (!value)
        throw new Error(message)
}

function install(panel) {
    panel.close()
    // Keep the native window hidden so user focus changes cannot dismiss the
    // timeout test. Only the test copy exposes this alias; controller state,
    // request callbacks and timers are the production implementation.
    panel.testWindow.open = false
    state = { panel: panel, originalFactory: panel.createRequest, settings: panel.settings, requests: [] }
    panel.createRequest = function() {
        var request = {
            readyState: 0, status: 0, responseText: "", aborted: false,
            open: function(method, url) { this.url = url },
            send: function() {},
            abort: function() { this.aborted = true },
            finish: function(status, body) {
                this.status = status
                this.responseText = body
                this.readyState = XMLHttpRequest.DONE
                this.onreadystatechange()
            }
        }
        state.requests.push(request)
        return request
    }
    panel.settings = { station: { id: "de:09162:2", name: "Test", place: "München" }, transportTypes: [] }
    panel.lastDepartureRequestAt = 0
    panel.nextDepartureRequestAt = 0
}

function restore() {
    var panel = state.panel
    panel.close()
    panel.createRequest = state.originalFactory
    panel.settings = state.settings
    state = null
}

function run(panel) {
    install(panel)
    var passed = []
    try {
        panel.search("Test")
        check(state.requests.length === 0, "closed search made a request")
        panel.open()
        var old = state.requests[state.requests.length - 1]
        panel.close()
        check(old.aborted && !panel.loading, "close did not abort and reset")
        old.finish(200, "[]")
        check(!panel.lastUpdatedAt, "late closed response changed state")
        passed.push("close aborts and ignores late responses")

        panel.lastDepartureRequestAt = 0
        panel.open()
        old = state.requests[state.requests.length - 1]
        panel.settings = { station: { id: "de:09162:6", name: "Other", place: "München" }, transportTypes: [] }
        check(old.aborted && panel.departures.length === 0, "station change retained request or data")
        var current = state.requests[state.requests.length - 1]
        old.finish(200, '[{"plannedDepartureTime":' + (Date.now() + 60000)
            + ',"label":"OLD","destination":"Old","transportType":"BUS"}]')
        check(panel.departures.length === 0, "old station response was accepted")
        current.finish(200, '[{"plannedDepartureTime":' + (Date.now() + 60000)
            + ',"label":"TEST","destination":"Test destination","transportType":"BUS"}]')
        check(panel.visibleRows.length === 1 && panel.visibleRows[0].line === "TEST", "current response missing")
        passed.push("station change rejects outdated response")

        var count = state.requests.length
        panel.refresh()
        check(state.requests.length === count, "refresh throttle was bypassed")
        panel.lastDepartureRequestAt = 0
        panel.refresh()
        current = state.requests[state.requests.length - 1]
        current.finish(503, "")
        check(panel.visibleRows.length === 1 && panel.departureError !== "", "failure lost stale board")
        count = state.requests.length
        panel.refresh()
        check(state.requests.length === count && panel.nextDepartureRequestAt > Date.now(), "backoff was bypassed")
        panel.settings = { station: { id: "de:09162:7", name: "New", place: "München" }, transportTypes: [] }
        check(panel.failureBackoffMs === 60000 && panel.departureError === "", "station change did not reset backoff")
        current = state.requests[state.requests.length - 1]
        current.finish(200, "[]")
        check(!panel.loading && panel.visibleRows.length === 0, "empty response did not recover")
        passed.push("throttle, stale failure, backoff reset and recovery")
        return JSON.stringify({ passed: passed })
    } finally {
        restore()
    }
}

function timeoutStart(panel) {
    install(panel)
    panel.open()
    return "timeout request started"
}

function timeoutFinish() {
    var panel = state.panel
    try {
        check(state.requests[0].aborted && !panel.loading && panel.departureError !== "",
            "timeout did not abort and expose failure")
        panel.lastDepartureRequestAt = 0
        panel.nextDepartureRequestAt = 0
        panel.refresh()
        state.requests[state.requests.length - 1].finish(200, "[]")
        check(!panel.departureError && !panel.loading, "timeout recovery failed")
        return "timeout and recovery passed"
    } finally {
        restore()
    }
}
