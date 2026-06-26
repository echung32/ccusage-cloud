# Codex per-model breakdown at ingest

**Date:** 2026-06-25
**Status:** Approved — pending implementation plan

## Problem

The `/sources` page shows no by-model breakdown for codex usage. Session
totals, by-day, and by-source views include codex correctly (those read the flat
`total_tokens` / `total_cost` columns), but the by-model breakdown is empty for
every codex session.

### Root cause

Codex and Claude report per-model data in different shapes, and the pipeline
only understands Claude's shape.

**Claude** (`ccusage claude session --json`) — `modelBreakdowns` is an array:

```json
"modelBreakdowns": [
  { "modelName": "claude-opus-4-8", "inputTokens": 162928, "outputTokens": 987573,
    "cacheCreationTokens": 3078338, "cacheReadTokens": 216733910, "cost": 164.40 }
]
```

**Codex** (`ccusage codex session --json`) — no `modelBreakdowns` field at all.
Instead a `models` object keyed by model name, with no per-model `cost`:

```json
"models": {
  "gpt-5.5": { "inputTokens": 86548, "outputTokens": 6985, "cacheCreationTokens": 0,
               "cacheReadTokens": 281472, "reasoningOutputTokens": 639,
               "totalTokens": 375005, "isFallback": false }
}
```

Consequences in the current pipeline:

1. `cli/src/types.ts` declares `modelBreakdowns: v.optional(v.unknown())` and has
   no `models` field. For codex rows `modelBreakdowns` is absent and the `models`
   object is silently dropped by valibot.
2. The CLI ingests codex sessions with `modelBreakdowns === undefined`, stored as
   `null` in D1 (`worker/src/db.ts`).
3. The by-model query (`worker/src/queries.ts:84-100`) runs
   `FROM sessions s, json_each(s.model_breakdowns) je` and filters
   `json_extract(je.value, '$.modelName') IS NOT NULL`. With `model_breakdowns`
   null, `json_each` yields zero rows, so codex contributes nothing to by-model.

The worker-side comment "keys verified per Task A2" was verified against Claude
output only; codex was never sampled.

### Verified facts from real samples

- All 59 real codex sessions are single-model (`gpt-5.5`). Per-model cost is
  therefore exact in practice today; apportionment only matters for the rare
  multi-model fallback case.
- `reasoningOutputTokens` is a *subset* of `outputTokens`, already included in
  it: `inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens ==
  totalTokens` holds exactly. Folding reasoning into `outputTokens` would
  double-count — so it must be left alone.
- Model names must never be hardcoded: codex names (`gpt-5.5`) are read from the
  `models` object keys, and other sources may differ.

## Approach

Normalize at ingest in the CLI. A single pure function converts a `models`
object into the `modelBreakdowns` array shape the worker and dashboard already
consume. The worker query, DB schema, and dashboard are untouched.

### Components

**1. Schema — `cli/src/types.ts`**

Add an optional `models` field to `SessionRowSchema` so the codex object is
captured instead of dropped:

```ts
models: v.optional(v.record(v.string(), v.object({
  inputTokens: v.number(),
  outputTokens: v.number(),
  cacheCreationTokens: v.number(),
  cacheReadTokens: v.number(),
  totalTokens: v.number(),
}))),
```

Extra keys present in real output (`reasoningOutputTokens`, `isFallback`) are
ignored by valibot's object parsing — acceptable.

**2. Transform — new module `cli/src/model-breakdowns.ts`**

A pure function `synthesizeBreakdowns(models, totalCost)` returning the
`modelBreakdowns` array (or `undefined` when there is nothing to synthesize):

- map each `[modelName, m]` →
  `{ modelName, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, cost }`
- `outputTokens` copied straight across (reasoning already included)
- `cost`:
  - single entry → `totalCost`
  - multiple entries → `totalCost * (m.totalTokens / Σ totalTokens)`
- guards:
  - absent or empty `models` → return `undefined`
  - `Σ totalTokens === 0` → split `totalCost` evenly across entries (avoid
    divide-by-zero)

**3. Wire-in — `cli/src/ccusage.ts`**

In the `loadSessions` loop (around line 42, where `totalCost` is resolved), apply
a generic rule that references neither source name nor model name:

```ts
if (row.models && !row.modelBreakdowns) {
  modelBreakdowns = synthesizeBreakdowns(row.models, totalCost);
}
```

### Data flow

`loadSessions` synthesizes `modelBreakdowns` → it becomes part of the
`TaggedSession` → this changes `sessionHash` (`cli/src/state.ts:35`, hashes the
whole object) → `diffSessions` marks affected codex sessions as changed → the
next normal `sync` re-sends them → the worker `UPSERT`
(`worker/src/db.ts`) overwrites `model_breakdowns` → the by-model query picks
them up.

No manual migration is required; existing codex rows self-heal on the next sync.
The existing `--full` flag forces a full re-send as a fallback.

### Decisions

- **Trigger scope: generic.** Any session with a `models` object and no
  `modelBreakdowns` is normalized, regardless of source. Future-proofs other
  ccusage sources that share the shape.
- **Multi-model cost: apportion by token share.** Exact for single-model (all
  real data today); a documented estimate for multi-model fallback sessions.
  Token counts always stay exact.

## Edge cases

- Session with neither `models` nor `modelBreakdowns` (incomplete) → stays
  `null`, unchanged from today.
- Multi-model session → token-share cost estimate (documented as an estimate).
- Zero total tokens across models → even cost split.
- Claude sessions (already have `modelBreakdowns`) → untouched; the
  `!row.modelBreakdowns` guard skips them.

## Testing (TDD)

Unit tests for `synthesizeBreakdowns`:

- single-model → per-model `cost` equals session `totalCost`
- multi-model → per-model costs sum to `totalCost`, split by token share
- reasoning not double-counted → per-model token sum equals session `totalTokens`
- absent / empty `models` → `undefined`
- zero total tokens → even cost split, no NaN

Integration tests in `loadSessions`:

- the real codex JSON sample produces a populated `modelBreakdowns`
- a Claude sample with an existing `modelBreakdowns` is left unchanged

## Out of scope

- Storing `reasoningOutputTokens` or `isFallback` separately (YAGNI; not used by
  any view).
- Worker, DB schema, or dashboard changes.
- Source-prefixing model names to disambiguate identical names across sources
  (not a problem with current model sets).
