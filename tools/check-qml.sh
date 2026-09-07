#!/usr/bin/env bash

set -euo pipefail

if command -v qmlformat >/dev/null 2>&1; then
  qmlformat_bin=$(command -v qmlformat)
elif [[ -x /usr/lib/qt6/bin/qmlformat ]]; then
  qmlformat_bin=/usr/lib/qt6/bin/qmlformat
else
  echo "qmlformat not found" >&2
  exit 1
fi

mapfile -t qml_files < <(git ls-files '*.qml')
if (( ${#qml_files[@]} == 0 )); then
  echo "no tracked QML files found" >&2
  exit 1
fi

# Parse without resolving Quickshell's host-only imports. Unlike qmllint, this
# has the same syntax-only behavior on Ubuntu's Qt and current Omarchy Qt.
# Discard formatting output; never rewrite the source or enforce a style.
for qml_file in "${qml_files[@]}"; do
  "$qmlformat_bin" "$qml_file" >/dev/null
done
