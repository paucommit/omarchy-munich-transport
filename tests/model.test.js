const test = require("node:test")
const assert = require("node:assert/strict")
const Model = require("../Model.js")

const minute = 60_000
const now = Date.UTC(2026, 8, 7, 10, 0, 0)

function departure(overrides = {}) {
    return {
        plannedDepartureTime: now + 5 * minute,
        realtimeDepartureTime: now + 7 * minute,
        realtime: true,
        delayInMinutes: 2,
        transportType: "UBAHN",
        label: "U3",
        destination: "Moosach",
        platform: "2",
        plannedPlatform: "1",
        cancelled: false,
        ...overrides
    }
}

test("request URLs encode user data and validate IDs and modes", () => {
    assert.equal(Model.searchUrl("  München Hbf & Ost  "),
        "https://www.mvg.de/api/bgw-pt/v3/locations?query=M%C3%BCnchen%20Hbf%20%26%20Ost&locationTypes=STATION")
    assert.equal(Model.departuresUrl("de:09162:6", ["UBAHN", "BUS", "BUS"]),
        "https://www.mvg.de/api/bgw-pt/v3/departures?globalId=de%3A09162%3A6&limit=40&offsetInMinutes=0&transportTypes=UBAHN%2CBUS")
    assert.throws(() => Model.searchUrl("  "), /search query/)
    assert.throws(() => Model.departuresUrl("09162:6", ["BUS"]), /station ID/)
    assert.throws(() => Model.departuresUrl("de:09162:6", ["PLANE"]), /Unsupported/)
    assert.equal(Model.departuresUrl("de:09162:6", []),
        "https://www.mvg.de/api/bgw-pt/v3/departures?globalId=de%3A09162%3A6&limit=40&offsetInMinutes=0")
})

test("station parsing preserves and disambiguates every candidate", () => {
    const stations = Model.parseStations(JSON.stringify([
        { type: "STATION", globalId: "de:09162:6", name: "Hauptbahnhof", place: "München" },
        { type: "ADDRESS", name: "Hauptstraße 1", place: "München" },
        { type: "STATION", globalId: "de:09184:460", name: "Hauptbahnhof", place: "Freising" },
        { type: "STATION", globalId: "de:09162:900", name: "Marienplatz" }
    ]))
    assert.deepEqual(stations, [
        { id: "de:09162:6", name: "Hauptbahnhof", place: "München", label: "Hauptbahnhof, München" },
        { id: "de:09184:460", name: "Hauptbahnhof", place: "Freising", label: "Hauptbahnhof, Freising" },
        { id: "de:09162:900", name: "Marienplatz", place: "", label: "Marienplatz" }
    ])
})

test("station parser rejects malformed JSON, top-level objects and invalid optional fields", () => {
    assert.throws(() => Model.parseStations("{"), /Malformed JSON/)
    assert.throws(() => Model.parseStations({ locations: [] }), /array payload/)
    assert.deepEqual(Model.parseStations([
        { type: "STATION", globalId: "de:09162:6", name: "X", place: 3 }
    ]), [{ id: "de:09162:6", name: "X", place: "", label: "X" }])
    assert.deepEqual(Model.parseStations([
        { type: "ADDRESS", name: "Hauptstraße 1" },
        { type: "POI", name: "Museum" }
    ]), [])
    assert.throws(() => Model.parseStations([
        { type: "STATION", globalId: "bad", name: "X" }
    ]), /no valid stations/)
})

test("departure parsing gates estimates on the realtime flag", () => {
    const [live, timetable] = Model.parseDepartures([
        departure(),
        departure({ realtime: false, plannedDepartureTime: now + 8 * minute,
            realtimeDepartureTime: now + 20 * minute, delayInMinutes: 12 })
    ])
    assert.deepEqual(live, {
        time: now + 7 * minute,
        plannedTime: now + 5 * minute,
        realtime: true,
        delay: 2,
        line: "U3",
        destination: "Moosach",
        platform: "2",
        platformChanged: true,
        cancelled: false,
        type: "UBAHN"
    })
    assert.equal(timetable.time, now + 8 * minute)
    assert.equal(timetable.realtime, false)
    assert.equal(timetable.delay, 0)
})

