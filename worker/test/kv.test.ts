import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { consumeLoginToken, deleteViewerSession, getViewerSession, putLoginToken, putViewerSession } from '../src/kv';

describe('kv wrappers', () => {
  it('login token is single-use', async () => {
    await putLoginToken(env, 'tok1', 'me@example.com');
    expect(await consumeLoginToken(env, 'tok1')).toEqual({ email: 'me@example.com' });
    expect(await consumeLoginToken(env, 'tok1')).toBeNull();
  });

  it('viewer session resolves and can be deleted', async () => {
    await putViewerSession(env, 'sid1', 'usr_1');
    expect(await getViewerSession(env, 'sid1')).toEqual({ userId: 'usr_1' });
    await deleteViewerSession(env, 'sid1');
    expect(await getViewerSession(env, 'sid1')).toBeNull();
  });
});
