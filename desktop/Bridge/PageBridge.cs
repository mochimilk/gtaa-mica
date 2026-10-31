using System.Text.Json;
using GtaaMica.GitHub;
using Microsoft.Web.WebView2.Core;
using Windows.Foundation;

namespace GtaaMica.Bridge;

/// <summary>
/// The app's half of the page's bridge (HostBridge.js): each message the page
/// sends, checked and answered. Only the app's own pages are listened to, and
/// only for what HostBridge.js offers; anything else is dropped. Nothing
/// secret is ever sent back: GitHub's sign-in answers with the login alone.
/// </summary>
internal sealed class PageBridge(MainWindow window)
{
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly GitHubSignIn _gitHub = new();
    private string? _verificationUri;

    public async void Receive(CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!window.IsAppUri(args.Source)) return;
        JsonElement message;
        try
        {
            message = JsonDocument.Parse(args.WebMessageAsJson).RootElement;
        }
        catch (JsonException)
        {
            return;
        }
        if (message.ValueKind != JsonValueKind.Object
            || !message.TryGetProperty("method", out var methodValue)
            || methodValue.ValueKind != JsonValueKind.String
            || !message.TryGetProperty("id", out var idValue)
            || !idValue.TryGetInt32(out var id))
        {
            return;
        }
        var method = methodValue.GetString();
        var input = message.TryGetProperty("args", out var argsValue) ? argsValue : default;

        object? result;
        try
        {
            result = await HandleAsync(method, input);
        }
        catch (Exception error)
        {
            if (id != 0) window.Post(new { type = "reply", id, error = Describe(error) });
            return;
        }
        if (id != 0) window.Post(new { type = "reply", id, result });
    }

    private async Task<object?> HandleAsync(string? method, JsonElement input)
    {
        switch (method)
        {
            case "window.openMenu":
            {
                var name = String(input, "name");
                if (name is null || !MainWindow.MenuNames.Contains(name)) return null;
                await window.OpenMenuAsync(name, Number(input, "x"), Number(input, "y"), Scale(input));
                return null;
            }
            case "window.setTitleBar":
            {
                var buttons = input.ValueKind == JsonValueKind.Object
                    && input.TryGetProperty("buttons", out var list)
                    && list.ValueKind == JsonValueKind.Array
                        ? list.EnumerateArray().Take(64).Select(button => new Rect(
                            Number(button, "x"), Number(button, "y"), Number(button, "width"), Number(button, "height"))).ToList()
                        : [];
                window.SetTitleBar(Math.Clamp(Number(input, "height"), 0, 200), buttons, Scale(input));
                return null;
            }
            case "github.account":
            {
                var login = GitHubSignIn.Login;
                return login is null ? null : new { login };
            }
            case "github.startSignIn":
            {
                var code = await _gitHub.StartAsync();
                _verificationUri = code.VerificationUri;
                return code;
            }
            case "github.finishSignIn":
            {
                var outcome = await _gitHub.FinishAsync();
                return outcome.Login is not null ? new { login = outcome.Login } : new { error = outcome.Error };
            }
            case "github.cancelSignIn":
                _gitHub.Cancel();
                return null;
            case "github.openVerification":
                if (_verificationUri is not null) await Windows.System.Launcher.LaunchUriAsync(new Uri(_verificationUri));
                return null;
            case "github.signOut":
                _gitHub.SignOut();
                return null;
            default:
                return null;
        }
    }

    /// <summary>What the page is told went wrong: a message for the user, never a stack.</summary>
    private static string Describe(Exception error) => error switch
    {
        HttpRequestException => "GitHub couldn't be reached. Check your connection and try again.",
        InvalidOperationException => error.Message,
        _ => "Something went wrong in the app.",
    };

    private static string? String(JsonElement input, string key) =>
        input.ValueKind == JsonValueKind.Object && input.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    /// <summary>A finite number in the message, or 0.</summary>
    private static double Number(JsonElement input, string key) =>
        input.ValueKind == JsonValueKind.Object
        && input.TryGetProperty(key, out var value)
        && value.ValueKind == JsonValueKind.Number
        && value.TryGetDouble(out var number)
        && double.IsFinite(number)
            ? number
            : 0;

    /// <summary>The page's device pixels per CSS pixel, within reason; 1 when it doesn't say.</summary>
    private static double Scale(JsonElement input)
    {
        var scale = Number(input, "scale");
        return scale is > 0.25 and < 8 ? scale : 1;
    }
}
