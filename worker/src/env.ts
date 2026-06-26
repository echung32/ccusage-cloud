export interface Env {
  DB: D1Database;
  RATE_LIMITS: KVNamespace;
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
