/**
 * GitHub OAuth2 Web Flow + PAT-paste fallback.
 *
 * The OAuth App and the OCF proxy are SHARED with anki-client. Only the
 * localStorage key is namespaced so the two apps can hold independent tokens
 * on the same browser if desired. See Agent.PD/learning/tracker/SYNC-DESIGN.md.
 */
import type { AppConfig } from './config';

const LS_TOKEN_KEY = 'study-tracker:gh_token';
const SS_STATE_KEY = 'study-tracker:oauth_state';

const GH_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

export function getToken(): string | undefined {
  return localStorage.getItem(LS_TOKEN_KEY) ?? undefined;
}

export function setToken(token: string): void {
  localStorage.setItem(LS_TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(LS_TOKEN_KEY);
}

function callbackUrl(): string {
  return window.location.origin + import.meta.env.BASE_URL;
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function authorize(config: AppConfig): void {
  const state = randomState();
  sessionStorage.setItem(SS_STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: config.oauthClientId,
    redirect_uri: callbackUrl(),
    scope: config.scopes.join(' '),
    state,
    allow_signup: 'false',
  });
  window.location.assign(`${GH_AUTHORIZE_URL}?${params.toString()}`);
}

export interface CallbackResult {
  kind: 'ok' | 'error' | 'none';
  token?: string;
  error?: string;
}

export async function handleCallback(config: AppConfig): Promise<CallbackResult> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const ghError = url.searchParams.get('error');

  if (!code && !ghError) return { kind: 'none' };

  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  url.searchParams.delete('error_uri');
  window.history.replaceState({}, '', url.toString());

  if (ghError) {
    return { kind: 'error', error: `${ghError}: ${url.searchParams.get('error_description') ?? ''}`.trim() };
  }

  const expected = sessionStorage.getItem(SS_STATE_KEY);
  sessionStorage.removeItem(SS_STATE_KEY);
  if (!expected || expected !== state) {
    return { kind: 'error', error: 'OAuth state mismatch' };
  }

  if (!config.proxyUrl) {
    return { kind: 'error', error: 'proxyUrl not configured' };
  }

  const res = await fetch(config.proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirect_uri: callbackUrl() }),
  });
  if (!res.ok) {
    return { kind: 'error', error: `proxy returned HTTP ${res.status}` };
  }
  const body = await res.json();
  if (body.access_token) {
    setToken(body.access_token);
    return { kind: 'ok', token: body.access_token };
  }
  return { kind: 'error', error: body.error ?? 'no access_token in proxy response' };
}

export async function verifyToken(token: string): Promise<{ login: string; id: string } | undefined> {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return undefined;
  const body = await res.json();
  return { login: body.login, id: String(body.id) };
}
