# Executor Keeper

This optional standalone .NET 10 Windows tray app supervises the already-installed
Executor connection on Lappy. It does not replace the agent or create credentials.

The app uses the .NET 10 Windows Desktop runtime already installed on Lappy.
All published files must remain together; a single-file self-contained package
was not qualified because its runtime packs were absent offline.

The local probe reads only %LOCALAPPDATA%\Executor\Recovery\health.json,
checks the Windows scheduled recovery and agent task registration, and
tests localhost ports 19887/19888/9443. The status is LOCAL ONLY.
ChatGPT connectivity always requires independent remote-tool verification.

The tray offers Check now, Open status, and explicit manual invocation of
the existing five-minute recovery task. Its recovery action uses fixed
schtasks.exe arguments, never a shell with untrusted input. The existing
scheduled recovery runs automatically independent of Keeper's UI.

Keeper installs per-user as an interactive logon application, not as a
LocalSystem service. It never touches PORTAL, credential material, or
the existing Executor configuration. A local mutex prevents a duplicate
tray owner. Closing the tray does not stop Executor.

Build: dotnet build src/ExecutorKeeper/ExecutorKeeper.csproj -c Release
Test: dotnet run --project tests/ExecutorKeeper.SmokeTests -c Release
Publish: dotnet publish src/ExecutorKeeper/ExecutorKeeper.csproj -c Release
  --self-contained false -p:PublishSingleFile=false -o artifacts/win-x64

Adversarial review (accepted): healthy local ports, a tray icon and a
passing Windows recovery task do not establish authenticated cloud-to-
device connectivity. Keeper reports CloudVerified=false even when
local readiness is true. The separately enabled recovery task can repair
the existing gateway but cannot guarantee availability while Lappy is
powered off, asleep, isolated from the network, or facing upstream outage.
The per-user DPAPI recovery mechanism also cannot guarantee health prior
to interactive sign-in; a boot-time service would require a separately
authorized identity and credential design. No ambiguous effects are replayed.