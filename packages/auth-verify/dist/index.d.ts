export interface VerifyOptions {
  jwksUrl: string;
  issuer: string;
  audience: string;
}

export interface VerifiedUser {
  sub: string;
  email: string | null;
  name: string | null;
  scopes: string[];
}

export declare function requireUser(request: Request, opts: VerifyOptions): Promise<VerifiedUser>;
