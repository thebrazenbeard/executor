using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;

namespace ExecutorKeeper;

public sealed record HealthInput(
    DateTimeOffset? LastRecoveryAt,
    string? LastRecoveryStatus,
    bool McpPortOpen,
    bool DevicePortOpen,
    bool TlsPortOpen,
    bool RecoveryTaskPresent,
    bool DeviceTaskPresent);

public sealed record KeeperStatus(
    string State,
    string Explanation,
    bool LocalReady,
    bool CloudVerified,
    DateTimeOffset CheckedAt,
    DateTimeOffset? LastRecoveryAt,
    string? LastRecoveryStatus,
    bool RecoveryTaskPresent,
    bool DeviceTaskPresent,
    bool McpPortOpen,
    bool DevicePortOpen,
    bool TlsPortOpen);

public static class KeeperHealth
{
    public const string RecoveryTaskName = "Vera-Executor-ControlPlane-Recovery";
    public const string DeviceTaskName = "Executor Device";
    public const string HealthFile = "Recovery/health.json";

    // A five-minute existing scheduler interval plus headroom for slow starts.
    public static KeeperStatus Evaluate(HealthInput input, DateTimeOffset now)
    {
        bool fresh = input.LastRecoveryAt is { } at &&
            at <= now.AddMinutes(2) && at >= now.AddMinutes(-15);
        bool ports = input.McpPortOpen && input.DevicePortOpen && input.TlsPortOpen;
        bool ready = fresh && input.LastRecoveryStatus == "LOCAL_READY" &&
            ports && input.RecoveryTaskPresent && input.DeviceTaskPresent;
        string explanation;
        string state;
        if (ready)
        {
            state = "LOCAL_READY";
            explanation = "Local gateway and existing recovery tasks respond. " +
                "ChatGPT-side route has NOT been independently checked by this app.";
        }
        else if (!input.RecoveryTaskPresent || !input.DeviceTaskPresent)
        {
            state = "TASK_MISSING";
            explanation = "An existing Executor launch/recovery task is missing. " +
                "No task or credential has been created by Keeper.";
        }
        else if (!ports)
        {
            state = "LOCAL_DISCONNECTED";
            explanation = "One or more local Executor ports are unavailable; " +
                "the existing five-minute recovery task handles automatic repair.";
        }
        else
        {
            state = "STATUS_STALE";
            explanation = "Local ports are open but the recovery status is stale or unqualified. " +
                "An open port alone does not establish a working remote connection.";
        }
        return new KeeperStatus(
            state, explanation, ready, false, now,
            input.LastRecoveryAt, input.LastRecoveryStatus,
            input.RecoveryTaskPresent, input.DeviceTaskPresent,
            input.McpPortOpen, input.DevicePortOpen, input.TlsPortOpen);
    }

    public static string DefaultRoot =>
        Path.Combine(Environment.GetFolderPath(
            Environment.SpecialFolder.LocalApplicationData), "Executor");

    public static async Task<KeeperStatus> ProbeAsync(
        string root, CancellationToken cancellation = default)
    {
        var now = DateTimeOffset.UtcNow;
        DateTimeOffset? recorded = null;
        string? status = null;
        try
        {
            string path = Path.Combine(root, "Recovery", "health.json");
            using var document = JsonDocument.Parse(await File.ReadAllTextAsync(path, cancellation));
            var element = document.RootElement;
            if (element.TryGetProperty("time_utc", out var stamp) &&
                DateTimeOffset.TryParse(stamp.GetString(), out var parsed))
                recorded = parsed;
            if (element.TryGetProperty("status", out var value))
                status = value.GetString();
        }
        catch (Exception error) when (
            error is IOException or UnauthorizedAccessException or JsonException or
            InvalidOperationException or FormatException)
        {
            // Failure is represented as an unqualified or stale observation.
        }

        var ports = await Task.WhenAll(
            PortOpen(19887, cancellation), PortOpen(19888, cancellation),
            PortOpen(9443, cancellation));
        bool recovery = await TaskExists(RecoveryTaskName, cancellation);
        bool device = await TaskExists(DeviceTaskName, cancellation);
        return Evaluate(new HealthInput(recorded, status,
            ports[0], ports[1], ports[2], recovery, device), now);
    }

    private static async Task<bool> PortOpen(int port, CancellationToken cancellation)
    {
        try
        {
            using var tcp = new TcpClient();
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            timeout.CancelAfter(TimeSpan.FromMilliseconds(700));
            await tcp.ConnectAsync(IPAddress.Loopback, port, timeout.Token);
            return tcp.Connected;
        }
        catch (Exception exception) when (
            exception is SocketException or OperationCanceledException or IOException)
        {
            return false;
        }
    }

    public static Task<bool> TaskExists(string task, CancellationToken cancellation = default) =>
        ExecuteTaskCommand("/Query", task, cancellation);

    // Never use a PowerShell script, command shell, or arbitrary user-supplied program.
    // Clicking Repair requests ONLY the existing Windows Task Scheduler recovery task.
    public static Task<bool> RequestExistingRecovery(CancellationToken cancellation = default) =>
        ExecuteTaskCommand("/Run", RecoveryTaskName, cancellation);

    private static async Task<bool> ExecuteTaskCommand(
        string operation, string task, CancellationToken cancellation)
    {
        using var child = new Process {
            StartInfo = new ProcessStartInfo(
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                    "schtasks.exe"))
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            }
        };
        child.StartInfo.ArgumentList.Add(operation);
        child.StartInfo.ArgumentList.Add("/TN");
        child.StartInfo.ArgumentList.Add(task);
        try
        {
            if (!child.Start()) return false;
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            timeout.CancelAfter(TimeSpan.FromSeconds(6));
            await child.WaitForExitAsync(timeout.Token);
            return child.ExitCode == 0;
        }
        catch (Exception error) when (
            error is System.ComponentModel.Win32Exception or
            OperationCanceledException or InvalidOperationException)
        {
            try { if (!child.HasExited) child.Kill(entireProcessTree: true); }
            catch (InvalidOperationException) { }
            return false;
        }
    }
}