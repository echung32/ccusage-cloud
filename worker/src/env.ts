export interface EmailMessage {
  to: string;
  from: { email: string; name?: string };
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface Env {
  DB: D1Database;
  LOGIN_TOKENS: KVNamespace;
  VIEWER_SESSIONS: KVNamespace;
  EMAIL?: EmailSender;
  ASSETS: Fetcher;
}

export interface DeviceContext {
  userId: string;
  deviceId: string;
}

export interface ViewerContext {
  userId: string;
}

export type AppBindings = {
  Bindings: Env;
  Variables: { device: DeviceContext; viewer: ViewerContext };
};
