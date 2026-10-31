# GTAA Mica for Windows

A WinUI 3 window, on Mica, that hosts the React app (`../src`) in WebView2,
Edge's engine. It replaces the Electron shell (`../electron`), which stays
until this one does everything it does (see [Not done yet](#not-done-yet)).

- **The page draws the title bar**, as in Electron: Back, Forward, the panel
  toggle and the window menus (`src/components/title-bar/DesktopTitleBar.tsx`).
  Windows draws its caption buttons over the bar's end. The menus open as
  native WinUI menus, and the rest of the bar drags the window.
- **Help → Check for updates** updates the app from this repository's GitHub
  releases, like jellyflower: only when asked.
- **Sign in** (the account menu, or Settings → Sign in) signs the app in to
  GitHub, because the repository is private. The token is kept in Windows
  Credential Manager and never reaches the page.

## Set up

1. Install the .NET 10 SDK and the Windows App Development CLI:

   ```powershell
   winget install --id Microsoft.DotNet.SDK.10 --exact --source winget
   winget install --id Microsoft.WinAppCli --exact --source winget
   ```

2. Optional, for the XAML designer and the debugger: Visual Studio 2026 with
   the **WinUI application development** workload,
   `winget configure -f https://aka.ms/winui-config` (it also turns on
   Developer Mode, which only packaged apps need; this one isn't).

The WebView2 runtime comes with Windows 11.

## Run it

Against the Vite dev server (hot reload, as `npm run dev:desktop` does for Electron):

```powershell
npm run dev            # in one terminal, at the repo's root
npm run dev:windows    # in another
```

Against the built app, as it ships:

```powershell
npx vite build
dotnet run --project desktop -p:Platform=x64
```

`MICA_DESKTOP_BACKDROP=none` leaves Mica off, as it does for Electron.

Run from source, Help → Check for updates says it only works in the installed
app. To try updating, install a release (below) and update from it.

## One-time: the GitHub App people sign in with

The repository is private, so the app reads its releases as whoever is signed
in. They sign in to a GitHub App that can **only read this repository's
contents**, so the token it gets can't do anything else. Set it up once, as
`mochimilk`:

1. GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**.
   - Name: `GTAA Mica` (any free name). Homepage URL: this repository.
   - **Webhook**: untick *Active*.
   - **Permissions → Repository → Contents: Read-only.** Leave everything else
     at *No access* (Metadata stays read-only; GitHub requires it).
   - **Enable Device Flow**: ticked.
   - **Expire user authorization tokens**: unticked, so sign-ins last until
     revoked (refreshing them would need a secret, which can't ship in an app).
   - **Where can this GitHub App be installed?** Only on this account.
2. Create it, copy its **Client ID** (public, not a secret) into
   `<GitHubClientId>` in [GtaaMica.csproj](GtaaMica.csproj), and commit.
3. **Install App** → only select repositories → `gtaa-mica`.

Until the Client ID is set, Sign in says the build has no GitHub App.

## Release an update

1. Commit what's going out. Make sure `npm run build` passes: the workflow runs it.
2. Tag it and push the tag:

   ```powershell
   git tag v0.3.0
   git push origin v0.3.0
   ```

[`.github/workflows/release.yml`](../.github/workflows/release.yml) builds the
React app and this one, packs them with Velopack, and publishes the
**GTAA Mica 0.3.0** release with `GtaaMica-win-Setup.exe` and the update
packages. Versions come from the tag alone; only `vMAJOR.MINOR.PATCH` tags
release. Drafts and prereleases are never offered as updates.

## Share it with someone

1. Give their GitHub account read access to this repository (Settings →
   Collaborators). Without it, they can't download releases or update.
2. Send them `GtaaMica-win-Setup.exe` from the latest release, or have them
   download it there. It installs for their Windows account only, with no admin
   rights, into `%LocalAppData%\GtaaMica`, and adds a Start menu entry.
   The installer is unsigned, so Windows SmartScreen may warn the first time:
   **More info → Run anyway**.
3. In the app: the account menu → **Sign in** (or Settings → Sign in), then
   enter the code on GitHub's page and approve **GTAA Mica**.
4. From then on, **Help → Check for updates** finds whatever you've released.

They bring their own OpenAI key for Skye, in Settings → API.

## How updating works

- Only when asked (Help → Check for updates): no background checks, no
  notifications.
- It reads this repository's latest stable release as the signed-in account,
  through GitHub's API, with that account's token (from Credential Manager,
  sent to GitHub only). Before that, it checks the account can see the
  repository, so a lost sign-in or missing access is explained plainly.
- Velopack downloads the release's package over HTTPS, checks it against the
  hash in the release's feed, installs it, and restarts the app. A failed or
  cancelled download changes nothing.
- The binaries are unsigned. As with jellyflower, trust rests on HTTPS and on
  this GitHub repository; code signing is a later step.

## Where things are

| | |
| --- | --- |
| Entry point (Velopack first, then WinUI) | [Program.cs](Program.cs) |
| Launch options (`--dev-url`, the backdrop) | [App.xaml.cs](App.xaml.cs) |
| The window: WebView2, what loads, permissions, menus, title bar | [MainWindow.xaml.cs](MainWindow.xaml.cs) |
| The page's bridge: page half, app half | [Bridge/HostBridge.js](Bridge/HostBridge.js), [Bridge/PageBridge.cs](Bridge/PageBridge.cs) |
| GitHub sign-in (device flow) | [GitHub/GitHubSignIn.cs](GitHub/GitHubSignIn.cs) |
| Credential Manager | [Secrets/CredentialStore.cs](Secrets/CredentialStore.cs) |
| Check for updates | [Updates/Updater.cs](Updates/Updater.cs) |
| Version, repository, GitHub App | [AppInfo.cs](AppInfo.cs), [GtaaMica.csproj](GtaaMica.csproj) |

## Not done yet

- **Skye's voice.** Settings → API and Skye's calls still go through Electron's
  main process (`electron/appVoice.mjs`). In this app, the key will be kept in
  Credential Manager (on this computer, for this Windows account), so it
  survives closing the app without ever reaching the page or leaving the
  machine, and the app makes Skye's OpenAI calls itself. Until then, voice here
  needs the broker (`npm run dev:voice`) in development and isn't available in
  the installed app.
- **No Content-Security-Policy** on the built app yet (Electron sets one).
  Navigation is locked to the app's own pages either way.
- **Caption buttons are 48 DIPs tall**, the tallest Windows offers; the page's
  bar is 56, so they sit a little high in it.
- **Unsigned.** See above.
