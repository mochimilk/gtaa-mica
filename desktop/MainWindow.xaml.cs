using System.Runtime.InteropServices;
using System.Text.Json;
using GtaaMica.Bridge;
using GtaaMica.Updates;
using Microsoft.UI;
using Microsoft.UI.Input;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using Microsoft.Web.WebView2.Core;
using Windows.Foundation;
using Windows.Graphics;

namespace GtaaMica;

/// <summary>
/// The window, as electron/main.mjs's: the React app in WebView2, on Mica,
/// its title bar the page's own (DesktopTitleBar). Windows draws the caption
/// buttons over the bar's end; this opens the window menus under the page's
/// buttons as native menus, and keeps the rest of the bar dragging the window
/// from where the page says its buttons are (Bridge/PageBridge.cs).
///
/// Built, the app is served from web\ under https://mica.example (a reserved
/// name, so it can never be a real site); in development, from the Vite dev
/// server. Nothing else loads: other navigation, new windows and every
/// permission but the microphone and clipboard reading, for the app's own
/// pages, are refused.
/// </summary>
public sealed partial class MainWindow : Window
{
    private const string AppHost = "mica.example";

    /// <summary>The window menus the page's title bar opens, by name, in its order.</summary>
    internal static readonly string[] MenuNames = ["file", "edit", "view", "window", "help"];

    private readonly Uri? _devUrl;
    private readonly bool _mica;
    private readonly PageBridge _bridge;
    private readonly Updater _updater;
    private readonly Dictionary<string, MenuFlyout> _menus;

