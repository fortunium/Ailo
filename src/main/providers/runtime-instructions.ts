export function runtimeInstructions(platform: NodeJS.Platform = process.platform): string {
  const common = 'Execution guidance: distinguish command exit codes, diagnostic warnings, and completed test results. A check interrupted before its final result is unfinished. Report that explicitly.';
  if (platform !== 'win32') return common;
  return `${common}
This host is Windows. Follow the project's instructions with these execution details:
- Use Get-Command pwsh to locate PowerShell 7; it may be installed per user and absent from Program Files. Use pwsh for scripts requiring modern PowerShell/.NET APIs. Test-Path is preferable for optional directory probes.
- PowerShell does not expand native-command wildcard arguments like a Unix shell. For ripgrep use directory roots and -g filters (for example rg -n pattern . -g 'Directory.Build.*'), or explicitly enumerate matching files first. Check that optional report/log directories exist before reading them.
- Keep required native checks separate, or inspect $LASTEXITCODE after each one. A later successful command must not conceal an earlier failure. For required PowerShell operations use terminating errors; handle optional probes explicitly.
- Process inspection with Get-CimInstance/WMI can be denied in the sandbox. Use permitted information such as Get-Process or the command's own output when sufficient. Request additional permission only when necessary for the user's task; do not bypass restrictions.
- For a source inventory, distinguish existing reports from a fresh verification run. Wait for the test summary before claiming tests passed; dependency warnings alone do not establish a test failure.`;
}
