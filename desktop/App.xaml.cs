using Microsoft.UI.Xaml;

namespace GtaaMica;

/// <summary>
/// The app: one window (MainWindow) hosting the React app. Started with
/// <c>--dev-url=http://127.0.0.1:&lt;port&gt;/</c> it loads the Vite dev server
/// instead of the built app, as electron/main.mjs does; loopback http only.
/// <c>MICA_DESKTOP_BACKDROP=none</c> leaves Mica off, as for Electron.
/// </summary>
public partial class App : Application
{
    private readonly Uri? _devUrl;
    private readonly bool _mica;
    private Window? _window;

    public App(string[] args)
    {
        InitializeComponent();
        _devUrl = DevUrl(args);
        _mica = !string.Equals(Environment.GetEnvironmentVariable("MICA_DESKTOP_BACKDROP")?.Trim(), "none", StringComparison.OrdinalIgnoreCase);
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow(_devUrl, _mica);
        _window.Activate();
    }

    /// <summary>The dev server to load, when asked for one that is loopback http at its root; null otherwise.</summary>
    private static Uri? DevUrl(string[] args)
    {
        const string prefix = "--dev-url=";
        var value = args.FirstOrDefault(arg => arg.StartsWith(prefix, StringComparison.Ordinal))?[prefix.Length..];
        if (value is null) return null;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var url)
            || url.Scheme != Uri.UriSchemeHttp
            || url.Host is not ("127.0.0.1" or "localhost")
            || url.AbsolutePath != "/"
            || !string.IsNullOrEmpty(url.UserInfo))
        {
            throw new ArgumentException("--dev-url must be a loopback http URL at its root, such as http://127.0.0.1:5173/.");
        }
        return url;
    }
}
