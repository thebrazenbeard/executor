using ExecutorKeeper;

int checks = 0;
void Assert(bool ok, string claim)
{
    if (!ok) throw new Exception("FAIL: " + claim);
    checks++;
}

var now = new DateTimeOffset(2026, 10, 15, 10, 0, 0, TimeSpan.Zero);
var good = new HealthInput(now.AddMinutes(-5), "LOCAL_READY", true, true, true, true, true);
var ok = KeeperHealth.Evaluate(good, now);
Assert(ok.LocalReady, "all local evidence qualified");
Assert(ok.State == "LOCAL_READY", "state is local ready");
Assert(!ok.CloudVerified, "local state never proves cloud");
Assert(ok.Explanation.Contains("NOT been independently checked"), "cloud claim explicitly limited");
var old = KeeperHealth.Evaluate(good with { LastRecoveryAt = now.AddMinutes(-16) }, now);
Assert(!old.LocalReady && old.State == "STATUS_STALE", "stale health does not qualify");
var future = KeeperHealth.Evaluate(good with { LastRecoveryAt = now.AddMinutes(3) }, now);
Assert(!future.LocalReady, "future health does not qualify");
var missing = KeeperHealth.Evaluate(good with { RecoveryTaskPresent = false }, now);
Assert(missing.State == "TASK_MISSING", "missing task fails closed");
var agentMissing = KeeperHealth.Evaluate(good with { DeviceTaskPresent = false }, now);
Assert(!agentMissing.LocalReady, "missing device task does not qualify");
var port = KeeperHealth.Evaluate(good with { DevicePortOpen = false }, now);
Assert(port.State == "LOCAL_DISCONNECTED", "device ingress outage detected");
Assert(!KeeperHealth.Evaluate(good with { LastRecoveryStatus = "BACKOFF" }, now).LocalReady,
    "recovery backoff is not ready");
Assert(!KeeperHealth.Evaluate(good with { LastRecoveryAt = null }, now).LocalReady,
    "missing health timestamp is not ready");
Assert(!KeeperHealth.Evaluate(good with { TlsPortOpen = false }, now).LocalReady,
    "TLS outage disqualifies");
Assert(KeeperHealth.RecoveryTaskName == "Vera-Executor-ControlPlane-Recovery",
    "cannot select arbitrary recovery task");
Console.WriteLine($"KEEPER_TEST_PASS={checks} CLOUD_VERIFIED=false NO_EFFECTS=true");