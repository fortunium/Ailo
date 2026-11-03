import { expect, it } from 'vitest';
import { installCodexPlugins } from '../src/main/providers/codex-plugins';

it('does not invoke the CLI or remote plugin discovery with no selected plugins', async () => {
  // An invalid executable deliberately makes any accidental spawn fail.
  await expect(installCodexPlugins('/missing/codex', '/missing/account', [])).resolves.toEqual([]);
});
