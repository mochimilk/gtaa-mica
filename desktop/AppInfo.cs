using System.Reflection;

namespace GtaaMica;

/// <summary>
/// What the build says about this app: its version (from the vX.Y.Z tag it
/// was released from), the GitHub repository its releases come from, and the
/// GitHub App people sign in with to read them (GtaaMica.csproj).
/// </summary>
internal static class AppInfo
{
    public const string Name = "GTAA Mica";

    private static readonly Assembly Assembly = typeof(AppInfo).Assembly;

    /// <summary>"0.3.0": the release version, without build metadata; "0.0.0" when run from source.</summary>
    public static string Version { get; } =
        (Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0")
            .Split('+')[0];

    /// <summary>"owner/name" of the repository whose releases are this app's updates.</summary>
    public static string Repository { get; } = Metadata("GitHubRepository") ?? "mochimilk/gtaa-mica";

    public static string RepositoryUrl => $"https://github.com/{Repository}";

    /// <summary>The GitHub App's client ID, public; empty when this build has none.</summary>
    public static string GitHubClientId { get; } = Metadata("GitHubClientId") ?? "";

    private static string? Metadata(string key) =>
        Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(attribute => attribute.Key == key && !string.IsNullOrWhiteSpace(attribute.Value))
            ?.Value;
}
