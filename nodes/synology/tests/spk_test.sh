#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
NODE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PKG_ROOT="$NODE_ROOT/synology"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

require_file() {
  [ -f "$1" ] || fail "missing file: $1"
}

for rel in   INFO   scripts/preinst scripts/postinst scripts/preuninst scripts/postuninst   scripts/preupgrade scripts/postupgrade scripts/start-stop-status   conf/privilege conf/resource   WIZARD_UIFILES/install_uifile LICENSE PACKAGE_ICON.PNG PACKAGE_ICON_256.PNG
do
  require_file "$PKG_ROOT/$rel"
done

grep -qx 'package="ExecutorNode"' "$PKG_ROOT/INFO" || fail "wrong package field"
grep -qx 'version="0.1.0-0002"' "$PKG_ROOT/INFO" || fail "wrong version field"
grep -qx 'arch="armada38x"' "$PKG_ROOT/INFO" || fail "wrong arch field"
grep -qx 'os_min_ver="7.2-72806"' "$PKG_ROOT/INFO" || fail "wrong os_min_ver"
grep -qx 'displayname="ExecutorNode"' "$PKG_ROOT/INFO" || fail "missing displayname"
grep -qx 'maintainer="thebrazenbeard"' "$PKG_ROOT/INFO" || fail "wrong maintainer"
grep -qx 'description="Executor Synology storage node"' "$PKG_ROOT/INFO" || fail "wrong description"

PYTHON_BIN="${PYTHON:-python3}"
command -v "$PYTHON_BIN" >/dev/null 2>&1 || PYTHON_BIN=python
"$PYTHON_BIN" - "$PKG_ROOT" <<'PY'
import json, pathlib, struct, sys
root = pathlib.Path(sys.argv[1])
priv = json.loads((root / "conf" / "privilege").read_text())
assert priv == {"defaults": {"run-as": "package"}}, priv
resource = json.loads((root / "conf" / "resource").read_text())
assert resource == {}, resource
for name, dims in [("PACKAGE_ICON.PNG",(64,64)),("PACKAGE_ICON_256.PNG",(256,256))]:
    data=(root/name).read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", name
    width,height=struct.unpack(">II", data[16:24])
    assert (width,height)==dims, (name,width,height)
wizard=json.loads((root/"WIZARD_UIFILES"/"install_uifile").read_text())
assert isinstance(wizard,list) and wizard, wizard
entry=wizard[0]
assert entry["custom_render_name"]=="executor_install"
assert "custom_render_fn" in entry and len(entry["custom_render_fn"])>20
PY

