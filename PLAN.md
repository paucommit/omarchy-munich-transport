# Munich Transport plugin — proposed plan

Status: accepted by the user on 2026-09-07. Research completed; implementation authorized.

Proposed repository: `paucommit/omarchy-munich-transport` (public source).
Proposed plugin ID: `paucommit.munichtransport`.

Build a small native Omarchy departure board inspired by Swiss Transport's bar/panel interaction. The first version covers station search and upcoming departures. Maps, vehicle tracking, journey planning, favorites, geolocation, and a provider framework are outside this version's scope.

## Research and decisions

| Evidence | Consequence for this plugin |
| --- | --- |
| [Swiss Transport](https://github.com/jmaeder/omarchy-swisstransport), inspected at `b291eb63`, is an MIT-licensed map application with derived vehicle positions, stop boards, search, favorites and tile caching. It makes no requests while closed. | Reuse its interaction and lifecycle ideas; implement a much smaller departure board. Preserve attribution/license notices for any reused code. |
| [Omarchy's plugin contract](https://github.com/omacom/omarchy/blob/quattro/shell/README.md) uses a root manifest, QML entry points and inline shell settings. The installed weather plugin separates pure JavaScript model logic from QML. | One standalone plugin repository; native shell UI/settings and a separately testable model. |
| [Qt's QML XMLHttpRequest](https://doc.qt.io/qt-6/qml-qtqml-xmlhttprequest.html) supports asynchronous JSON requests without browser same-origin restrictions. Its documented API does not include browser-style request timeouts. | Direct HTTPS calls from QML; use a QML timer plus abort for timeouts. No additional runtime package, daemon, proxy or build step. |
| MVG's current `/api/bgw-pt/v3/locations` and `/departures` endpoints returned data in live research probes. [The mvg adapter](https://pypi.org/project/mvg/) and [this MIT iOS widget](https://github.com/vladyslav-keidaliuk/mvg-ios-widget) corroborate current usage. | Use the current JSON backend, with endpoint-specific parsing isolated in `Model.js`. Do not use obsolete `/api/fahrinfo` examples. |
| [MVV's developer offering](https://www.mvv-muenchen.de/en/service-support/mvv-content-for-developers/) provides static GTFS and stop CSV, while its TRIAS timetable interface is described as closed beta/coming soon. [TRIAS terms](https://redaktion.mvv-muenchen.de/fileadmin/mediapool/02-Fahrplanauskunft/02-Dokumente/opendata/TRIAS_MVV_Nutzungsbedingungen.pdf) require application-specific access. | GTFS would add timetable import/storage without providing live departures. TRIAS adds access setup and XML handling. Neither is the minimal choice for this personal widget. |

MVG's backend is undocumented, with no published numeric quota or compatibility guarantee found. [MVG's current terms](https://www.mvg.de/impressum.html) tolerate moderate private, non-commercial use and reserve the right to revoke that tolerance. Document this clearly. Publish client code with synthetic test fixtures; each user connects directly to MVG. Do not imply that the code license grants rights to MVG data or commercial usage.

## User experience

- A small transport icon opens/closes an Omarchy-themed panel. Opening by shell IPC and closing with Escape follow the host lifecycle.
- First use presents a station search. Search on explicit submit, list matching stations with locality, and save the user's selected canonical `globalId` and display name. Never silently pick the first fuzzy result.
- Show eight upcoming departures with line, destination, minutes until departure, and platform when supplied. Distinguish timetable-only information, live estimates, delays, cancellations and platform changes.
- Include Change station and Refresh actions. Transport mode selection uses the ordinary manifest settings schema. Start with all modes returned for the chosen station.
- Show distinct loading, no departures, and request failure states. If a refresh fails, label any retained rows as stale with their last update time; never present old estimates as freshly fetched.
- Fetch on opening and once every 60 seconds while open. Stop polling and abort outstanding requests on close. Bound manual refreshes to prevent request bursts; update countdowns locally without extra network calls.

## Implementation

Target four production files, plus documentation and focused tests:

```text
manifest.json             identity, entry point, defaults and settings schema
BarWidget.qml             bar icon and panel lifecycle
Panel.qml                 station selection, departures and async requests
Model.js                  parsing, normalization, sorting and display calculations
tests/                    small synthetic fixtures and model/request-state tests
.github/workflows/ci.yml  one required validation job
README.md
LICENSE
```

Use the host's supported settings operation to persist this plugin's values. The documented `omarchy-shell shell setBarWidget <id> <key> <valueJson> <selectorJson>` IPC is available in the installed shell and provides a small fallback if a direct injected settings method is unavailable. Invoke it with a process argument array, and verify its response before claiming a save succeeded. Avoid a separate settings store and direct rewriting of `shell.json`. Follow the tested host's public plugin interfaces, including changes to third-party capability facades; avoid private host state. Use plain text for API-provided labels. The Swiss reference uses a separate state file for panel edits, so its persistence implementation is not the pattern to copy here.

The endpoint returns epoch milliseconds. Use a valid realtime departure time only when `realtime === true`, otherwise use the planned time. A live probe included a timetable-only row with a `realtimeDepartureTime` field, so presence alone is insufficient. Keep cancellations explicit and exclude them from catchable departures. Validate optional fields, filter past rows against the current clock, sort, and apply the visible limit locally: a request for three departures returned four in research.

Encode query values. Allow one in-flight request per operation; ignore outdated results after station changes and closure. Apply a bounded timeout, handle HTTP errors/invalid JSON, and back off after failures rather than immediately retrying. Keep only the current display data in memory.

## Validation and delivery after acceptance

1. Create the repository with a minimal base commit and an implementation branch so the whole implementation is reviewable in a PR. Implement the model and UI in parallel with bounded agent ownership; integrate locally.
2. Add meaningful offline tests for station disambiguation, real/planned timestamps, cancellations, missing fields, ordering/limits, stale responses, timeout recovery and German names. Inject the clock for deterministic checks; hosted CI must not depend on MVG availability.
3. Run the canonical `omarchy plugin validate`, model tests with `node --test`, and a QML syntax check in one GitHub Actions job. Pin the Omarchy validator source revision and document the tested runtime. The installed baseline found during research is Omarchy 4.0.2, Quickshell 0.3.1 and Qt 6.11.2.
4. Smoke-test loading and interaction in an actual Omarchy/Wayland session: station selection and persistence, reopening, keyboard dismissal, bar positions/multiple monitors, live departures, empty/error states, and closure during a pending request. `qmllint` is only a syntax gate here: it cannot fully resolve Quickshell's `qs.*` imports or dynamic host interfaces. Report runtime evidence separately from CI.
5. Start a fresh agent with no inherited conversation. Give it the accepted plan, repository and diff; have it review correctness, scope, host integration, network lifecycle and tests. Resolve actionable findings and rerun affected checks.
6. Open the implementation PR, monitor checks for its latest commit, fix failures, and report the PR URL only with the actual CI result. Leave merging and plugin-directory listing for a later request.

Acceptance authorizes this scope, repository/ID and the implementation → clean-context review → PR → green CI workflow above.
