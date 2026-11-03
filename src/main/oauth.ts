import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { ConnectionCredentials } from '../shared/types';

function providerFor(credentials: ConnectionCredentials, redirectUri: string, redirect: (url: string) => void, state: string): OAuthClientProvider {
  let verifier = '';
  credentials.oauth ??= { redirectUri };
  credentials.oauth.redirectUri = redirectUri;
  return {
    redirectUrl: redirectUri,
    clientMetadata: { client_name: 'Ailo', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
    state: () => state,
    clientInformation: () => credentials.oauth?.client,
    saveClientInformation: (client) => { credentials.oauth!.client = client; },
    tokens: () => credentials.oauth?.tokens,
    saveTokens: (tokens) => { credentials.oauth!.tokens = tokens; credentials.oauth!.expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined; },
    redirectToAuthorization: (url) => redirect(url.toString()),
    saveCodeVerifier: (value) => { verifier = value; },
    codeVerifier: () => verifier,
    invalidateCredentials: (scope) => { if (scope === 'all' || scope === 'tokens') credentials.oauth!.tokens = undefined; if (scope === 'all' || scope === 'client') credentials.oauth!.client = undefined; }
  };
}
const fetchWithTimeout: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) });

export async function authorizeMcp(url: string, previous: ConnectionCredentials, openUrl: (url: string) => void): Promise<ConnectionCredentials> {
  const credentials = structuredClone(previous);
  // A fresh sign-in selects an external identity explicitly; it never reuses a different connection's token.
  delete credentials.bearerToken;
  credentials.oauth = { redirectUri: '' };
  const state = randomBytes(24).toString('hex');
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const code = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  void code.catch(() => {});
  const server = http.createServer((request, response) => {
    const callback = new URL(request.url ?? '/', 'http://127.0.0.1');
    const received = Buffer.from(callback.searchParams.get('state') ?? '');
    const expected = Buffer.from(state);
    if (callback.pathname !== '/callback' || received.length !== expected.length || !timingSafeEqual(received, expected)) { response.writeHead(400).end('Invalid sign-in callback.'); return; }
    if (callback.searchParams.get('error')) { rejectCode(new Error('Authorization was declined.')); response.writeHead(400).end('Authorization was declined. You can return to Ailo.'); return; }
    const value = callback.searchParams.get('code');
    if (!value) { response.writeHead(400).end('Missing authorization code.'); return; }
    response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('Authorization received. You can return to Ailo.');
    resolveCode(value);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('Could not open the OAuth callback.'); }
  const provider = providerFor(credentials, `http://127.0.0.1:${address.port}/callback`, openUrl, state);
  const timer = setTimeout(() => rejectCode(new Error('Sign-in timed out. Try again.')), 180000);
  try {
    const result = await auth(provider, { serverUrl: url, fetchFn: fetchWithTimeout });
    if (result === 'REDIRECT') {
      await auth(provider, { serverUrl: url, authorizationCode: await code, fetchFn: fetchWithTimeout });
    }
    if (!credentials.oauth?.tokens?.access_token) throw new Error('The service did not return an access token.');
    return credentials;
  } finally { clearTimeout(timer); server.close(); server.closeAllConnections(); }
}

export async function refreshMcpToken(url: string, credentials: ConnectionCredentials): Promise<ConnectionCredentials> {
  const updated = structuredClone(credentials);
  if (!updated.oauth?.tokens) return updated;
  const provider = providerFor(updated, updated.oauth.redirectUri, () => { throw new Error('The external connection needs a new sign-in in Integrations.'); }, '');
  await auth(provider, { serverUrl: url, fetchFn: fetchWithTimeout });
  return updated;
}

export function withAccessToken(credentials: ConnectionCredentials): ConnectionCredentials {
  return credentials.oauth?.tokens?.access_token ? { ...credentials, bearerToken: credentials.oauth.tokens.access_token } : credentials;
}
