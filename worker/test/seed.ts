import { sha256Hex } from '../src/crypto';
import type { Env } from '../src/env';

let counter = 0;

export async function seedDevice(
  env: Env,
  email = `user${counter}@example.com`,
  label = 'test-device',
): Promise<{ token: string; userId: string; deviceId: string }> {
  counter += 1;
  const token = `cccloud_test_${counter}`;
  const tokenHash = await sha256Hex(token);
  const userId = `usr_${counter}`;
  const deviceId = `dev_${counter}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB
      .prepare('INSERT INTO users (id, email, public_to_group, created_at) VALUES (?, ?, 0, ?)')
      .bind(userId, email, now),
    env.DB
      .prepare(
        'INSERT INTO devices (id, user_id, token_sha256, label, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(deviceId, userId, tokenHash, label, now),
  ]);
  return { token, userId, deviceId };
}

export async function seedUser(
  env: Env,
  email = `viewer${counter}@example.com`,
): Promise<{ userId: string; email: string }> {
  counter += 1;
  const userId = `usr_v${counter}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, email, public_to_group, created_at) VALUES (?, ?, 0, ?)').bind(userId, email, now),
  ]);
  return { userId, email };
}

export interface SeedSessionOpts {
  userId: string;
  deviceId: string;
  source?: string;
  sessionId?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  totalTokens?: number;
  totalCost?: number;
  firstActivity?: string;
  lastActivity?: string;
  modelsUsed?: string[];
  modelBreakdowns?: unknown;
  projectPath?: string | null;
}

export async function seedSession(
  env: Env,
  opts: SeedSessionOpts,
): Promise<{ userId: string; deviceId: string; source: string; sessionId: string }> {
  counter += 1;
  const source = opts.source ?? 'claude';
  const sessionId = opts.sessionId ?? `sess_${counter}`;
  const input = opts.inputTokens ?? 100;
  const output = opts.outputTokens ?? 50;
  const cacheCreation = opts.cacheCreationTokens ?? 0;
  const cacheRead = opts.cacheReadTokens ?? 0;
  const totalTokens = opts.totalTokens ?? input + output + cacheCreation + cacheRead;
  const totalCost = opts.totalCost ?? 0.01;
  const lastActivity = opts.lastActivity ?? '2026-06-20T00:00:00.000Z';
  const firstActivity = opts.firstActivity ?? lastActivity;
  const modelsUsed = opts.modelsUsed ?? ['claude-opus-4'];
  const modelBreakdowns =
    opts.modelBreakdowns ??
    modelsUsed.map((m) => ({
      modelName: m,
      inputTokens: input,
      outputTokens: output,
      cacheCreationTokens: cacheCreation,
      cacheReadTokens: cacheRead,
      cost: totalCost,
    }));
  const projectPath = opts.projectPath === undefined ? '/work/app' : opts.projectPath;
  await env.DB.prepare(
    `INSERT INTO sessions (
      user_id, device_id, source, session_id,
      input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
      total_tokens, total_cost, credits, first_activity, last_activity,
      models_used, model_breakdowns, project_path, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      opts.userId,
      opts.deviceId,
      source,
      sessionId,
      input,
      output,
      cacheCreation,
      cacheRead,
      totalTokens,
      totalCost,
      null,
      firstActivity,
      lastActivity,
      JSON.stringify(modelsUsed),
      JSON.stringify(modelBreakdowns),
      projectPath,
      Date.now(),
    )
    .run();
  return { userId: opts.userId, deviceId: opts.deviceId, source, sessionId };
}
