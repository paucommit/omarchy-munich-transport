const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const Model = require("../Model.js")

function save(mode, station) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "munich-save-"))
    try {
        const callsPath = path.join(directory, "calls")
        fs.writeFileSync(path.join(directory, "omarchy-shell"), `#!/usr/bin/env node
const fs = require("node:fs")
const args = process.argv.slice(2)
const file = process.env.MUNICH_TEST_CALLS
const previous = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\\n") : []
fs.appendFileSync(file, JSON.stringify(args) + "\\n")
const mode = process.env.MUNICH_TEST_MODE
if (args[1] === "setBarWidget") console.log(mode === "save-failure" ? "unknown" : "ok")
else console.log(mode === "always-unready" || (mode === "retry" && previous.length < 2) ? "unknown" : "ok")
`, { mode: 0o755 })
        // Skip the retry delays while exercising the actual command sequence.
        fs.writeFileSync(path.join(directory, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
        const command = Model.saveStationCommand("paucommit.munichtransport", station)
        const result = spawnSync(command[0], command.slice(1), {
            encoding: "utf8",
            env: { ...process.env, PATH: directory + path.delimiter + process.env.PATH,
                MUNICH_TEST_CALLS: callsPath, MUNICH_TEST_MODE: mode }
        })
        assert.ifError(result.error)
        const calls = fs.readFileSync(callsPath, "utf8").trim().split("\n").map(JSON.parse)
        return { status: result.status, calls }
    } finally {
        fs.rmSync(directory, { recursive: true, force: true })
    }
}

test("saving preserves station text as one argument and retries while the widget loads", () => {
    const station = { id: "de:09162:2", name: "München ' \" $(`false`) ; &\nTest" }
    const result = save("retry", station)
    assert.equal(result.status, 0)
    assert.deepEqual(result.calls, [
        ["shell", "setBarWidget", "paucommit.munichtransport", "station", JSON.stringify(station), "{}"],
        ["shell", "summon", "paucommit.munichtransport"],
        ["shell", "summon", "paucommit.munichtransport"]
    ])
})

test("a rejected save never summons the widget even when IPC exits zero", () => {
    const result = save("save-failure", { id: "de:09162:2", name: "Marienplatz" })
    assert.equal(result.status, 1)
    assert.equal(result.calls.length, 1)
})

test("an unavailable widget exhausts bounded summon retries", () => {
    const result = save("always-unready", { id: "de:09162:2", name: "Marienplatz" })
    assert.equal(result.status, 1)
    assert.equal(result.calls.filter(call => call[1] === "summon").length, 4)
})
