import type { Me, Summary, SessionsPage, Filters } from './types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch { /* ignore */ }
    throw new Error(`request failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as T;
}

function qs(filters: Filters, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filters, ...extra })) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

const base: RequestInit = { credentials: 'include' };
const jsonHeaders = { 'content-type': 'application/json' };

export async function getMe(): Promise<Me> {
  return json<Me>(await fetch('/api/me', { ...base }));
}

export async function patchMe(publicToGroup: boolean): Promise<{ publicToGroup: boolean }> {
  return json(await fetch('/api/me', { ...base, method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ publicToGroup }) }));
}

export async function createDevice(label: string): Promise<{ id: string; token: string }> {
  return json(await fetch('/api/devices', { ...base, method: 'POST', headers: jsonHeaders, body: JSON.stringify({ label }) }));
}

export async function deleteDevice(id: string): Promise<{ ok: true }> {
  return json(await fetch(`/api/devices/${id}`, { ...base, method: 'DELETE' }));
}

export async function getSummary(filters: Filters): Promise<Summary> {
  return json<Summary>(await fetch(`/api/summary${qs(filters)}`, { ...base }));
}

export async function getSessions(filters: Filters, cursor?: string | null): Promise<SessionsPage> {
  const extra: Record<string, string> = {};
  if (cursor) extra.cursor = cursor;
  return json<SessionsPage>(await fetch(`/api/sessions${qs(filters, extra)}`, { ...base }));
}

export async function requestLogin(email: string): Promise<{ ok: true }> {
  return json(await fetch('/auth/request', { ...base, method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email }) }));
}

export async function logout(): Promise<{ ok: true }> {
  return json(await fetch('/auth/logout', { ...base, method: 'POST' }));
}
