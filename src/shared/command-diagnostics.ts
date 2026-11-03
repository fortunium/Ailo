/** Advisory hints, independent of the provider's authoritative process status. */
export function commandOutputNotice(output = ''): string | undefined {
  const text = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  if (/^rg: .*\(os error \d+\)/m.test(text) || /FullyQualifiedErrorId\s*:/i.test(text) || /^\s*[\w.-]+:\s*\r?\n\s*Line\s*\|/m.test(text)) {
    return 'Output contains error diagnostics. A successful exit code can hide an earlier failure in a combined command.';
  }
  if (/:\s*warning (?:NU|CS|MSB)\d+\b/i.test(text)) return 'Output contains build or dependency warnings. Check the final result separately.';
  return undefined;
}
