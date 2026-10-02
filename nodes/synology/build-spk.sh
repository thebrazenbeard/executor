#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PKG_SRC="$SCRIPT_DIR/synology"
BUILD_ROOT="${EXECUTOR_SPK_BUILD_DIR:-$SCRIPT_DIR/build/spk}"
PAYLOAD="$BUILD_ROOT/payload"
STAGE="$BUILD_ROOT/stage"
ARTIFACT="$BUILD_ROOT/ExecutorNode-armada38x-0.1.0-0004.spk"

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
chmod 755 "$PAYLOAD/bin/executor-node"

cp "$PKG_SRC/INFO" "$STAGE/INFO"
cp "$PKG_SRC/LICENSE" "$STAGE/LICENSE"
cp "$PKG_SRC/PACKAGE_ICON.PNG" "$STAGE/PACKAGE_ICON.PNG"
cp "$PKG_SRC/PACKAGE_ICON_256.PNG" "$STAGE/PACKAGE_ICON_256.PNG"
cp -R "$PKG_SRC/scripts" "$STAGE/scripts"
cp -R "$PKG_SRC/conf" "$STAGE/conf"
cp -R "$PKG_SRC/WIZARD_UIFILES" "$STAGE/WIZARD_UIFILES"

PYTHON_BIN="${PYTHON:-python3}"
command -v "$PYTHON_BIN" >/dev/null 2>&1 || PYTHON_BIN=python
"$PYTHON_BIN" - "$PAYLOAD/bin/executor-node" "$STAGE" "$ARTIFACT" <<'PY'
import gzip
import pathlib
import sys
import tarfile

binary = pathlib.Path(sys.argv[1])
stage = pathlib.Path(sys.argv[2])
artifact = pathlib.Path(sys.argv[3])
package_tgz = stage / "package.tgz"

def normalized(info, mode):
    info.uid = 0
    info.gid = 0
    info.uname = "root"
    info.gname = "root"
    info.mode = mode
    info.mtime = 0
    info.pax_headers = {}
    return info

# DSM's package payload is deliberately USTAR + gzip. Do not allow Python's
# default PAX format, host ownership, fractional mtimes, or ./ path prefixes.
with package_tgz.open("wb") as raw:
    with gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode="w", format=tarfile.USTAR_FORMAT) as inner:
            directory = tarfile.TarInfo("bin")
            directory.type = tarfile.DIRTYPE
            normalized(directory, 0o755)
            inner.addfile(directory)

            info = inner.gettarinfo(str(binary), arcname="bin/executor-node")
            normalized(info, 0o755)
            with binary.open("rb") as src:
                inner.addfile(info, src)

outer_files = [
    ("INFO", 0o644),
    ("package.tgz", 0o644),
    ("scripts/preinst", 0o755),
    ("scripts/postinst", 0o755),
    ("scripts/preuninst", 0o755),
    ("scripts/postuninst", 0o755),
    ("scripts/preupgrade", 0o755),
    ("scripts/postupgrade", 0o755),
    ("scripts/start-stop-status", 0o755),
    ("conf/privilege", 0o644),
    ("WIZARD_UIFILES/install_uifile", 0o644),
    ("LICENSE", 0o644),
    ("PACKAGE_ICON.PNG", 0o644),
    ("PACKAGE_ICON_256.PNG", 0o644),
]

# INFO first; explicit USTAR members; root-owned metadata. This mirrors the
# packages already accepted by Patrick's DS216 instead of inheriting CI-runner
# metadata from the build host.
with tarfile.open(artifact, mode="w", format=tarfile.USTAR_FORMAT) as outer:
    for rel, mode in outer_files:
        path = stage / rel
        info = outer.gettarinfo(str(path), arcname=rel)
        normalized(info, mode)
        with path.open("rb") as src:
            outer.addfile(info, src)
PY

printf '%s\n' "$ARTIFACT"
