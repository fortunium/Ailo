// Removes secrets from text before it is logged, stored, or shown.

const PATTERNS: [RegExp, string][] = [
  [/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-<redacted>'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '<jwt-redacted>'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 <redacted>'],
  [/("?(?:access_token|refresh_token|id_token|accessToken|refreshToken|idToken|api_key|apiKey|OPENAI_API_KEY|ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|password|secret)"?\s*[:=]\s*)"[^"]*"/gi, '$1"<redacted>"'],
  [/((?:ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|OPENAI_API_KEY|CODEX_API_KEY)=)\S+/g, '$1<redacted>'],
  [/([?&](?:code|state|code_challenge|code_verifier|token)=)[^&\s"']+/gi, '$1<redacted>']
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Strip ANSI escape sequences from CLI stderr. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}
