using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using GtaaMica.Secrets;

namespace GtaaMica.GitHub;

/// <summary>
/// Signing in to GitHub, so this app can read its private repository's
/// releases (Updates/Updater.cs). GitHub's device flow: GitHub gives a short
/// code, the user enters it at github.com/login/device and approves this
/// app's GitHub App there, and this polls, as often as GitHub allows, until
/// they have, they decline, or the code expires. No client secret is needed
/// or shipped. The token goes into Credential Manager under the account's
/// login; the page is only ever told the login.
///
/// The GitHub App is read-only on the repository's contents, and its tokens
/// can't reach anything the person signing in can't, so a token can read
/// this app's releases and nothing else.
/// </summary>
internal sealed class GitHubSignIn
{
    private const string CredentialName = "github";

    public sealed record DeviceCode(string UserCode, string VerificationUri, int ExpiresInSeconds);

    /// <summary>Signed in as <see cref="Login"/>, or not, and why.</summary>
    public sealed record Result(string? Login, string? Error);

    private sealed record Pending(string DeviceCode, int IntervalSeconds, DateTimeOffset ExpiresAt, CancellationTokenSource Cancel);

    private Pending? _pending;

    /// <summary>Who is signed in, or null. Read from Credential Manager; nothing is asked of GitHub.</summary>
    public static string? Login => CredentialStore.Read(CredentialName)?.UserName;

    /// <summary>The signed-in account's token, for GitHub API calls made here, never handed on.</summary>
    public static string? Token => CredentialStore.Read(CredentialName)?.Secret;

    /// <summary>Starts a device sign-in, in place of one still waiting.</summary>
    public async Task<DeviceCode> StartAsync()
    {
        if (string.IsNullOrEmpty(AppInfo.GitHubClientId))
        {
            throw new InvalidOperationException("This build has no GitHub App to sign in with (GitHubClientId in GtaaMica.csproj).");
        }
        Cancel();
        using var response = await GitHubHttp.Client.PostAsync(
            "https://github.com/login/device/code",
            new FormUrlEncodedContent(new Dictionary<string, string> { ["client_id"] = AppInfo.GitHubClientId }));
        response.EnsureSuccessStatusCode();
        var code = await response.Content.ReadFromJsonAsync<DeviceCodeResponse>()
            ?? throw new InvalidOperationException("GitHub returned no device code.");
        // Only ever GitHub's own page is opened for it.
        if (!Uri.TryCreate(code.VerificationUri, UriKind.Absolute, out var page)
            || page.Scheme != Uri.UriSchemeHttps
            || page.Host != "github.com")
        {
            throw new InvalidOperationException("GitHub returned an unexpected sign-in page.");
        }
        _pending = new Pending(
            code.DeviceCode,
            Math.Max(code.Interval, 5),
            DateTimeOffset.UtcNow.AddSeconds(code.ExpiresIn),
            new CancellationTokenSource());
        return new DeviceCode(code.UserCode, page.AbsoluteUri, code.ExpiresIn);
    }

    /// <summary>Waits for the device sign-in started last to be approved, declined, cancelled or to expire.</summary>
    public async Task<Result> FinishAsync()
    {
        var pending = _pending;
        if (pending is null) return new Result(null, "Start signing in first.");
        var interval = pending.IntervalSeconds;
        try
        {
            while (true)
            {
                await Task.Delay(TimeSpan.FromSeconds(interval), pending.Cancel.Token);
                if (DateTimeOffset.UtcNow >= pending.ExpiresAt) return new Result(null, "The code expired. Sign in again to get a new one.");

                TokenResponse? token;
                try
                {
                    using var response = await GitHubHttp.Client.PostAsync(
                        "https://github.com/login/oauth/access_token",
                        new FormUrlEncodedContent(new Dictionary<string, string>
                        {
                            ["client_id"] = AppInfo.GitHubClientId,
                            ["device_code"] = pending.DeviceCode,
                            ["grant_type"] = "urn:ietf:params:oauth:grant-type:device_code",
                        }),
                        pending.Cancel.Token);
                    token = await response.Content.ReadFromJsonAsync<TokenResponse>(pending.Cancel.Token);
                }
                catch (HttpRequestException)
                {
                    // A dropped connection mid-wait: ask again next time round.
                    continue;
                }

                if (!string.IsNullOrEmpty(token?.AccessToken))
                {
                    var login = await LoginForAsync(token.AccessToken, pending.Cancel.Token);
                    CredentialStore.Write(CredentialName, login, token.AccessToken);
                    return new Result(login, null);
                }
                switch (token?.Error)
                {
                    case "authorization_pending":
                        continue;
                    case "slow_down":
                        interval = Math.Max(interval + 5, token.Interval);
                        continue;
                    case "expired_token":
                        return new Result(null, "The code expired. Sign in again to get a new one.");
                    case "access_denied":
                        return new Result(null, "Sign-in was declined on GitHub.");
                    case "device_flow_disabled":
                        return new Result(null, "This app's GitHub App doesn't allow device sign-in yet. Turn on \"Enable Device Flow\" in its settings.");
                    default:
                        return new Result(null, "GitHub didn't accept the sign-in. Try again.");
                }
            }
        }
        catch (OperationCanceledException)
        {
            return new Result(null, "Sign-in cancelled.");
        }
        finally
        {
            if (ReferenceEquals(_pending, pending)) _pending = null;
        }
    }

    /// <summary>Stops a sign-in still waiting.</summary>
    public void Cancel()
    {
        _pending?.Cancel.Cancel();
        _pending = null;
    }

    /// <summary>Forgets the signed-in account on this computer.</summary>
    public void SignOut()
    {
        Cancel();
        CredentialStore.Delete(CredentialName);
    }

    private static async Task<string> LoginForAsync(string token, CancellationToken cancel)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.github.com/user");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await GitHubHttp.Client.SendAsync(request, cancel);
        response.EnsureSuccessStatusCode();
        var user = await response.Content.ReadFromJsonAsync<UserResponse>(cancel);
        return user?.Login ?? throw new InvalidOperationException("GitHub returned no account.");
    }

    private sealed record DeviceCodeResponse(
        [property: JsonPropertyName("device_code")] string DeviceCode,
        [property: JsonPropertyName("user_code")] string UserCode,
        [property: JsonPropertyName("verification_uri")] string VerificationUri,
        [property: JsonPropertyName("expires_in")] int ExpiresIn,
        [property: JsonPropertyName("interval")] int Interval);

    private sealed record TokenResponse(
        [property: JsonPropertyName("access_token")] string? AccessToken,
        [property: JsonPropertyName("error")] string? Error,
        [property: JsonPropertyName("interval")] int Interval);

    private sealed record UserResponse([property: JsonPropertyName("login")] string? Login);
}
