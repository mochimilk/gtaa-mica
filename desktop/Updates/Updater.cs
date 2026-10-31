using System.Net;
using System.Net.Http.Headers;
using GtaaMica.GitHub;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Velopack;
using Velopack.Sources;

namespace GtaaMica.Updates;

/// <summary>
/// Help → Check for updates, after jellyflower's: only when asked, never in
/// the background. The repository's latest stable GitHub release is the
/// update (drafts and prereleases are left out); Velopack downloads its
/// package, checks it against the release's hashes, installs it and starts
/// the new version. The repository is private, so it is read as the
/// signed-in GitHub account (GitHub/GitHubSignIn.cs), whose token is sent to
/// GitHub and nowhere else.
/// </summary>
internal sealed class Updater(Func<XamlRoot> root, Action openSignIn)
{
    private bool _busy;

    public async Task CheckAsync()
    {
        if (_busy) return;
        _busy = true;
        try
        {
            await CheckOnceAsync();
        }
        catch (Exception)
        {
            // Nothing is installed unless every step succeeded; an unexpected
            // failure (a dialog that couldn't open) leaves the app as it was.
        }
        finally
        {
            _busy = false;
        }
    }

    private async Task CheckOnceAsync()
    {
        var token = GitHubSignIn.Token;
        var manager = new UpdateManager(new GithubSource(AppInfo.RepositoryUrl, token, prerelease: false));
        if (!manager.IsInstalled)
        {
            await TellAsync("Updates come with the installed app",
                $"This copy (version {AppInfo.Version}) was run from source, so it doesn't update itself. Install it from a release to get updates.");
            return;
        }
        if (token is null)
        {
            if (await AskAsync("Sign in to check for updates",
                    "Updates come from the app's private GitHub repository, so sign in with a GitHub account that can see it.",
                    "Sign in"))
            {
                openSignIn();
            }
            return;
        }

        using var cancel = new CancellationTokenSource();
        var checking = Progress("Checking for updates", "Asking GitHub for the latest release…", cancel);
        UpdateInfo? update;
        try
        {
            var access = await AccessAsync(token, cancel.Token);
            if (access is not null)
            {
                checking.Hide();
                await checking.Shown;
                if (await AskAsync("Can't check for updates", access, "Sign in again")) openSignIn();
                return;
            }
            update = await manager.CheckForUpdatesAsync();
        }
        catch (Exception) when (cancel.IsCancellationRequested)
        {
            return;
        }
        catch (Exception)
        {
            checking.Hide();
            await checking.Shown;
            await TellAsync("Can't check for updates", "GitHub couldn't be reached. Check your connection and try again.");
            return;
        }
        checking.Hide();
        await checking.Shown;

        if (update is null)
        {
            await TellAsync("You're up to date", $"{AppInfo.Name} {AppInfo.Version} is the latest version.");
            return;
        }
        var version = update.TargetFullRelease.Version.ToString();
        if (!await AskAsync($"Version {version} is available",
                $"You have {AppInfo.Version}. {AppInfo.Name} will close, install {version} and open again.",
                "Update and restart"))
        {
            return;
        }

        using var downloading = new CancellationTokenSource();
        var progress = Progress($"Downloading {version}", "Starting…", downloading);
        try
        {
            await manager.DownloadUpdatesAsync(update, percent =>
                progress.Dialog.DispatcherQueue.TryEnqueue(() => progress.Status.Text = $"{percent}%"), downloading.Token);
        }
        catch (Exception) when (downloading.IsCancellationRequested)
        {
            return;
        }
        catch (Exception)
        {
            progress.Hide();
            await progress.Shown;
            await TellAsync("The update didn't download", "Nothing was changed. Try again in a moment.");
            return;
        }
        progress.Status.Text = "Installing…";
        manager.ApplyUpdatesAndRestart(update.TargetFullRelease);
    }

    /// <summary>
    /// Whether the signed-in account can read the repository: null when it
    /// can, otherwise what to tell the user. Asked before Velopack is, so a
    /// lost sign-in or missing access is explained rather than reported as a
    /// failure to reach GitHub.
    /// </summary>
    private static async Task<string?> AccessAsync(string token, CancellationToken cancel)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"https://api.github.com/repos/{AppInfo.Repository}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await GitHubHttp.Client.SendAsync(request, cancel);
        return response.StatusCode switch
        {
            HttpStatusCode.OK => null,
            HttpStatusCode.Unauthorized =>
                "Your GitHub sign-in has expired or was revoked. Sign in again.",
            HttpStatusCode.Forbidden or HttpStatusCode.NotFound =>
                $"Your GitHub account can't see {AppInfo.Repository}. Ask whoever shared the app to give you access, or sign in with another account.",
            _ => throw new HttpRequestException($"GitHub answered {(int)response.StatusCode}."),
        };
    }

    private sealed record ProgressDialog(ContentDialog Dialog, TextBlock Status, Task Shown)
    {
        public void Hide() => Dialog.Hide();
    }

    /// <summary>A dialog with a spinner while something runs; Cancel cancels it.</summary>
    private ProgressDialog Progress(string title, string status, CancellationTokenSource cancel)
    {
        var text = new TextBlock { Text = status, TextWrapping = TextWrapping.Wrap };
        var dialog = new ContentDialog
        {
            XamlRoot = root(),
            Title = title,
            Content = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 12,
                Children = { new ProgressRing { IsActive = true, Width = 20, Height = 20 }, text },
            },
            CloseButtonText = "Cancel",
        };
        dialog.CloseButtonClick += (_, _) => cancel.Cancel();
        return new ProgressDialog(dialog, text, dialog.ShowAsync().AsTask());
    }

    private async Task TellAsync(string title, string message) =>
        await new ContentDialog
        {
            XamlRoot = root(),
            Title = title,
            Content = new TextBlock { Text = message, TextWrapping = TextWrapping.Wrap },
            CloseButtonText = "OK",
            DefaultButton = ContentDialogButton.Close,
        }.ShowAsync();

    private async Task<bool> AskAsync(string title, string message, string action) =>
        await new ContentDialog
        {
            XamlRoot = root(),
            Title = title,
            Content = new TextBlock { Text = message, TextWrapping = TextWrapping.Wrap },
            PrimaryButtonText = action,
            CloseButtonText = "Not now",
            DefaultButton = ContentDialogButton.Primary,
        }.ShowAsync() == ContentDialogResult.Primary;
}
