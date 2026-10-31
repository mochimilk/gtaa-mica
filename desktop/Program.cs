using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Velopack;

namespace GtaaMica;

/// <summary>
/// The app's entry point, in place of the one XAML would generate
/// (DISABLE_XAML_GENERATED_MAIN): Velopack has to run first, as it installs,
/// updates and uninstalls by starting this same executable with its own
/// arguments, and exits before any window when it does.
/// </summary>
public static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        VelopackApp.Build().Run();

        WinRT.ComWrappersSupport.InitializeComWrappers();
        Application.Start(start =>
        {
            var context = new DispatcherQueueSynchronizationContext(DispatcherQueue.GetForCurrentThread());
            SynchronizationContext.SetSynchronizationContext(context);
            _ = new App(args);
        });
    }
}