test("a claimed live row without a valid estimate falls back to the timetable", () => {
    const missing = Model.parseDepartures([
        departure({ realtime: true, realtimeDepartureTime: undefined, delayInMinutes: 9 })
    ])[0]
    assert.equal(missing.realtime, false)
    assert.equal(missing.time, missing.plannedTime)
    assert.equal(missing.delay, 0)
})

test("departure parser degrades malformed optional fields without losing valid rows", () => {
    const row = departure({ realtimeDepartureTime: undefined, realtime: undefined,
        delayInMinutes: undefined, platform: undefined, plannedPlatform: undefined,
        cancelled: undefined })
    const parsed = Model.parseDepartures([row])[0]
    assert.equal(parsed.time, row.plannedDepartureTime)
    assert.equal(parsed.platform, "")
    assert.equal(parsed.platformChanged, false)
    assert.throws(() => Model.parseDepartures({ departures: [] }), /array payload/)
    const degraded = Model.parseDepartures([departure({ realtime: "yes", platform: 2,
        realtimeDepartureTime: "soon", delayInMinutes: "late", cancelled: 1 })])[0]
    assert.equal(degraded.realtime, false)
    assert.equal(degraded.time, degraded.plannedTime)
    assert.equal(degraded.platform, "2")
    assert.equal(degraded.delay, 0)
    assert.equal(degraded.cancelled, false)
    assert.throws(() => Model.parseDepartures([{ nonsense: true }]), /no valid departures/)
})

test("one corrupt or unknown departure does not poison the board", () => {
    const rows = Model.parseDepartures([
        departure({ transportType: "FUTURE_MODE", label: "X1" }),
        { plannedDepartureTime: "tomorrow", transportType: "BUS" },
        departure({ transportType: "BAHN", label: "RE 1" })
    ])
    assert.deepEqual(rows.map(row => row.line), ["X1", "RE 1"])
    assert.deepEqual(Model.visibleDepartures(rows, now, []).map(row => row.line), ["X1", "RE 1"])
    assert.deepEqual(Model.visibleDepartures(rows, now, ["BAHN"]).map(row => row.line), ["RE 1"])
})

test("visible departures filter the past and modes, then sort and limit without dropping cancellations", () => {
    const rows = Model.parseDepartures([
        departure({ plannedDepartureTime: now - minute, realtimeDepartureTime: now - minute }),
        departure({ label: "U6", plannedDepartureTime: now + 4 * minute,
            realtimeDepartureTime: now + 4 * minute, cancelled: true }),
        departure({ label: "U3", plannedDepartureTime: now + 2 * minute,
            realtimeDepartureTime: now + 2 * minute }),
        departure({ label: "Bus 100", transportType: "BUS",
            plannedDepartureTime: now + minute, realtimeDepartureTime: now + minute })
    ])
    const visible = Model.visibleDepartures(rows, now, ["UBAHN"], 2)
    assert.deepEqual(visible.map(row => row.line), ["U3", "U6"])
    assert.equal(visible[1].cancelled, true)
    assert.deepEqual(Model.visibleDepartures(rows, now, ["BUS"]).map(row => row.line), ["Bus 100"])
})

test("departure labels are deterministic and cancellations are never presented as catchable", () => {
    assert.equal(Model.departureLabel({ time: now, cancelled: false }, now), "Due")
    assert.equal(Model.departureLabel({ time: now + 1, cancelled: false }, now), "1 min")
    assert.equal(Model.departureLabel({ time: now + 61_000, cancelled: false }, now), "2 min")
    assert.equal(Model.departureLabel({ time: now + 10 * minute, cancelled: true }, now), "Cancelled")
})
