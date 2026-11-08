using System.Text;
using System.Linq;

internal static class PersistCommandBridge
{
    internal sealed record PersistExecutionResult(string StdOut, string StdErr, int ExitCode, bool Handled);

    public static PersistExecutionResult TryExecute(string? rawCommand)
    {
        if (string.IsNullOrWhiteSpace(rawCommand))
        {
            return new PersistExecutionResult(string.Empty, string.Empty, 0, false);
        }

        List<string> tokens = Tokenize(rawCommand);
        if (tokens.Count == 0 || !tokens[0].Equals("persist", StringComparison.OrdinalIgnoreCase))
        {
            return new PersistExecutionResult(string.Empty, string.Empty, 0, false);
        }

        try
        {
            string[] persistArgs = BuildPersistArgs(tokens);
            return ExecutePersistInProcess(persistArgs);
        }
        catch (ArgumentException ex)
        {
            return new PersistExecutionResult(string.Empty, $"[X] {ex.Message}", 1, true);
        }
        catch (Exception ex)
        {
            return new PersistExecutionResult(string.Empty, $"[X] Persist bridge failure: {ex.Message}", 1, true);
        }
    }

    private static PersistExecutionResult ExecutePersistInProcess(string[] persistArgs)
    {
        TextWriter originalOut = Console.Out;
        TextWriter originalErr = Console.Error;
        var stdout = new StringWriter();
        var stderr = new StringWriter();

        try
        {
            Console.SetOut(stdout);
            Console.SetError(stderr);
            int exitCode = Persist.Persist.ExecuteFromArgs(persistArgs);
            return new PersistExecutionResult(stdout.ToString(), stderr.ToString(), exitCode, true);
        }
        finally
        {
            Console.SetOut(originalOut);
            Console.SetError(originalErr);
        }
    }

