# Codex per-model breakdown at ingest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `modelBreakdowns` for codex sessions at ingest so the `/sources` by-model breakdown includes codex usage.

**Architecture:** A pure CLI function converts codex's `models` object (keyed by model name, no per-model cost) into the `modelBreakdowns` array shape the worker and dashboard already consume. The transform runs generically in `loadSessions` for any session that has `models` but no `modelBreakdowns`. The worker, DB schema, and dashboard are untouched. Re-sync is automatic: the synthesized field changes each session's content hash, so the next `sync` re-sends affected codex sessions and the worker `UPSERT` overwrites `model_breakdowns`.

**Tech Stack:** TypeScript (strict, ESM), valibot for schema validation, vitest for tests. CLI package at `cli/`.

## Global Constraints

- No new runtime dependencies (only `valibot` is allowed at runtime).
- TypeScript strict mode; ESM modules; Node 22 types.
- Tests use vitest with dependency-injected `Runner` (no real subprocess) and fixtures under `cli/fixtures/`.
- Model names are NEVER hardcoded — always read from `Object.keys(models)`.
- The transform must NOT alter sessions that already have a `modelBreakdowns` field (Claude path).
- `reasoningOutputTokens` is already included inside `outputTokens` — never add it (would double-count).
- Run all CLI tests with `cd cli && npm test` (alias for `vitest run`). Single file: `cd cli && npx vitest run test/<file>.test.ts`.

---

### Task 1: `synthesizeBreakdowns` pure transform

**Files:**
- Create: `cli/src/model-breakdowns.ts`
- Test: `cli/test/model-breakdowns.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `interface ModelStats { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; totalTokens: number }`
  - `interface ModelBreakdown { modelName: string; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; cost: number }`
  - `function synthesizeBreakdowns(models: Record<string, ModelStats>, totalCost: number): ModelBreakdown[] | undefined`

- [ ] **Step 1: Write the failing test**

Create `cli/test/model-breakdowns.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { synthesizeBreakdowns } from '../src/model-breakdowns';

const stats = (over: Partial<Record<string, number>> = {}) => ({
  inputTokens: 100, outputTokens: 20, cacheCreationTokens: 0,
  cacheReadTokens: 80, totalTokens: 200, ...over,
});

