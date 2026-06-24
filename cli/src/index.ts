import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig } from './config';
import { loadSessions, type Runner } from './ccusage';
import { diffSessions, loadState } from './state';
import { ALL_SOURCES } from './sources';

export async function run(argv: string[], runner?: Runner): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      token: { type: 'string' },
      server: { type: 'string' },
      'ccusage-bin': { type: 'string' },
      source: { type: 'string' },
      full: { type: 'boolean' },
    },
  });
  const cmd = positionals[0];

  if (cmd === 'login') {
    if (!values.server || !values.token) {
      console.error('login requires --server <url> and --token <token>');
      return 1;
    }
    saveConfig({
      serverUrl: values.server,
      token: values.token,
      ccusageBin: values['ccusage-bin'] ?? 'ccusage',
    });
    console.log('Saved credentials.');
    return 0;
  }

  if (cmd === 'sync') {
    const cfg = loadConfig();
    if (!cfg) {
      console.error('Not logged in. Run `ccusage-cloud login --server <url> --token <token>`.');
      return 1;
    }
    const sources = values.source ? [values.source] : [...ALL_SOURCES];
    const { syncOnce } = await import('./sync');
    const { pushed, skipped } = await syncOnce(cfg, sources, { full: values.full ?? false, run: runner });
    console.log(`Pushed ${pushed} sessions (${skipped} unchanged).`);
    return 0;
  }

  if (cmd === 'status') {
    const cfg = loadConfig();
    if (!cfg) {
      console.error('Not logged in.');
      return 1;
    }
    const state = loadState();
    const sources = values.source ? [values.source] : [...ALL_SOURCES];
    const all = sources.flatMap((s) => loadSessions(s, cfg.ccusageBin, runner));
    const { changed } = diffSessions(all, state);
    const last = state.lastSyncAt ? new Date(state.lastSyncAt).toISOString() : 'never';
    console.log(`Server:    ${cfg.serverUrl}`);
    console.log(`ccusage:   ${cfg.ccusageBin}`);
    console.log(`Last sync: ${last}`);
    console.log(`Pending:   ${changed.length} session(s)`);
    return 0;
  }

  console.error('Usage: ccusage-cloud <login|sync|status>');
  return 1;
}

// Only run when executed directly (not when imported by tests)
const isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) run(process.argv.slice(2)).then((code) => process.exit(code));