    private static string[] BuildPersistArgs(IReadOnlyList<string> tokens)
    {
        if (tokens.Count < 3)
        {
            throw new ArgumentException("Usage: persist <technique> <add|remove|check|list> ...");
        }

        // Keep backward compatibility with the original Persist.exe flags syntax.
        if (tokens[1].StartsWith("-", StringComparison.Ordinal))
        {
            return tokens.Skip(1).ToArray();
        }

        string technique = tokens[1];
        string method = tokens[2];

        var args = new List<string> { "-t", technique, "-m", method };

        switch (technique.ToLowerInvariant())
        {
            case "reg":
                if (method.Equals("add", StringComparison.OrdinalIgnoreCase))
                {
                    if (tokens.Count < 5)
                    {
                        throw new ArgumentException("Usage: persist reg add <key> <value> [option]");
                    }

                    args.AddRange(["-k", tokens[3], "-v", tokens[4]]);
                    if (tokens.Count >= 6)
                    {
                        args.AddRange(["-o", tokens[5]]);
                    }
                }
                else if (method.Equals("remove", StringComparison.OrdinalIgnoreCase))
                {
                    if (tokens.Count < 5)
                    {
                        throw new ArgumentException("Usage: persist reg remove <key> <value> [option]");
                    }

                    args.AddRange(["-k", tokens[3], "-v", tokens[4]]);
                    if (tokens.Count >= 6)
                    {
                        args.AddRange(["-o", tokens[5]]);
                    }
                }
                else if (method.Equals("check", StringComparison.OrdinalIgnoreCase))
                {
                    if (tokens.Count < 5)
                    {
                        throw new ArgumentException("Usage: persist reg check <key> <value> [option]");
                    }

                    args.AddRange(["-k", tokens[3], "-v", tokens[4]]);
                    if (tokens.Count >= 6)
                    {
                        args.AddRange(["-o", tokens[5]]);
                    }
                }
                else if (method.Equals("list", StringComparison.OrdinalIgnoreCase))
                {
                    if (tokens.Count >= 4)
                    {
                        args.AddRange(["-k", tokens[3]]);
                    }
                }
                break;

            case "schtask":
                if (method is "add" or "check")
                {
                    if (tokens.Count < 4)
                    {
                        throw new ArgumentException("Usage: persist schtask <add|check> <name> [daily|hourly|logon] [serverUrl listenerId agentId]");
                    }

                    args.AddRange(["-n", tokens[3]]);
                    if (tokens.Count >= 5)
                    {
                        string option = tokens[4];
                        if (option.Equals("daily", StringComparison.OrdinalIgnoreCase) ||
                            option.Equals("hourly", StringComparison.OrdinalIgnoreCase) ||
                            option.Equals("logon", StringComparison.OrdinalIgnoreCase))
                        {
                            args.AddRange(["-o", option]);
                            if (tokens.Count >= 7)
                            {
                                args.AddRange(["-s", tokens[5], "-l", tokens[6]]);
                                if (tokens.Count >= 8)
                                {
                                    args.AddRange(["-i", tokens[7]]);
                                }
                            }
                        }
                        else if (tokens.Count >= 6)
                        {
                            args.AddRange(["-s", tokens[4], "-l", tokens[5]]);
                            if (tokens.Count >= 7)
                            {
                                args.AddRange(["-i", tokens[6]]);
                            }
                        }
                    }
                }
                else if (method.Equals("remove", StringComparison.OrdinalIgnoreCase))
                {
                    if (tokens.Count < 4)
                    {
                        throw new ArgumentException("Usage: persist schtask remove <name>");
                    }

                    args.AddRange(["-n", tokens[3]]);
                }
                else if (method.Equals("list", StringComparison.OrdinalIgnoreCase))
                {
                    if (tokens.Count >= 4)
                    {
                        args.AddRange(["-n", tokens[3]]);
                    }

                    if (tokens.Count >= 5)
                    {
                        args.AddRange(["-o", tokens[4]]);
                    }
                }
                break;

            case "schtaskbackdoor":
                if (method is "add" or "check")
                {
                    if (tokens.Count < 4)
                    {
                        throw new ArgumentException("Usage: persist schtaskbackdoor <add|check> <name> [serverUrl listenerId agentId]");
                    }

                    args.AddRange(["-n", tokens[3]]);
                    if (tokens.Count >= 6)
                    {
                        args.AddRange(["-s", tokens[4], "-l", tokens[5]]);
                        if (tokens.Count >= 7)
                        {
                            args.AddRange(["-i", tokens[6]]);
                        }
                    }
                }
                else if (method.Equals("remove", StringComparison.OrdinalIgnoreCase))
                {
                    if (tokens.Count < 4)
                    {
                        throw new ArgumentException("Usage: persist schtaskbackdoor remove <name>");
                    }

                    args.AddRange(["-n", tokens[3]]);
                }
                else if (method.Equals("list", StringComparison.OrdinalIgnoreCase))
                {
                    if (tokens.Count >= 4)
                    {
                        args.AddRange(["-n", tokens[3]]);
                    }

                    if (tokens.Count >= 5)
                    {
                        args.AddRange(["-o", tokens[4]]);
                    }
                }
                break;

            case "service":
                if (method is "add" or "check")
                {
                    if (tokens.Count < 4)
                    {
                        throw new ArgumentException("Usage: persist service <add|check> <name> [serverUrl listenerId agentId]");
                    }

                    args.AddRange(["-n", tokens[3]]);
                    if (tokens.Count >= 6)
                    {
                        args.AddRange(["-s", tokens[4], "-l", tokens[5]]);
                        if (tokens.Count >= 7)
                        {
                            args.AddRange(["-i", tokens[6]]);
                        }
                    }
                }
                else if (method.Equals("remove", StringComparison.OrdinalIgnoreCase))
                {
                    if (tokens.Count < 4)
                    {
                        throw new ArgumentException("Usage: persist service remove <name>");
                    }

                    args.AddRange(["-n", tokens[3]]);
                }
                else if (method.Equals("list", StringComparison.OrdinalIgnoreCase) && tokens.Count >= 4)
                {
                    args.AddRange(["-n", tokens[3]]);
                }
                break;

            case "startupfolder":
                if (method is "add" or "check")
                {
                    if (tokens.Count < 4)
                    {
                        throw new ArgumentException("Usage: persist startupfolder <add|check> <fileName> [serverUrl listenerId agentId]");
                    }

                    args.AddRange(["-f", tokens[3]]);
                    if (tokens.Count >= 6)
                    {
                        args.AddRange(["-s", tokens[4], "-l", tokens[5]]);
                        if (tokens.Count >= 7)
                        {
                            args.AddRange(["-i", tokens[6]]);
                        }
                    }
                }
                else if (method.Equals("remove", StringComparison.OrdinalIgnoreCase))
                {
                    if (tokens.Count < 4)
                    {
                        throw new ArgumentException("Usage: persist startupfolder remove <fileName>");
                    }

                    args.AddRange(["-f", tokens[3]]);
                }
                break;

            case "phantom":
                if (method is "add" or "check")
                {
                    if (tokens.Count < 4)
                    {
                        throw new ArgumentException("Usage: persist phantom <add|check> <scenarioName> [restart|shutdown|logoff|all] [serverUrl listenerId agentId]");
                    }

                    args.AddRange(["-n", tokens[3]]);
                    
                    int idx = 4;
                    if (tokens.Count > idx && 
                        (tokens[idx].Equals("restart", StringComparison.OrdinalIgnoreCase) ||
                         tokens[idx].Equals("shutdown", StringComparison.OrdinalIgnoreCase) ||
                         tokens[idx].Equals("logoff", StringComparison.OrdinalIgnoreCase) ||
                         tokens[idx].Equals("all", StringComparison.OrdinalIgnoreCase)))
                    {
                        args.AddRange(["-o", tokens[idx]]);
                        idx++;
                    }
                    
                    if (tokens.Count > idx + 1)
                    {
                        args.AddRange(["-s", tokens[idx], "-l", tokens[idx + 1]]);
                        if (tokens.Count > idx + 2)
                        {
                            args.AddRange(["-i", tokens[idx + 2]]);
                        }
                    }
                }
                else if (method.Equals("remove", StringComparison.OrdinalIgnoreCase))
                {
                    if (tokens.Count < 4)
                    {
                        throw new ArgumentException("Usage: persist phantom remove <scenarioName>");
                    }
                    args.AddRange(["-n", tokens[3]]);
                }
                else if (method.Equals("list", StringComparison.OrdinalIgnoreCase) && tokens.Count >= 4)
                {
                    args.AddRange(["-n", tokens[3]]);
                }
                break;

            case "wmisubscription":
                if (method is "add" or "check")
                {
                    if (tokens.Count < 4)
                    {
                        throw new ArgumentException("Usage: persist wmisubscription <add|check> <subscriptionName> [options...]");
                    }

                    args.AddRange(["-n", tokens[3]]);
                    
                    int idx = 4;
                    
                    // Parse option (trigger mode)
                    if (tokens.Count > idx && 
                        (tokens[idx].Equals("interval", StringComparison.OrdinalIgnoreCase) ||
                         tokens[idx].Equals("logon", StringComparison.OrdinalIgnoreCase) ||
                         tokens[idx].Equals("startup", StringComparison.OrdinalIgnoreCase) ||
                         tokens[idx].Equals("process", StringComparison.OrdinalIgnoreCase)))
                    {
                        args.AddRange(["-o", tokens[idx]]);
                        idx++;
                    }
                    
                    // Parse command_arg (flag -a ou valeur directe avec "=")
                    if (tokens.Count > idx)
                    {
                        if (tokens[idx].Equals("-a", StringComparison.OrdinalIgnoreCase))
                        {
                            if (tokens.Count <= idx + 1)
                            {
                                throw new ArgumentException("Missing value for -a flag");
                            }
                            args.AddRange(["-a", tokens[idx + 1]]);
                            idx += 2;
                        }
                        else if (tokens[idx].Contains('='))
                        {
                            args.AddRange(["-a", tokens[idx]]);
                            idx++;
                        }
                    }
                    
                    // Parse server, listener, agentId
                    if (tokens.Count > idx + 1)
                    {
                        args.AddRange(["-s", tokens[idx], "-l", tokens[idx + 1]]);
                        if (tokens.Count > idx + 2)
                        {
                            args.AddRange(["-i", tokens[idx + 2]]);
                        }
                    }
                }
                else if (method.Equals("remove", StringComparison.OrdinalIgnoreCase))
                {
                    if (tokens.Count < 4)
                    {
                        throw new ArgumentException("Usage: persist wmisubscription remove <subscriptionName>");
                    }
                    args.AddRange(["-n", tokens[3]]);
                }
                else if (method.Equals("list", StringComparison.OrdinalIgnoreCase) && tokens.Count >= 4)
                {
                    args.AddRange(["-n", tokens[3]]);
                }
                break;
        }

        return args.ToArray();
    }

    private static List<string> Tokenize(string commandLine)
    {
        var tokens = new List<string>();
        var current = new StringBuilder();
        bool inQuotes = false;

        foreach (char c in commandLine)
        {
            if (c == '"')
            {
                inQuotes = !inQuotes;
                continue;
            }

            if (char.IsWhiteSpace(c) && !inQuotes)
            {
                if (current.Length > 0)
                {
                    tokens.Add(current.ToString());
                    current.Clear();
                }
                continue;
            }

            current.Append(c);
        }

        if (current.Length > 0)
        {
            tokens.Add(current.ToString());
        }

        return tokens;
    }
}