for script in "$PKG_ROOT"/scripts/*; do
  [ -x "$script" ] || fail "lifecycle script is not executable: $script"
done
if grep -R -n -E 'OPENAI_TUNNEL_RUNTIME_API_KEY|EXECUTOR_TUNNEL_API_SECRET|executor keys\.txt|sk-proj-[A-Za-z0-9_-]+' "$PKG_ROOT"; then
  fail "forbidden secret material found in package source"
fi

TMP="$(mktemp -d)"
cleanup() {
  if [ -f "$TMP/var/executor-node.pid" ]; then
    pid="$(cat "$TMP/var/executor-node.pid" 2>/dev/null || true)"
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

export SYNOPKG_PKGDEST="$TMP/target"
export SYNOPKG_PKGVAR="$TMP/var"
export SYNOPKG_PKGHOME="$TMP/home"
export SYNOPKG_PKGTMP="$TMP/tmp"
mkdir -p "$SYNOPKG_PKGDEST/bin" "$SYNOPKG_PKGVAR" "$SYNOPKG_PKGHOME" "$SYNOPKG_PKGTMP"

cat > "$SYNOPKG_PKGDEST/bin/executor-node" <<'STUB'
#!/bin/sh
if [ "${1:-}" = "--validate-config" ]; then
  exit 0
fi
trap 'exit 0' TERM INT
while :; do sleep 1; done
STUB
chmod 700 "$SYNOPKG_PKGDEST/bin/executor-node"
export wizard_executor_url="https://executor.example.test"
export wizard_device_id="DS216"
export wizard_device_token="unit-test-device-token"
export wizard_share_roots="/volume1/media,/volume1/backups"

"$PKG_ROOT/scripts/preinst"
"$PKG_ROOT/scripts/postinst"

require_file "$SYNOPKG_PKGVAR/config.json"
require_file "$SYNOPKG_PKGHOME/device.token"
[ "$(cat "$SYNOPKG_PKGHOME/device.token")" = "unit-test-device-token" ] || fail "device token contents changed"

export EXPECTED_TOKEN_PATH="$SYNOPKG_PKGHOME/device.token"
"$PYTHON_BIN" - "$SYNOPKG_PKGVAR/config.json" <<'PY'
import json, os, pathlib, sys
cfg=json.loads(pathlib.Path(sys.argv[1]).read_text())
assert cfg["executorUrl"]=="https://executor.example.test"
assert cfg["deviceId"]=="DS216"
if os.name == "nt":
    assert cfg["deviceTokenFile"].replace("\\","/").endswith("/home/device.token")
else:
    assert cfg["deviceTokenFile"]==os.environ["EXPECTED_TOKEN_PATH"]
assert cfg["roots"]==[
    {"id":"share1","path":"/volume1/media","mode":"rw"},
    {"id":"share2","path":"/volume1/backups","mode":"rw"},
]
PY

case "$(uname -s)" in
  MINGW*|MSYS*) ;;
  *)
    mode="$(stat -c '%a' "$SYNOPKG_PKGHOME/device.token")"
    [ "$mode" = "600" ] || fail "device token mode is $mode, expected 600"
    ;;
esac
"$PKG_ROOT/scripts/start-stop-status" status && fail "status should report stopped"
status_code=$?
[ "$status_code" -eq 3 ] || fail "stopped status code=$status_code, expected 3"

sleep 30 &
unrelated_pid=$!
printf '%s\n' "$unrelated_pid" > "$SYNOPKG_PKGVAR/executor-node.pid"
"$PKG_ROOT/scripts/start-stop-status" stop
if ! kill -0 "$unrelated_pid" 2>/dev/null; then
  fail "stale PID file caused stop to kill an unrelated process"
fi
kill "$unrelated_pid" 2>/dev/null || true
wait "$unrelated_pid" 2>/dev/null || true
[ ! -f "$SYNOPKG_PKGVAR/executor-node.pid" ] || fail "stale PID file was not cleared"

"$PKG_ROOT/scripts/start-stop-status" start
"$PKG_ROOT/scripts/start-stop-status" status || fail "status should report running"

pid="$(cat "$SYNOPKG_PKGVAR/executor-node.pid")"
kill -0 "$pid" 2>/dev/null || fail "recorded package pid is not running"

config_before="$(cat "$SYNOPKG_PKGVAR/config.json")"
token_before="$(cat "$SYNOPKG_PKGHOME/device.token")"
export SYNOPKG_PKG_STATUS="UPGRADE"
"$PKG_ROOT/scripts/preupgrade"
"$PKG_ROOT/scripts/preuninst"
"$PKG_ROOT/scripts/postuninst"
"$PKG_ROOT/scripts/preinst"
"$PKG_ROOT/scripts/postinst"
"$PKG_ROOT/scripts/postupgrade"

[ "$(cat "$SYNOPKG_PKGVAR/config.json")" = "$config_before" ] || fail "upgrade changed config"
[ "$(cat "$SYNOPKG_PKGHOME/device.token")" = "$token_before" ] || fail "upgrade changed token"

sentinel="$TMP/share-data-must-survive"
printf 'keep me' > "$sentinel"
"$PKG_ROOT/scripts/start-stop-status" stop
"$PKG_ROOT/scripts/start-stop-status" status && fail "status should report stopped after stop"
status_code=$?
[ "$status_code" -eq 3 ] || fail "post-stop status code=$status_code, expected 3"
export SYNOPKG_PKG_STATUS="UNINSTALL"
"$PKG_ROOT/scripts/preuninst"
"$PKG_ROOT/scripts/postuninst"
[ -f "$sentinel" ] || fail "uninstall deleted non-package share data"

echo "SPK structure and lifecycle contract: PASS"
