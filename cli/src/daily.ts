import * as v from 'valibot';
import { type Runner, defaultRunner } from './ccusage';

export interface DailyRow {
  source: string;
  day: string;
  totalTokens: number;
  totalCost: number;
}

const FileShape = v.object({ daily: v.array(v.unknown()) });
const RowSchema = v.object({
  date: v.string(),
  totalTokens: v.number(),
  totalCost: v.optional(v.number()),
  costUSD: v.optional(v.number()),
});

export function loadDaily(source: string, bin: string, run: Runner = defaultRunner): DailyRow[] {
  let raw: string;
  try {
    raw = run(bin, [source, 'daily', '--json']);
  } catch {
    return [];
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }

  const file = v.safeParse(FileShape, json);
  if (!file.success) return [];

  const out: DailyRow[] = [];
  for (const row of file.output.daily) {
    const parsed = v.safeParse(RowSchema, row);
    if (!parsed.success) continue;
    const { date, totalTokens, totalCost, costUSD } = parsed.output;
    out.push({ source, day: date.slice(0, 10), totalTokens, totalCost: totalCost ?? costUSD ?? 0 });
  }
  return out;
}