describe('synthesizeBreakdowns', () => {
  it('single model: per-model cost equals session totalCost', () => {
    const out = synthesizeBreakdowns({ 'gpt-5.5': stats() }, 1.5);
    expect(out).toEqual([
      { modelName: 'gpt-5.5', inputTokens: 100, outputTokens: 20,
        cacheCreationTokens: 0, cacheReadTokens: 80, cost: 1.5 },
    ]);
  });

  it('single model: token fields map straight across (reasoning not added)', () => {
    // outputTokens stays 20 even though a real payload also carries reasoningOutputTokens
    const out = synthesizeBreakdowns({ 'gpt-5.5': stats({ outputTokens: 20 }) }, 1)!;
    expect(out[0].outputTokens).toBe(20);
  });

  it('multi model: costs apportion by totalTokens share and sum to totalCost', () => {
    const out = synthesizeBreakdowns({
      a: stats({ totalTokens: 300 }),
      b: stats({ totalTokens: 100 }),
    }, 4)!;
    const byName = Object.fromEntries(out.map((m) => [m.modelName, m.cost]));
    expect(byName.a).toBeCloseTo(3); // 300/400 * 4
    expect(byName.b).toBeCloseTo(1); // 100/400 * 4
    expect(out.reduce((s, m) => s + m.cost, 0)).toBeCloseTo(4);
  });

  it('multi model with zero total tokens: splits cost evenly', () => {
    const out = synthesizeBreakdowns({
      a: stats({ totalTokens: 0 }),
      b: stats({ totalTokens: 0 }),
    }, 2)!;
    expect(out.map((m) => m.cost)).toEqual([1, 1]);
  });

  it('empty models object: returns undefined', () => {
    expect(synthesizeBreakdowns({}, 1)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx vitest run test/model-breakdowns.test.ts`
Expected: FAIL — cannot find module `../src/model-breakdowns` / `synthesizeBreakdowns` is not a function.

- [ ] **Step 3: Write minimal implementation**

Create `cli/src/model-breakdowns.ts`:

```ts
export interface ModelStats {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

export interface ModelBreakdown {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
}

// Convert a `models` object (codex shape: keyed by model name, no per-model cost)
// into the `modelBreakdowns` array shape the worker/dashboard consume.
// Single-model sessions get the full session cost (exact); multi-model sessions
// apportion cost by token share (estimate). reasoningOutputTokens is already part
// of outputTokens upstream, so token fields are copied straight across.
export function synthesizeBreakdowns(
  models: Record<string, ModelStats>,
  totalCost: number,
): ModelBreakdown[] | undefined {
  const entries = Object.entries(models);
  if (entries.length === 0) return undefined;
  const totalTokens = entries.reduce((sum, [, m]) => sum + m.totalTokens, 0);
  return entries.map(([modelName, m]) => ({
    modelName,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheCreationTokens: m.cacheCreationTokens,
    cacheReadTokens: m.cacheReadTokens,
    cost:
      entries.length === 1
        ? totalCost
        : totalTokens > 0
          ? totalCost * (m.totalTokens / totalTokens)
          : totalCost / entries.length,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx vitest run test/model-breakdowns.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/model-breakdowns.ts cli/test/model-breakdowns.test.ts
git commit -m "feat(cli): add synthesizeBreakdowns transform for models-object sources"
```

---

### Task 2: Capture `models` in schema and wire the transform into `loadSessions`

**Files:**
- Modify: `cli/src/types.ts` (add `models` field to `SessionRowSchema`; exclude `models` from `TaggedSession`)
- Modify: `cli/src/ccusage.ts` (synthesize `modelBreakdowns` from `models` when absent)
- Create: `cli/fixtures/codex-session.json`
- Test: `cli/test/ccusage.test.ts` (extend existing file)

**Interfaces:**
- Consumes from Task 1: `synthesizeBreakdowns(models, totalCost)` from `./model-breakdowns`.
- Produces: `loadSessions` now emits `TaggedSession` objects whose `modelBreakdowns` is populated for codex-shaped rows; `models` is never present on the emitted object.

- [ ] **Step 1: Create the codex fixture**

Create `cli/fixtures/codex-session.json` (trimmed from real `ccusage codex session --json`, single-model — the common case):

```json
{
  "sessions": [
    {
      "sessionId": "2026/06/24/rollout-codex-1",
      "inputTokens": 86548,
      "outputTokens": 6985,
      "cacheCreationTokens": 0,
      "cacheReadTokens": 281472,
      "totalTokens": 375005,
      "costUSD": 0.783026,
      "lastActivity": "2026-06-24T00:34:42.256Z",
      "models": {
        "gpt-5.5": {
          "cacheCreationTokens": 0,
          "cacheReadTokens": 281472,
          "inputTokens": 86548,
          "isFallback": false,
          "outputTokens": 6985,
          "reasoningOutputTokens": 639,
          "totalTokens": 375005
        }
      }
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

Append to `cli/test/ccusage.test.ts` (add the fixture import near the top, beside the existing `claude-session.json` import):

```ts
const codexFixture = readFileSync(join(__dirname, '../fixtures/codex-session.json'), 'utf8');

describe('loadSessions codex modelBreakdowns synthesis', () => {
  it('synthesizes modelBreakdowns from the codex models object', () => {
    const run: Runner = () => codexFixture;
    const out = loadSessions('codex', 'ccusage', run);
    expect(out).toHaveLength(1);
    expect(out[0].modelBreakdowns).toEqual([
      {
        modelName: 'gpt-5.5',
        inputTokens: 86548,
        outputTokens: 6985,
        cacheCreationTokens: 0,
        cacheReadTokens: 281472,
        cost: 0.783026, // single model -> full session cost (costUSD)
      },
    ]);
  });

  it('does not leak the raw models object onto the tagged session', () => {
    const run: Runner = () => codexFixture;
    const out = loadSessions('codex', 'ccusage', run);
    expect('models' in out[0]).toBe(false);
  });

  it('leaves an existing modelBreakdowns untouched (claude path)', () => {
    const run: Runner = () => fixture; // claude fixture, already has modelBreakdowns
    const out = loadSessions('claude', 'ccusage', run);
    expect(out[0].modelBreakdowns).toEqual([
      { modelName: 'claude-opus-4-8', cost: 0.42 },
    ]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd cli && npx vitest run test/ccusage.test.ts`
Expected: FAIL — the codex test sees `modelBreakdowns` as `undefined` (schema drops `models`, no synthesis yet).

- [ ] **Step 4: Add the `models` field to the schema**

In `cli/src/types.ts`, add the field to `SessionRowSchema` (after `modelBreakdowns`, before `projectPath`):

```ts
  modelBreakdowns: v.optional(v.unknown()),
  models: v.optional(
    v.record(
      v.string(),
      v.object({
        inputTokens: v.number(),
        outputTokens: v.number(),
        cacheCreationTokens: v.number(),
        cacheReadTokens: v.number(),
        totalTokens: v.number(),
      }),
    ),
  ),
  projectPath: v.nullish(v.string()),
```

Then exclude `models` from `TaggedSession` so it is never shipped to the worker. Change:

```ts
export type TaggedSession = Omit<SessionRow, 'sessionId' | 'totalCost' | 'costUSD'> & {
```

to:

```ts
export type TaggedSession = Omit<SessionRow, 'sessionId' | 'totalCost' | 'costUSD' | 'models'> & {
```

Note: valibot's `v.object` ignores unrecognized keys, so the real payload's
`reasoningOutputTokens` and `isFallback` parse fine without being declared.

- [ ] **Step 5: Wire the transform into `loadSessions`**

In `cli/src/ccusage.ts`, add the import at the top (beside the existing imports):

```ts
import { synthesizeBreakdowns } from './model-breakdowns';
```

Replace the loop body that builds `out` (currently lines ~42-44):

```ts
    const { sessionId, costUSD, totalCost, ...rest } = parsed.output;
    if (sessionId === null) continue; // incomplete session — dropped silently, as before
    out.push({ ...rest, sessionId, source, totalCost: totalCost ?? costUSD ?? 0 });
```

with:

```ts
    const { sessionId, costUSD, totalCost, models, modelBreakdowns, ...rest } = parsed.output;
    if (sessionId === null) continue; // incomplete session — dropped silently, as before
    const resolvedCost = totalCost ?? costUSD ?? 0;
    const breakdowns =
      modelBreakdowns ?? (models ? synthesizeBreakdowns(models, resolvedCost) : undefined);
    out.push({ ...rest, sessionId, source, totalCost: resolvedCost, modelBreakdowns: breakdowns });
```

This applies generically (no source/model-name checks), preserves an existing
`modelBreakdowns`, and drops `models` from the emitted object.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd cli && npx vitest run test/ccusage.test.ts`
Expected: PASS — including the existing codex/costUSD and claude tests (no regressions).

- [ ] **Step 7: Run the full CLI suite and typecheck**

Run: `cd cli && npm test && npx tsc --noEmit`
Expected: all tests PASS; no type errors.

- [ ] **Step 8: Commit**

```bash
git add cli/src/types.ts cli/src/ccusage.ts cli/fixtures/codex-session.json cli/test/ccusage.test.ts
git commit -m "feat(cli): populate codex modelBreakdowns at ingest"
```

---

## Rollout / re-sync (operational, after merge & CLI deploy)

No code migration is needed — synthesizing `modelBreakdowns` changes each codex
session's `sessionHash` (`cli/src/state.ts:35`), so the next normal `sync`
re-sends them and the worker `UPSERT` overwrites `model_breakdowns`.

1. Build/install the updated CLI.
2. Run a normal sync: `ccusage-cloud sync`.
   - Affected codex sessions appear in the `pushed` count.
   - If you want to force every session regardless of local state, use the
     existing full flag: `ccusage-cloud sync --full`.
3. Verify on the dashboard `/sources` page: codex models (e.g. `gpt-5.5`) now
   appear in the "By model" breakdown alongside claude models.

## Self-review notes

- **Spec coverage:** schema capture (Task 2 Step 4), pure transform with single/
  multi/empty/zero-token cases (Task 1), generic trigger + no model-name
  hardcoding (Task 2 Step 5), reasoning-not-double-counted (Task 1 test + copy
  straight across), claude-unchanged (Task 2 test), auto re-sync (Rollout). All
  spec sections map to a task.
- **No placeholders:** every step has concrete code/commands.
- **Type consistency:** `synthesizeBreakdowns(models, totalCost)` signature is
  identical in Task 1 (definition) and Task 2 (call site); `ModelStats` fields
  match the `models` schema fields in `types.ts`.
