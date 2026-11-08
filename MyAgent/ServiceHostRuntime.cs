using System.Runtime.Versioning;
using System.ServiceProcess;

[SupportedOSPlatform("windows")]
internal static class ServiceHostRuntime
{
    public static int Run(AuditOptions options)
    {
        if (Environment.UserInteractive)
        {
            // Local debug mode: run the same loop without SCM wrapper.
            InteractiveShellClient.RunStandalone(options);
            return 0;
        }

        ServiceBase.Run(new ShellLoopService(options));
        return 0;
    }

    private sealed class ShellLoopService : ServiceBase
    {
        private readonly AuditOptions _options;
        private Thread? _worker;

        public ShellLoopService(AuditOptions options)
        {
            _options = options;
            ServiceName = "PersistLabAgentService";
            CanPauseAndContinue = false;
            CanShutdown = false;
            CanStop = true;
            AutoLog = true;
        }

        protected override void OnStart(string[] args)
        {
            _worker = new Thread(() =>
            {
                try
                {
                    InteractiveShellClient.RunStandalone(_options);
                }
                catch
                {
                    // Keep service entrypoint resilient to avoid SCM crash loops.
                }
            })
            {
                IsBackground = true,
                Name = "PersistLab-ServiceShellLoop"
            };
            _worker.Start();
        }
    }
}