"""Static workspace-startup policy; never execute editor tasks or asset files."""

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from workspace_startup_safety import inspect_workspace


ROOT = Path(__file__).resolve().parents[1]


def fixture(root: Path, *, tasks=None, settings=None, pseudo_font=False) -> None:
    vscode = root / ".vscode"
    fonts = root / "public" / "fonts"
    vscode.mkdir(parents=True)
    fonts.mkdir(parents=True)
    (vscode / "tasks.json").write_text(json.dumps(tasks if tasks is not None else {
        "version": "2.0.0", "tasks": []
    }), encoding="utf-8")
    (vscode / "settings.json").write_text(json.dumps(settings if settings is not None else {
        "task.allowAutomaticTasks": "off"
    }), encoding="utf-8")
    if pseudo_font:
        (fonts / "fa-solid.lkf").write_text("inert test fixture", encoding="utf-8")


class WorkspaceStartupSafetyTests(unittest.TestCase):
    def test_current_main_source_has_no_editor_startup_loader(self):
        inspect_workspace(ROOT)

    def test_rejects_inert_folder_open_task_fixture(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root, tasks={"version": "2.0.0", "tasks": [{
                "label": "harmless-test", "type": "shell", "command": "echo fixture",
                "runOptions": {"runOn": "folderOpen"}
            }]})
            with self.assertRaisesRegex(ValueError, "folderOpen"):
                inspect_workspace(root)

    def test_rejects_font_disguised_as_executable_task_fixture(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root, tasks={"version": "2.0.0", "tasks": [{
                "label": "font-test", "type": "shell", "command": "node public/fonts/inert.woff2"
            }]})
            with self.assertRaisesRegex(ValueError, "font"):
                inspect_workspace(root)

    def test_rejects_windows_style_pseudo_font_command_fixture(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root, tasks={"version": "2.0.0", "tasks": [{
                "label": "font-test", "type": "shell", "command": r"node .\public\fonts\inert.lkf"
            }]})
            with self.assertRaisesRegex(ValueError, "font"):
                inspect_workspace(root)

    def test_rejects_pseudo_font_artifact_fixture(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root, pseudo_font=True)
            with self.assertRaisesRegex(ValueError, "pseudo-font"):
                inspect_workspace(root)

    def test_rejects_enabled_automatic_tasks_fixture(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root, settings={"task.allowAutomaticTasks": "on"})
            with self.assertRaisesRegex(ValueError, "automatic tasks"):
                inspect_workspace(root)


if __name__ == "__main__":
    unittest.main()
