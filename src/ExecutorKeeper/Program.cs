using System.Drawing;
using System.Text.Json;
using System.Windows.Forms;

namespace ExecutorKeeper;

internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        if (args.Contains("--status", StringComparer.OrdinalIgnoreCase))
        {
            var status = KeeperHealth.ProbeAsync(KeeperHealth.DefaultRoot)
                .GetAwaiter().GetResult();
            Console.WriteLine(JsonSerializer.Serialize(status));
            return status.LocalReady ? 0 : 2;
        }
        if (args.Length > 0)
        {
            Console.Error.WriteLine("Supported modes: --status or no arguments (system tray).");
            return 64;
        }

        // One UI owner per user session. This mutex never owns the Executor
        // control plane and cannot block its existing scheduled recovery task.
        using var single = new Mutex(true, "Local\\ExecutorKeeperTrayV1", out bool owner);
        if (!owner) return 0;
        ApplicationConfiguration.Initialize();
        Application.Run(new KeeperForm());
        return 0;
    }
}

internal sealed class KeeperForm : Form
{
    private readonly NotifyIcon _tray;
    private readonly System.Windows.Forms.Timer _timer;
    private readonly Label _status;
    private readonly Label _detail;
    private readonly Label _updated;
    private readonly Button _refresh;
    private readonly Button _repair;
    private readonly string _runtime = KeeperHealth.DefaultRoot;
    private bool _exiting;
    private bool _probing;

    public KeeperForm()
    {
        Text = "Executor Keeper · Lappy";
        Width = 640; Height = 420;
        MinimumSize = new Size(600, 400);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(19, 25, 35);
        ForeColor = Color.FromArgb(226, 232, 240);
        Font = new Font("Segoe UI", 10f);
        ShowInTaskbar = false;

        var header = new Label {
            Text = "Executor Keeper", Left = 32, Top = 26,
            Width = 550, Height = 42,
            Font = new Font("Segoe UI", 22f, FontStyle.Bold)
        };
        _status = new Label {
            Text = "Checking local Executor…", Left = 34, Top = 92,
            Width = 550, Height = 32,
            Font = new Font("Segoe UI", 14f, FontStyle.Bold)
        };
        _detail = new Label {
            Text = "Remote ChatGPT verification is separate from local checks.",
            Left = 34, Top = 142, Width = 555, Height = 95
        };
        _updated = new Label {
            Text = "Pending first check", Left = 34, Top = 256,
            Width = 555, Height = 42,
            ForeColor = Color.FromArgb(157, 175, 197)
        };
        _refresh = MakeButton("Check now", 34, 314, 175);
        _repair = MakeButton("Run existing recovery", 224, 314, 255);
        _refresh.Click += async (_, _) => await RefreshStatus();
        _repair.Click += async (_, _) => await Repair();
        Controls.AddRange([header, _status, _detail, _updated, _refresh, _repair]);

        var menu = new ContextMenuStrip();
        menu.Items.Add("Open status", null, (_, _) => ShowStatus());
        menu.Items.Add("Check now", null, async (_, _) => await RefreshStatus());
        menu.Items.Add("Run existing recovery task", null, async (_, _) => await Repair());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit Keeper tray (not Executor)", null, (_, _) => {
            _exiting = true;
            if (_tray is { } tray) tray.Visible = false;
            Close();
        });
        _tray = new NotifyIcon {
            Icon = SystemIcons.Information,
            Text = "Executor Keeper · checking",
            Visible = true,
            ContextMenuStrip = menu
        };
        _tray.DoubleClick += (_, _) => ShowStatus();

        _timer = new System.Windows.Forms.Timer { Interval = 60_000 };
        _timer.Tick += async (_, _) => await RefreshStatus();
        _timer.Start();
    }

    private Button MakeButton(string text, int left, int top, int width)
    {
        return new Button {
            Text = text, Left = left, Top = top, Width = width, Height = 38,
            BackColor = Color.FromArgb(45, 62, 85),
            ForeColor = Color.White, FlatStyle = FlatStyle.Flat
        };
    }

    private void ShowStatus()
    {
        Show(); WindowState = FormWindowState.Normal; ShowInTaskbar = true;
        Activate();
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        BeginInvoke(() => { Hide(); ShowInTaskbar = false; });
        _ = RefreshStatus();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!_exiting && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            ShowInTaskbar = false;
            return;
        }
        base.OnFormClosing(e);
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _timer.Stop();
        _timer.Dispose();
        _tray.Dispose();
        base.OnFormClosed(e);
    }

    private async Task RefreshStatus()
    {
        if (_probing) return;
        _probing = true;
        _refresh.Enabled = false;
        try
        {
            var state = await KeeperHealth.ProbeAsync(_runtime);
            var title = state.State switch {
                "LOCAL_READY" => "Local Executor ready",
                "TASK_MISSING" => "Recovery configuration incomplete",
                "LOCAL_DISCONNECTED" => "Local Executor disconnected",
                _ => "Connection not qualified"
            };
            _status.Text = title;
            _status.ForeColor = state.LocalReady ? Color.FromArgb(96, 210, 150) :
                Color.FromArgb(255, 190, 95);
            _detail.Text = state.Explanation + Environment.NewLine +
                $"Gateway: {(state.McpPortOpen ? "up" : "down")} | " +
                $"Device: {(state.DevicePortOpen ? "up" : "down")} | " +
                $"TLS: {(state.TlsPortOpen ? "up" : "down")}" + Environment.NewLine +
                "No credentials are displayed or stored by this app.";
            _updated.Text = $"Checked {state.CheckedAt.ToLocalTime():g} · " +
                $"Recovery record: {(state.LastRecoveryAt?.ToLocalTime().ToString("g") ?? "missing")}" +
                Environment.NewLine + "ChatGPT connection: not independently checked here";
            _tray.Icon = state.LocalReady ? SystemIcons.Information : SystemIcons.Warning;
            _tray.Text = state.LocalReady ? "Executor Keeper: local ready" :
                "Executor Keeper: local needs attention";
        }
        catch (Exception)
        {
            _status.Text = "Health read failed";
            _detail.Text = "Local health probe failed. No automatic commands were replayed.";
            _tray.Icon = SystemIcons.Error;
            _tray.Text = "Executor Keeper: check failed";
        }
        finally { _probing = false; _refresh.Enabled = true; }
    }

    private async Task Repair()
    {
        var confirmation = MessageBox.Show(
            this,
            "Request the EXISTING Windows recovery task now? This may restart " +
            "Executor's gateway, but does not restart PORTAL or change credentials.",
            "Executor Keeper", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        if (confirmation != DialogResult.Yes) return;
        _repair.Enabled = false;
        try
        {
            bool accepted = await KeeperHealth.RequestExistingRecovery();
            _detail.Text = accepted
                ? "Windows accepted the existing recovery task. Checking again…"
                : "Windows did not accept the recovery-task request.";
            await Task.Delay(1700);
            await RefreshStatus();
        }
        finally { _repair.Enabled = true; }
    }
}