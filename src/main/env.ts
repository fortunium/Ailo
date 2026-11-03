// Builds the environment for a provider process. The environment is built from
// scratch per account: every variable that could select a different identity,
// config directory or API key is removed, then exactly one account directory is set.

import type { ProviderId } from '../shared/types';
import { runtimePath } from './runtime-path';

const SCRUB_PREFIXES = ['ANTHROPIC_', 'CLAUDE', 'CODEX_', 'OPENAI_', 'AZURE_OPENAI', 'ORCA_', 'ELECTRON_', 'AWS_BEARER_TOKEN_BEDROCK', 'VSCODE_'];
const SCRUB_EXACT = new Set(['NODE_OPTIONS', 'npm_config_user_agent', 'npm_execpath']);

export function isScrubbed(name: string): boolean {
  const upper = name.toUpperCase();
  return SCRUB_EXACT.has(name) || SCRUB_PREFIXES.some((p) => upper.startsWith(p));
}

export function providerEnv(provider: ProviderId, home: string, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  if (!home) throw new Error('No account directory given');
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && !isScrubbed(k)) env[k] = v;
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = runtimePath(base);
  if (provider === 'claude') {
    env.CLAUDE_CONFIG_DIR = home;
    env.CLAUDE_AGENT_SDK_CLIENT_APP = 'ailo/0.1.0';
  } else {
    env.CODEX_HOME = home;
  }
  return env;
}
