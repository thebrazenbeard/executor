#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ARTIFACT="${1:-$SCRIPT_DIR/build/spk/ExecutorNode-armada38x-0.1.0-0001.spk}"
PYTHON_BIN="${PYTHON:-python3}"
command -v "$PYTHON_BIN" >/dev/null 2>&1 || PYTHON_BIN=python

"$PYTHON_BIN" - "$ARTIFACT" <<'PY'
import json
import pathlib
import re
import struct
import sys
import tarfile
import tempfile

artifact = pathlib.Path(sys.argv[1])
if not artifact.is_file():
    raise SystemExit(f"missing SPK: {artifact}")

required = {
    "INFO", "package.tgz", "scripts", "conf", "WIZARD_UIFILES",
    "LICENSE", "PACKAGE_ICON.PNG", "PACKAGE_ICON_256.PNG",
}
forbidden_bytes = [
    b"OPENAI_TUNNEL_RUNTIME_API_KEY",
    b"EXECUTOR_TUNNEL_API_SECRET",
    b"sk-proj-",
    b"executor keys.txt",
]
with tempfile.TemporaryDirectory() as tmp:
    tmp_path = pathlib.Path(tmp)
    with tarfile.open(artifact, "r:*") as outer:
        members = outer.getmembers()
        top = {m.name.lstrip("./").split("/", 1)[0] for m in members if m.name.lstrip("./")}
        missing = required - top
        if missing:
            raise AssertionError(f"SPK missing members: {sorted(missing)}")
        if "WIZARD_UIFILES-src" in top:
            raise AssertionError("wizard build source leaked into SPK")
        for m in members:
            normalized = m.name.lstrip("./")
            if normalized.startswith("scripts/") and normalized.count("/") == 1 and m.isfile():
                if m.mode & 0o111 == 0:
                    raise AssertionError(f"script is not executable: {normalized}")
        outer.extractall(tmp_path)

    info = (tmp_path / "INFO").read_text()
    expected_info = {
        "package": "ExecutorNode",
        "version": "0.1.0-0001",
        "arch": "armada38x",
        "os_min_ver": "7.2.2-72806",
        "maintainer": "thebrazenbeard",
        "description": "Executor Synology storage node",
    }
    parsed = {}
    for line in info.splitlines():
        match = re.fullmatch(r'([A-Za-z0-9_]+)="(.*)"', line.strip())
        if match:
            parsed[match.group(1)] = match.group(2)
    for key, value in expected_info.items():
        if parsed.get(key) != value:
            raise AssertionError(f"INFO {key}={parsed.get(key)!r}, expected {value!r}")

    privilege = json.loads((tmp_path / "conf" / "privilege").read_text())
    if privilege != {"defaults": {"run-as": "package"}}:
        raise AssertionError(f"unexpected privilege config: {privilege}")
    if json.loads((tmp_path / "conf" / "resource").read_text()) != {}:
        raise AssertionError("V1 must not request DSM resource workers")
    for name, dims in [("PACKAGE_ICON.PNG",(64,64)),("PACKAGE_ICON_256.PNG",(256,256))]:
        data = (tmp_path / name).read_bytes()
        if data[:8] != b"\x89PNG\r\n\x1a\n":
            raise AssertionError(f"{name} is not PNG")
        width, height = struct.unpack(">II", data[16:24])
        if (width, height) != dims:
            raise AssertionError(f"{name} dimensions {(width,height)} != {dims}")

    wizard = json.loads((tmp_path / "WIZARD_UIFILES" / "install_uifile").read_text())
    if not wizard or wizard[0].get("custom_render_name") != "executor_install":
        raise AssertionError("invalid install_uifile render name")
    if len(wizard[0].get("custom_render_fn", "")) < 20:
        raise AssertionError("install_uifile does not contain compiled render function")

    package_tgz = tmp_path / "package.tgz"
    with tarfile.open(package_tgz, "r:gz") as inner:
        binary_member = None
        for member in inner.getmembers():
            if member.name.lstrip("./") == "bin/executor-node":
                binary_member = member
                break
        if binary_member is None:
            raise AssertionError("package.tgz missing bin/executor-node")
        if binary_member.mode & 0o111 == 0:
            raise AssertionError("ExecutorNode payload is not executable")
        extracted = inner.extractfile(binary_member)
        if extracted is None:
            raise AssertionError("cannot read ExecutorNode payload")
        binary = extracted.read()

    if binary[:4] != b"\x7fELF":
        raise AssertionError("ExecutorNode payload is not ELF")
    if binary[4] != 1:
        raise AssertionError("ExecutorNode must be ELF32")
    if binary[5] != 1:
        raise AssertionError("ExecutorNode must be little-endian")
    machine = struct.unpack_from("<H", binary, 18)[0]
    if machine != 40:
        raise AssertionError(f"ExecutorNode e_machine={machine}, expected EM_ARM=40")
    phoff = struct.unpack_from("<I", binary, 28)[0]
    phentsize = struct.unpack_from("<H", binary, 42)[0]
    phnum = struct.unpack_from("<H", binary, 44)[0]
    for index in range(phnum):
        offset = phoff + index * phentsize
        p_type = struct.unpack_from("<I", binary, offset)[0]
        if p_type == 3:
            raise AssertionError("ExecutorNode has PT_INTERP; expected static CGO-disabled binary")

    artifact_bytes = artifact.read_bytes()
    for marker in forbidden_bytes:
        if marker.lower() in artifact_bytes.lower():
            raise AssertionError(f"forbidden secret marker embedded in SPK: {marker!r}")

print(f"SPK validation: PASS ({artifact})")
PY
