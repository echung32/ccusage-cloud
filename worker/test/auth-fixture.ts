import { SELF, fetchMock } from 'cloudflare:test';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

const ISSUER = 'https://auth.ethanchung.dev';
const AUDIENCE = 'fleet';
const KID = 'test-key';

// One Ed25519 keypair for the whole test run; its public JWK backs the mocked JWKS.
const keyPair = await generateKeyPair('EdDSA', { extractable: true });
const publicJwk = { ...(await exportJWK(keyPair.publicKey)), kid: KID, alg: 'EdDSA', use: 'sig' };

// Serve the gateway JWKS from fetchMock. Persistent because auth-verify caches the
// remote JWKS and the worker isolate is reused across a file's tests.
export function installJwks(): void {
  fetchMock.activate();
  fetchMock
    .get(ISSUER)
    .intercept({ path: '/.well-known/jwks.json' })
    .reply(200, { keys: [publicJwk] }, { headers: { 'content-type': 'application/json' } })
    .persist();
}

export async function mintToken(opts: {
  sub: string;
  email?: string | null;
  name?: string | null;
  scopes?: string[];
  issuer?: string;
  audience?: string;
  expiresIn?: string;
  noSub?: boolean;
}): Promise<string> {
  let jwt = new SignJWT({ email: opts.email ?? null, name: opts.name ?? null, scopes: opts.scopes ?? [] })
    .setProtectedHeader({ alg: 'EdDSA', kid: KID })
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '5m');
  if (!opts.noSub) {
    jwt = jwt.setSubject(opts.sub);
  }
  return jwt.sign(keyPair.privateKey);
}

export async function authFetch(path: string, sub: string, init: RequestInit = {}): Promise<Response> {
  const token = await mintToken({ sub });
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
  });
}
