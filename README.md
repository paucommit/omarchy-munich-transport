# Munich Transport

Upcoming Munich public transport departures in the Omarchy bar. Click the transport icon, search for a stop, and choose it from the results. The panel remembers your stop and shows eight upcoming departures with line, destination, countdown and platform information.

Requires Omarchy 4 with shell plugin support. The compatibility baseline is Omarchy 4.0.2, Quickshell 0.3.1 and Qt 6.11.2. No API key or additional runtime packages are required.

## Install

```sh
omarchy plugin add https://github.com/paucommit/omarchy-munich-transport.git --enable
```

The widget starts on the right of the bar. Move it with Omarchy's bar settings or CLI:

```sh
omarchy bar move paucommit.munichtransport --section right
```

## Use

- Click the icon to open or close the board; Escape or a click outside dismisses it.
- Submit a station search, then choose a result. Locality names distinguish stops with similar names.
- Use **Change station** to choose another stop and **Refresh** to update departures.
- Choose transport types in Omarchy's widget settings. An empty selection means all types.
- **Live** identifies realtime estimates; **Scheduled** identifies timetable-only departures. Cancellations and platform changes are explicit. A failed refresh marks retained data as stale and shows when it last updated.

You can also open the widget through the shell:

```sh
omarchy-shell shell summon paucommit.munichtransport
omarchy-shell shell hide paucommit.munichtransport
```

The selected station and transport types are saved on this widget's entry in `~/.config/omarchy/shell.json`. The plugin uses Omarchy's settings IPC to save the stop; it does not maintain another configuration file.

## Data and requests

Data comes directly from MVG's undocumented website backend at `https://www.mvg.de/api/bgw-pt/v3/`: `/locations` for station search and `/departures` for the board. Search text and station IDs are sent to MVG. Departure data remains in memory. The plugin has no geolocation, telemetry, server, disk cache or dataset download.

Requests occur only while the panel is open: explicit station searches, a departure fetch on opening, and refreshes every 60 seconds. Manual refreshes are throttled, failures back off, and closing aborts outstanding requests. Countdown updates do not make network requests.

The backend can change without notice, and realtime coverage varies. [MVG's terms](https://www.mvg.de/impressum.html) tolerate moderate private, non-commercial use and reserve the right to withdraw that tolerance. This personal client has no MVG affiliation or availability guarantee. The MIT license covers the plugin code, not MVG's data or broader/commercial data usage.

## Development

Four production files: `manifest.json`, `BarWidget.qml`, `Panel.qml` and `Model.js`. QML handles the shell UI and request lifecycle; the plain JavaScript model handles API parsing and departure calculations.

```sh
node --test tests/*.test.js
omarchy plugin validate .
tools/check-qml.sh
```

The QML check uses Qt 6's `qmlformat` parser on tracked QML files and discards its output without changing their formatting. It is a syntax check: standalone Qt tooling cannot fully resolve Quickshell's `qs.*` imports and host interfaces. Actual loading, keyboard input, panel placement and settings persistence require a running Omarchy/Wayland session.

GitHub Actions runs the offline tests, QML syntax check and the canonical Omarchy validator pinned to v4.0.2 commit `346e69e1cec6c4e8924531874af6ba010a1bc99e`. Tests use synthetic data and a deterministic clock; CI never calls MVG.

For request lifecycle tests, run `tools/test-runtime.sh` in an Omarchy desktop session. It briefly installs a uniquely named test widget, feeds the actual QML panel fake responses, checks cancellation/stale replies/retries, and waits for the real 12-second timeout. Its native window stays hidden to avoid stealing focus. The script removes its temporary widget afterward. This optional check needs `jq` and a running shell; hosted CI runs the offline checks above.

Saving a station rebuilds the widget in Omarchy 4.0.2. A bounded detached command uses the public settings IPC and retries reopening the replacement; station text is passed as arguments, never evaluated as shell code. The offline save tests exercise this command against fake IPC programs.

## Credits

Inspired by [Swiss Transport](https://github.com/jmaeder/omarchy-swisstransport). Host integration follows [Omarchy's native plugin conventions](https://github.com/omacom/omarchy/blob/quattro/shell/README.md) and weather widget. API research also used the [mvg adapter](https://github.com/mondbaron/mvg) and [mvg-ios-widget](https://github.com/vladyslav-keidaliuk/mvg-ios-widget).

MIT licensed; see [LICENSE](LICENSE).
