"""Fail-closed source check for known concealed editor-startup execution paths.

Never execute VS Code tasks, fonts, or other repository code from this check.
This is source-tree evidence only, not a workstation compromise assessment.
"""

import json
from pathlib import Path
import re


def _read_object(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"missing or malformed workspace configuration: {path}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"workspace configuration must be an object: {path}")
    return value


def inspect_workspace(root: Path) -> None:
    tasks = _read_object(root / ".vscode" / "tasks.json")
    definitions = tasks.get("tasks")
    if not isinstance(definitions, list):
        raise ValueError("workspace tasks must be an explicit list")
    for task in definitions:
        if not isinstance(task, dict):
            raise ValueError("workspace task must be an object")
        options = task.get("runOptions", {})
        if not isinstance(options, dict):
            raise ValueError("workspace runOptions must be an object")
        if options.get("runOn") == "folderOpen":
            raise ValueError("folderOpen automatic editor task is prohibited")
        # Prior disguised startup code was invoked from a pseudo-font asset.
        command = json.dumps(task, ensure_ascii=False).lower()
        if re.search(r"public[\\/]+fonts[\\/]+", command):
            raise ValueError("executable task referencing a font asset is prohibited")

    settings = _read_object(root / ".vscode" / "settings.json")
    if settings.get("task.allowAutomaticTasks") != "off" or "tasks" in settings:
        raise ValueError("automatic tasks must stay disabled in workspace settings")

    fonts = root / "public" / "fonts"
    if not fonts.is_dir():
        raise ValueError("expected public font asset directory is missing")
    if list(fonts.rglob("*.lkf")):
        raise ValueError("pseudo-font executable extension is prohibited")
