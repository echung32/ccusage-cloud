import { parseArgs } from 'node:util';
import { loadConfig, saveConfig } from './config';
import { ALL_SOURCES } from './sources';

export async function run(argv: string[]): Promise<number> {
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
    const { pushed, skipped } = await syncOnce(cfg, sources, { full: values.full ?? false });
    console.log(`Pushed ${pushed} sessions (${skipped} unchanged).`);
    return 0;
  }

  console.error('Usage: ccusage-cloud <login|sync>');
  return 1;
}

run(process.argv.slice(2)).then((code) => process.exit(code));
