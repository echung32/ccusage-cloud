export interface Env {
  DB: D1Database;
}

export interface DeviceContext {
  userId: string;
  deviceId: string;
}

export type AppBindings = {
  Bindings: Env;
  Variables: { device: DeviceContext };
};
