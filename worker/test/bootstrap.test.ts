import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('GET /i.sh', () => {
  it('returns a shell script templated with server + code', async () => {
    const res = await SELF.fetch('https://example.com/i.sh?c=ec_abc123');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('https://example.com');
    expect(body).toContain('ec_abc123');
    expect(body).toContain('/cli.js');
    expect(body).toContain('enroll');
    expect(body).toContain('sync');
  });

  it('400s on a malformed code', async () => {
    const res = await SELF.fetch('https://example.com/i.sh?c=bad;rm -rf');
    expect(res.status).toBe(400);
  });
});

describe('GET /i.ps1', () => {
  it('returns a PowerShell script templated with server + code', async () => {
    const res = await SELF.fetch('https://example.com/i.ps1?c=ec_abc123');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('https://example.com');
    expect(body).toContain('ec_abc123');
    expect(body).toContain('Invoke-WebRequest');
  });
});