    public MainWindow(Uri? devUrl, bool mica)
    {
        InitializeComponent();
        _devUrl = devUrl;
        _mica = mica;
        _bridge = new PageBridge(this);
        _updater = new Updater(() => Content.XamlRoot, () => OpenSettings("sign-in"));
        _menus = BuildMenus();

        Title = AppInfo.Name;
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "AppIcon.ico"));
        ExtendsContentIntoTitleBar = true;
        AppWindow.TitleBar.PreferredHeightOption = TitleBarHeightOption.Tall;
        if (mica)
        {
            SystemBackdrop = new MicaBackdrop();
            // Clear from the first frame, so Mica shows through where the page is clear.
            Web.DefaultBackgroundColor = Colors.Transparent;
        }
        var scale = Scale;
        AppWindow.Resize(new SizeInt32((int)(1440 * scale), (int)(960 * scale)));
        if (AppWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.PreferredMinimumWidth = (int)(900 * scale);
            presenter.PreferredMinimumHeight = (int)(640 * scale);
        }

        _ = InitializeWebAsync();
    }

    /// <summary>The window's scale: physical pixels per DIP.</summary>
    private double Scale => GetDpiForWindow(WinRT.Interop.WindowNative.GetWindowHandle(this)) / 96.0;

    private async Task InitializeWebAsync()
    {
        var dataFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GtaaMica", "WebView2");
        var environment = await CoreWebView2Environment.CreateWithOptionsAsync(null, dataFolder, new CoreWebView2EnvironmentOptions());
        await Web.EnsureCoreWebView2Async(environment);
        var core = Web.CoreWebView2;

        core.Settings.AreDefaultContextMenusEnabled = false; // The page has its own (DefaultContextMenu).
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;

        if (_devUrl is null)
        {
            core.SetVirtualHostNameToFolderMapping(
                AppHost, Path.Combine(AppContext.BaseDirectory, "web"), CoreWebView2HostResourceAccessKind.Deny);
        }
        core.NavigationStarting += (_, args) =>
        {
            if (!IsAppUri(args.Uri)) args.Cancel = true;
        };
        core.NewWindowRequested += (_, args) => args.Handled = true;
        core.PermissionRequested += (_, args) =>
        {
            var allowed = IsAppUri(args.Uri)
                && args.PermissionKind is CoreWebView2PermissionKind.Microphone or CoreWebView2PermissionKind.ClipboardRead;
            args.State = allowed ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
            args.SavesInProfile = false;
        };
        core.WebMessageReceived += (_, args) => _bridge.Receive(args);

        await core.AddScriptToExecuteOnDocumentCreatedAsync(BridgeScript());
        core.Navigate(_devUrl?.AbsoluteUri ?? $"https://{AppHost}/index.html");
    }

    /// <summary>HostBridge.js, with this window's backdrop and menus filled in.</summary>
    private string BridgeScript()
    {
        using var stream = typeof(MainWindow).Assembly.GetManifestResourceStream("HostBridge.js")
            ?? throw new InvalidOperationException("HostBridge.js is missing from the build.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd()
            .Replace("__MICA_BACKDROP__", _mica ? "\"mica\"" : "null")
            .Replace("__MICA_MENUS__", JsonSerializer.Serialize(MenuNames));
    }

    /// <summary>Whether a URL is one of this app's own pages.</summary>
    internal bool IsAppUri(string? value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return false;
        return _devUrl is not null
            ? uri.Scheme == _devUrl.Scheme && uri.Host == _devUrl.Host && uri.Port == _devUrl.Port
            : uri.Scheme == Uri.UriSchemeHttps && uri.Host == AppHost;
    }

    /// <summary>Tells the page something (HostBridge.js's message listener).</summary>
    internal void Post(object message) =>
        Web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(message, PageBridge.Json));

    /// <summary>Has the page open Settings on <paramref name="page"/> (the account menu's).</summary>
    private void OpenSettings(string page) => Post(new { type = "open-settings", page });

    /* ------------------------------------------------------------ title bar */

    /// <summary>
    /// The page's title bar: <paramref name="height"/> tall, its buttons where
    /// <paramref name="buttons"/> say, in CSS pixels at <paramref name="scale"/>
    /// device pixels each. The bar drags the window; its buttons stay the page's.
    /// </summary>
    internal void SetTitleBar(double height, IReadOnlyList<Rect> buttons, double scale)
    {
        var source = InputNonClientPointerSource.GetForWindowId(AppWindow.Id);
        var bar = new RectInt32(0, 0, AppWindow.ClientSize.Width, (int)Math.Round(height * scale));
        source.SetRegionRects(NonClientRegionKind.Caption, [bar]);
        source.SetRegionRects(NonClientRegionKind.Passthrough, buttons
            .Select(button => new RectInt32(
                (int)Math.Floor(button.X * scale),
                (int)Math.Floor(button.Y * scale),
                (int)Math.Ceiling(button.Width * scale),
                (int)Math.Ceiling(button.Height * scale)))
            .ToArray());
    }

    /* ---------------------------------------------------------------- menus */

    /// <summary>
    /// Opens window menu <paramref name="name"/> with its top left at a point
    /// in the page, in CSS pixels at <paramref name="scale"/> device pixels
    /// each; completes once it closes.
    /// </summary>
    internal Task OpenMenuAsync(string name, double x, double y, double scale)
    {
        if (!_menus.TryGetValue(name, out var menu)) return Task.CompletedTask;
        var closed = new TaskCompletionSource();
        void OnClosed(object? sender, object args)
        {
            menu.Closed -= OnClosed;
            closed.TrySetResult();
        }
        menu.Closed += OnClosed;
        var dips = scale / Scale;
        menu.ShowAt(Web, new FlyoutShowOptions
        {
            Position = new Point(x * dips, y * dips),
            ShowMode = FlyoutShowMode.Standard,
        });
        return closed.Task;
    }

    private Dictionary<string, MenuFlyout> BuildMenus() => new()
    {
        ["file"] = Menu(Item("Exit", Close)),
        ["edit"] = Menu(
            Item("Undo", () => Edit("undo"), "Ctrl+Z"),
            Item("Redo", () => Edit("redo"), "Ctrl+Y"),
            new MenuFlyoutSeparator(),
            Item("Cut", () => Edit("cut"), "Ctrl+X"),
            Item("Copy", () => Edit("copy"), "Ctrl+C"),
            Item("Paste", () => Edit("paste"), "Ctrl+V"),
            Item("Delete", () => Edit("delete"), "Del"),
            new MenuFlyoutSeparator(),
            Item("Select all", () => Edit("selectAll"), "Ctrl+A")),
        ["view"] = Menu(
            Item("Reload", () => Web.CoreWebView2?.Reload(), "Ctrl+R"),
            Item("Developer tools", () => Web.CoreWebView2?.OpenDevToolsWindow(), "Ctrl+Shift+I"),
            new MenuFlyoutSeparator(),
            Item("Full screen", ToggleFullScreen)),
        ["window"] = Menu(
            Item("Minimize", () => (AppWindow.Presenter as OverlappedPresenter)?.Minimize()),
            Item("Maximize", ToggleMaximized),
            new MenuFlyoutSeparator(),
            Item("Close", Close)),
        ["help"] = Menu(
            Item("Check for updates…", () => _ = _updater.CheckAsync()),
            new MenuFlyoutSeparator(),
            Item("Releases on GitHub", () => _ = Windows.System.Launcher.LaunchUriAsync(new Uri($"{AppInfo.RepositoryUrl}/releases"))),
            new MenuFlyoutItem { Text = $"{AppInfo.Name} {AppInfo.Version}", IsEnabled = false }),
    };

    private static MenuFlyout Menu(params MenuFlyoutItemBase[] items)
    {
        var menu = new MenuFlyout();
        foreach (var item in items) menu.Items.Add(item);
        return menu;
    }

    private static MenuFlyoutItem Item(string text, Action run, string? keys = null)
    {
        var item = new MenuFlyoutItem { Text = text };
        if (keys is not null) item.KeyboardAcceleratorTextOverride = keys;
        item.Click += (_, _) => run();
        return item;
    }

    /// <summary>
    /// Runs an editing command where the page's focus is, as its shortcut
    /// would: the page's title bar buttons leave focus where it was.
    /// </summary>
    private void Edit(string command)
    {
        var core = Web.CoreWebView2;
        if (core is null) return;
        Web.Focus(FocusState.Programmatic);
        var key = JsonSerializer.Serialize(new { type = "rawKeyDown", commands = new[] { command } });
        _ = core.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", key);
    }

    private void ToggleMaximized()
    {
        if (AppWindow.Presenter is not OverlappedPresenter presenter) return;
        if (presenter.State == OverlappedPresenterState.Maximized) presenter.Restore();
        else presenter.Maximize();
    }

    private void ToggleFullScreen() =>
        AppWindow.SetPresenter(AppWindow.Presenter.Kind == AppWindowPresenterKind.FullScreen
            ? AppWindowPresenterKind.Overlapped
            : AppWindowPresenterKind.FullScreen);

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr hwnd);
}
