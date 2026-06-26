// auth-verify dist/index.js — VENDORED. See ./../VENDOR.md.
// Source: echung32/auth-gateway, packages/auth-verify/src/index.ts
//   @ commit 9985dde2bdf761e549bfa5e4a052040812031901 (public repo).
// This is the ESM build output (types stripped) of the vendored src/index.ts in
// this package. There is no standalone echung32/auth-verify repo and the package
// is unpublished, so it is vendored rather than installed. Rebuild: see VENDOR.md.
import { createRemoteJWKSet, jwtVerify } from "jose";

const ACCESS_COOKIE = "__Secure-fleet_at";
const jwksCache = new Map();

function getJwks(url) {
  let jwks = jwksCache.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksCache.set(url, jwks);
  }
  return jwks;
}

function readToken(request) {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === ACCESS_COOKIE) return v.join("=");
  }
  return null;
}

export async function requireUser(request, opts) {
  const token = readToken(request);
  if (!token) throw new Response("Unauthorized", { status: 401 });
  try {
    const { payload } = await jwtVerify(token, getJwks(opts.jwksUrl), {
      issuer: opts.issuer,
      audience: opts.audience,
    });
    return {
      sub: String(payload.sub),
      email: (payload.email ?? null),
      name: (payload.name ?? null),
      scopes: (payload.scopes ?? []),
    };
  } catch {
    throw new Response("Unauthorized", { status: 401 });
  }
}
