using System.Net.Http.Headers;

namespace GtaaMica.GitHub;

/// <summary>
/// The one HTTP client for GitHub: it names this app and its version, as
/// GitHub's API requires, asks for JSON, and gives up after 20 seconds.
/// Tokens are added per request, never to the client.
/// </summary>
internal static class GitHubHttp
{
    public static HttpClient Client { get; } = Create();

    private static HttpClient Create()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("GTAA-Mica", AppInfo.Version));
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        client.DefaultRequestHeaders.Add("X-GitHub-Api-Version", "2022-11-28");
        return client;
    }
}
