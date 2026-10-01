# Executor provenance

Executor is built from verified donor work and full Desktop Commander workstation semantics.

Donor heads used for V1:

- `thebrazenbeard/workbridgecommander@c2b95be79ca011a539c20bfee60fcbc46cfea177`
- `thebrazenbeard/workbridge@e88e14ea25f25abd723bb50909b3e25e67f889fd`
- `thebrazenbeard/WorkBridgeMCP@f091f6be6e85f489e3e7839e10612204b89a4a9e`
- `desktop-commander/remote-desktop-commander@b480501dcca59f802ebaf97f2f57b45252d0b720` as product/UX reference

The WorkBridgeMCP donor material pins `wonderwhy-er/DesktopCommanderMCP@550a0b3e31da18b7cf25e87ed840e3d953b6da42`, package version `0.2.51`, under MIT.

Executor preserves the full Desktop Commander workstation semantics. The bounded WorkBridge executable-grant runtime is intentionally excluded.

Transport readiness reference:

- `openai/tunnel-client@c8aeedec334db55bbd69bb16db6b71276993d708` — `/readyz` and `HEALTH_URL_FILE` behavior used by Executor's Windows runtime status path.

Hermetic qualification/install bootstrap:

- Executor ports only the pinned ripgrep-cache bootstrap from `WorkBridgeMCP@f091f6be6e85f489e3e7839e10612204b89a4a9e`: `@vscode/ripgrep` package cache `1.17.0`, release `v15.0.0`, with architecture-specific SHA-256 verification before rebuild. The WorkBridge bounded process overlay is not imported.
