#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PKG_SRC="$SCRIPT_DIR/synology"
BUILD_ROOT="${EXECUTOR_SPK_BUILD_DIR:-$SCRIPT_DIR/build/spk}"
PAYLOAD="$BUILD_ROOT/payload"
STAGE="$BUILD_ROOT/stage"
ARTIFACT="$BUILD_ROOT/ExecutorNode-armada38x-0.1.0-0001.spk"

command -v go >/dev/null 2>&1 || {
  echo "go is required" >&2
  exit 1
}

rm -rf "$BUILD_ROOT"
mkdir -p "$PAYLOAD/bin" "$STAGE"

(
  cd "$SCRIPT_DIR"
  GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0     go build -trimpath -ldflags="-s -w"     -o "$PAYLOAD/bin/executor-node" ./cmd/executor-node
)
chmod 700 "$PAYLOAD/bin/executor-node"

PYTHON_BIN="${PYTHON:-python3}"
command -v "$PYTHON_BIN" >/dev/null 2>&1 || PYTHON_BIN=python
"$PYTHON_BIN" - "$PAYLOAD/bin/executor-node" "$STAGE/package.tgz" <<'PY'
import pathlib, sys, tarfile
binary=pathlib.Path(sys.argv[1])
archive=pathlib.Path(sys.argv[2])
with tarfile.open(archive,"w:gz") as tf:
    directory=tarfile.TarInfo("./bin")
    directory.type=tarfile.DIRTYPE
    directory.mode=0o700
    tf.addfile(directory)
    info=tf.gettarinfo(str(binary),arcname="./bin/executor-node")
    info.mode=0o700
    with binary.open("rb") as src:
        tf.addfile(info,src)
PY

cp "$PKG_SRC/INFO" "$STAGE/INFO"
cp "$PKG_SRC/LICENSE" "$STAGE/LICENSE"
cp "$PKG_SRC/PACKAGE_ICON.PNG" "$STAGE/PACKAGE_ICON.PNG"
cp "$PKG_SRC/PACKAGE_ICON_256.PNG" "$STAGE/PACKAGE_ICON_256.PNG"
cp -R "$PKG_SRC/scripts" "$STAGE/scripts"
cp -R "$PKG_SRC/conf" "$STAGE/conf"
cp -R "$PKG_SRC/WIZARD_UIFILES" "$STAGE/WIZARD_UIFILES"

chmod 755 "$STAGE/scripts/"*
chmod 644 "$STAGE/INFO" "$STAGE/LICENSE"   "$STAGE/PACKAGE_ICON.PNG" "$STAGE/PACKAGE_ICON_256.PNG"   "$STAGE/conf/privilege" "$STAGE/conf/resource"   "$STAGE/WIZARD_UIFILES/install_uifile"

tar -C "$STAGE" -cf "$ARTIFACT"   INFO package.tgz scripts conf WIZARD_UIFILES   LICENSE PACKAGE_ICON.PNG PACKAGE_ICON_256.PNG

printf '%s\n' "$ARTIFACT"
