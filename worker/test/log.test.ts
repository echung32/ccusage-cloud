import { describe, expect, it, vi } from 'vitest';
import { safeLog } from '../src/log';

describe('safeLog', () => {
  it('emits structured JSON without PII fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    safeLog('ingest', { deviceId: 'dev_1', count: 3, token: 'cccloud_secret', email: 'a@b.c' });
    const line = String(spy.mock.calls[0]?.[0] ?? '');
    const obj = JSON.parse(line);
    expect(obj.event).toBe('ingest');
    expect(obj.deviceId).toBe('dev_1');
    expect(obj.count).toBe(3);
    expect(line).not.toContain('cccloud_secret');
    expect(line).not.toContain('a@b.c');
    expect('token' in obj).toBe(false);
    expect('email' in obj).toBe(false);
    spy.mockRestore();
  });
});
