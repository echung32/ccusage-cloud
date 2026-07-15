import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig } from './config';
import { loadSessions, type Runner } from './ccusage';
import { diffSessions, loadState } from './state';
import { ALL_SOURCES } from './sources';
import { redactProjects } from './redact';

const HELP = `ccusage-cloud - sync local ccusage data to a ccusage-cloud server

Usage:
  ccusage-cloud <command> [options]

Commands:
  login    Save credentials for a ccusage-cloud server
  enroll   Redeem a one-time enroll code from the dashboard
  sync     Push new/changed sessions to the server
  status   Show server config, last sync time, and pending sessions

Options:
  --server <url>      Server URL (login)
  --token <token>     Device token (login)
  --code <code>       One-time enroll code (enroll)
  --ccusage-bin <bin> Path to the ccusage binary (login, default: ccusage)
  --source <source>   Limit to a single source (sync, status)
  --full              Push all sessions, not just changed ones (sync)
  --redact-projects   Replace project paths with opaque hashes
  -h, --help          Show this help

Examples:
  ccusage-cloud login --server https://example.com --token <token>
  ccusage-cloud sync
  ccusage-cloud status`;

export async function run(argv: string[], runner?: Runner): Promise<number> {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        token: { type: 'string' },
        server: { type: 'string' },
        code: { type: 'string' },
        'ccusage-bin': { type: 'string' },
        source: { type: 'string' },
        full: { type: 'boolean' },
        'redact-projects': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (err) {
    console.error((err as Error).message);
    console.error(HELP);
    return 1;
  }
  const cmd = positionals[0];

  if (values.help || cmd === 'help') {
    console.log(HELP);
    return 0;
  }

  if (!cmd) {
    console.log(HELP);
    return 0;
  }

  if (cmd === 'login') {
    if (!values.server || !values.token) {
      console.error('login requires --server <url> and --token <token>');
      return 1;
    }
    saveConfig({
      serverUrl: values.server,
      token: values.token,
      ccusageBin: values['ccusage-bin'] ?? 'ccusage',
      redactProjects: values['redact-projects'] ?? false,
    });
    console.log('Saved credentials.');
    return 0;
  }

  if (cmd === 'enroll') {
    if (!values.server || !values.code) {
      console.error('enroll requires --server <url> and --code <code>');
      return 1;
    }
    const { enrollDevice } = await import('./enroll');
    try {
      await enrollDevice({
        serverUrl: values.server,
        code: values.code,
        ccusageBin: values['ccusage-bin'],
        redactProjects: values['redact-projects'] ?? false,
      });
    } catch (err) {
      console.error((err as Error).message);
      return 1;
    }
    console.log('Enrolled this device.');
    return 0;
  }

  if (cmd === 'sync') {
    const cfg = loadConfig();
    if (!cfg) {
      console.error('Not logged in. Run `ccusage-cloud login --server <url> --token <token>`.');
      return 1;
    }
    const cfg2 = { ...cfg, redactProjects: values['redact-projects'] ?? cfg.redactProjects ?? false };
    const sources = values.source ? [values.source] : [...ALL_SOURCES];
    const { syncOnce, syncDaily } = await import('./sync');
    const { pushed, skipped } = await syncOnce(cfg2, sources, { full: values.full ?? false, run: runner });
    const { dailyPushed } = await syncDaily(cfg2, sources, { run: runner });
    console.log(`Pushed ${pushed} sessions (${skipped} unchanged); ${dailyPushed} daily rows.`);
    return 0;
  }

  if (cmd === 'status') {
    const cfg = loadConfig();
    if (!cfg) {
      console.error('Not logged in.');
      return 1;
    }
    const cfg2 = { ...cfg, redactProjects: values['redact-projects'] ?? cfg.redactProjects ?? false };
    const state = loadState();
    const sources = values.source ? [values.source] : [...ALL_SOURCES];
    const all = sources.flatMap((s) => loadSessions(s, cfg2.ccusageBin, runner));
    const collected = cfg2.redactProjects ? redactProjects(all) : all;
    const { changed } = diffSessions(collected, state);
    const last = state.lastSyncAt ? new Date(state.lastSyncAt).toISOString() : 'never';
    console.log(`Server:    ${cfg2.serverUrl}`);
    console.log(`ccusage:   ${cfg2.ccusageBin}`);
    console.log(`Last sync: ${last}`);
    console.log(`Pending:   ${changed.length} session(s)`);
    return 0;
  }

  console.error(`Unknown command: ${cmd}`);
  console.error(HELP);
  return 1;
}

// Only run when executed directly (not when imported by tests)
const isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  // Set exitCode and let the event loop drain instead of calling process.exit().
  // A synchronous process.exit() right after fetch() aborts on Windows with
  // "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\\win\\async.c"
  // because libuv is still tearing down undici's keep-alive handle. Idle undici
  // sockets are unref'd on Node >= 20, so the process still exits promptly.
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
