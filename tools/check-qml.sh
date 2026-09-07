#!/usr/bin/env bash

set -euo pipefail

if command -v qmllint >/dev/null 2>&1; then
  qmllint_bin=$(command -v qmllint)
elif [[ -x /usr/lib/qt6/bin/qmllint ]]; then
  qmllint_bin=/usr/lib/qt6/bin/qmllint
else
  echo "qmllint not found" >&2
  exit 1
fi

mapfile -t qml_files < <(git ls-files '*.qml')
if (( ${#qml_files[@]} == 0 )); then
  echo "no tracked QML files found" >&2
  exit 1
fi

# Omarchy's qs.* modules and injected host facades cannot be fully resolved by
# standalone qmllint. Its default warning threshold still fails parse errors
# while unresolved-import and type-analysis warnings do not fail this check.
"$qmllint_bin" --silent "${qml_files[@]}"
