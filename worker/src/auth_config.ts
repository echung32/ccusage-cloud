// Verification config for the auth-gateway. Values are fixed for the fleet SSO
// deployment; the JWKS is fetched from the gateway and verified offline.
export const AUTH = {
  jwksUrl: 'https://auth.ethanchung.dev/.well-known/jwks.json',
  issuer: 'https://auth.ethanchung.dev',
  audience: 'fleet',
};
