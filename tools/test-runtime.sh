#!/usr/bin/env bash

set -euo pipefail

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
plugins_dir=${XDG_CONFIG_HOME:-"$HOME/.config"}/omarchy/plugins
mkdir -p "$plugins_dir"
test_dir=$(mktemp -d "$plugins_dir/paucommit.munichtransport.test.XXXXXX")
test_id=${test_dir##*/}

cleanup() {
  omarchy-shell "$test_id" close >/dev/null 2>&1 || true
  omarchy-shell shell setPluginEnabled "$test_id" false >/dev/null 2>&1 || true
  if [[ $test_dir == "$plugins_dir/"* && ${test_dir##*/} == "$test_id" ]]; then
    rm -rf -- "$test_dir"
  fi
  omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

omarchy-shell shell ping >/dev/null
cp "$repo_dir"/{manifest.json,BarWidget.qml,Panel.qml,Model.js} "$test_dir/"
cp "$repo_dir/tests/Runtime.js" "$test_dir/Runtime.js"
sed -i '/^  id: root$/a\  property alias testWindow: panel' "$test_dir/Panel.qml"

sed -i "s/paucommit\.munichtransport/$test_id/g" "$test_dir/manifest.json" "$test_dir/BarWidget.qml" "$test_dir/Panel.qml"
sed -i '/^import QtQuick$/a import Quickshell.Io\nimport "Runtime.js" as Runtime' "$test_dir/BarWidget.qml"
sed -i '$i\
  IpcHandler {\
    target: root.moduleName\
    function tests(): string { try { return Runtime.run(panelLoader.item) } catch (e) { return "FAIL: " + e } }\
    function timeoutStart(): string { return Runtime.timeoutStart(panelLoader.item) }\
    function timeoutFinish(): string { try { return Runtime.timeoutFinish() } catch (e) { return "FAIL: " + e } }\
    function ready(): string { return panelLoader.item ? "ready" : "loading" }\
    function close(): void { root.close() }\
  }' "$test_dir/BarWidget.qml"

omarchy-plugin-validate "$test_dir"
omarchy-shell shell rescanPlugins >/dev/null
registered=false
for _ in {1..40}; do
  if omarchy-shell shell listPlugins | jq -e --arg id "$test_id" \
      'any(.[]; .id == $id)' >/dev/null; then
    registered=true
    break
  fi
  sleep 0.25
done
[[ $registered == true ]] || { echo "temporary plugin was not discovered" >&2; exit 1; }

omarchy-plugin-enable "$test_id" --section right >/dev/null
sleep 0.5

ready=false
for _ in {1..40}; do
  if [[ $(omarchy-shell "$test_id" ready 2>/dev/null || true) == ready ]]; then
    ready=true
    break
  fi
  sleep 0.25
done
[[ $ready == true ]] || { echo "temporary plugin component did not load" >&2; exit 1; }

result=$(omarchy-shell "$test_id" tests)
printf '%s\n' "$result"
[[ $result == *'"passed"'* ]]

omarchy-shell "$test_id" timeoutStart
sleep 13
timeout_result=$(omarchy-shell "$test_id" timeoutFinish)
printf '%s\n' "$timeout_result"
[[ $timeout_result == "timeout and recovery passed" ]]
