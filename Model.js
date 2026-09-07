var API_ROOT = "https://www.mvg.de/api/bgw-pt/v3/"
var TRANSPORT_TYPES = ["BAHN", "SBAHN", "UBAHN", "TRAM", "BUS", "REGIONAL_BUS", "RUFTAXI"]

// Saving rebuilds the widget. A bounded detached command survives that rebuild
// and retries the public summon operation while the replacement loads. User
// data is passed only as positional arguments, never as shell source.
function saveStationCommand(pluginId, station) {
    var script = 'result=$(omarchy-shell shell setBarWidget "$1" station "$2" \'{}\') || exit 1\n'
        + '[ "$result" = ok ] || exit 1\n'
        + 'for pause in 0.2 0.4 0.8 1.6; do\n'
        + '  sleep "$pause"\n'
        + '  result=$(omarchy-shell shell summon "$1") && [ "$result" = ok ] && exit 0\n'
        + 'done\nexit 1'
    return ["timeout", "--kill-after=1s", "8s", "sh", "-c", script,
        "munich-transport-save", pluginId, JSON.stringify(station)]
}

function requireString(value, field, allowEmpty) {
    if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0))
        throw new Error("Invalid " + field)
    return value
}

function optionalString(value, field) {
    if (value === undefined || value === null)
        return ""
    return requireString(value, field, true)
}

function displayString(value) {
    if (typeof value === "string")
        return value
    if (typeof value === "number" && isFinite(value))
        return String(value)
    return ""
}

function requireNumber(value, field) {
    if (typeof value !== "number" || !isFinite(value))
        throw new Error("Invalid " + field)
    return value
}

function payload(raw) {
    var value = raw
    if (typeof raw === "string") {
        try {
            value = JSON.parse(raw)
        } catch (error) {
            throw new Error("Malformed JSON payload")
        }
    }
    if (!Array.isArray(value))
        throw new Error("Expected an array payload")
    return value
}

function validateStationId(stationId) {
    requireString(stationId, "station ID", false)
    if (!/^de:\d+:\d+$/.test(stationId))
        throw new Error("Invalid station ID")
    return stationId
}

function validateModes(modes) {
    if (modes === undefined || modes === null || (Array.isArray(modes) && modes.length === 0))
        return null
    if (!Array.isArray(modes))
        throw new Error("Invalid transport modes")

    var seen = {}
    var result = []
    for (var i = 0; i < modes.length; ++i) {
        var mode = requireString(modes[i], "transport mode", false)
        if (TRANSPORT_TYPES.indexOf(mode) === -1)
            throw new Error("Unsupported transport mode: " + mode)
        if (!seen[mode]) {
            seen[mode] = true
            result.push(mode)
        }
    }
    return result
}

function searchUrl(query) {
    var value = requireString(query, "search query", false).trim()
    return API_ROOT + "locations?query=" + encodeURIComponent(value) + "&locationTypes=STATION"
}

function departuresUrl(stationId, modes) {
    var id = validateStationId(stationId)
    var types = validateModes(modes)
    var url = API_ROOT + "departures?globalId=" + encodeURIComponent(id)
        + "&limit=40&offsetInMinutes=0"
    if (types)
        url += "&transportTypes=" + encodeURIComponent(types.join(","))
    return url
}

function stationLabel(station) {
    if (!station || typeof station !== "object" || Array.isArray(station))
        throw new Error("Invalid station")
    var name = requireString(station.name, "station name", false)
    var place = optionalString(station.place, "station place").trim()
    return place ? name + ", " + place : name
}

function parseStations(raw) {
    var rows = payload(raw)
    var result = []
    var stationCandidates = 0
    for (var i = 0; i < rows.length; ++i) {
        var row = rows[i]
        if (!row || typeof row !== "object" || Array.isArray(row) || row.type !== "STATION")
            continue
        stationCandidates += 1
        try {
            var station = {
                id: validateStationId(row.globalId),
                name: requireString(row.name, "station name", false),
                place: typeof row.place === "string" ? row.place : ""
            }
            station.label = stationLabel(station)
            result.push(station)
        } catch (error) {
            // A bad search candidate must not hide usable stations.
        }
    }
    if (stationCandidates > 0 && result.length === 0)
        throw new Error("Station payload contains no valid stations")
    return result
}

function parseDepartures(raw) {
    var rows = payload(raw)
    var result = []
    for (var i = 0; i < rows.length; ++i) {
        var row = rows[i]
        try {
            if (!row || typeof row !== "object" || Array.isArray(row))
                throw new Error("Invalid departure")
            var plannedTime = requireNumber(row.plannedDepartureTime, "planned departure time")
            var estimateValid = typeof row.realtimeDepartureTime === "number"
                && isFinite(row.realtimeDepartureTime)
            var realtime = row.realtime === true && estimateValid
            var type = requireString(row.transportType, "transport type", false)
            var platform = displayString(row.platform)
            var plannedPlatform = displayString(row.plannedPlatform)
            var changed = typeof row.platformChanged === "boolean" ? row.platformChanged
                : !!platform && !!plannedPlatform && platform !== plannedPlatform

            result.push({
                time: realtime ? row.realtimeDepartureTime : plannedTime,
                plannedTime: plannedTime,
                realtime: realtime,
                delay: realtime && typeof row.delayInMinutes === "number" && isFinite(row.delayInMinutes)
                    ? row.delayInMinutes : 0,
                line: requireString(row.label, "line", false),
                destination: requireString(row.destination, "destination", false),
                platform: platform,
                platformChanged: changed,
                cancelled: row.cancelled === true,
                type: type
            })
        } catch (error) {
            // Skip a corrupt record while retaining the rest of the board.
        }
    }
    if (rows.length > 0 && result.length === 0)
        throw new Error("Departure payload contains no valid departures")
    return result
}

function visibleDepartures(rows, now, modes, limit) {
    if (!Array.isArray(rows))
        throw new Error("Invalid departures")
    var currentTime = requireNumber(now, "current time")
    var types = validateModes(modes)
    var maximum = limit === undefined ? 8 : limit
    if (typeof maximum !== "number" || !isFinite(maximum) || maximum < 0 || Math.floor(maximum) !== maximum)
        throw new Error("Invalid departure limit")

    var visible = []
    for (var i = 0; i < rows.length; ++i) {
        var row = rows[i]
        if (!row || typeof row !== "object" || typeof row.time !== "number" || !isFinite(row.time)
                || typeof row.type !== "string")
            throw new Error("Invalid normalized departure at index " + i)
        if (row.time >= currentTime && (!types || types.indexOf(row.type) !== -1))
            visible.push(row)
    }
    visible.sort(function(a, b) { return a.time - b.time })
    return visible.slice(0, maximum)
}

function departureLabel(row, now) {
    if (!row || typeof row !== "object")
        throw new Error("Invalid departure")
    if (row.cancelled === true)
        return "Cancelled"
    var difference = requireNumber(row.time, "departure time") - requireNumber(now, "current time")
    var minutes = Math.ceil(difference / 60000)
    return minutes <= 0 ? "Due" : minutes + " min"
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        saveStationCommand: saveStationCommand,
        TRANSPORT_TYPES: TRANSPORT_TYPES,
        searchUrl: searchUrl,
        departuresUrl: departuresUrl,
        parseStations: parseStations,
        parseDepartures: parseDepartures,
        visibleDepartures: visibleDepartures,
        departureLabel: departureLabel,
        stationLabel: stationLabel
    }
}
