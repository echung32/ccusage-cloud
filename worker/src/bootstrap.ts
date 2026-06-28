import { Hono } from 'hono';
import type { AppBindings } from './env';

const CODE_RE = /^[A-Za-z0-9_-]+$/;

function shScript(server: string, code: string): string {
  return `#!/bin/sh
set -e
SERVER="${server}"
CODE="${code}"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js >= 20 is required. Install it from https://nodejs.org (ccusage needs it too)." >&2
  exit 1
fi
DIR="\${XDG_CONFIG_HOME:-$HOME/.config}/ccusage-cloud"
mkdir -p "$DIR"
curl -fsSL "$SERVER/cli.js" -o "$DIR/cli.js"
node "$DIR/cli.js" enroll --server "$SERVER" --code "$CODE"
node "$DIR/cli.js" sync
echo ""
echo "Done. To sync again later: node \\"$DIR/cli.js\\" sync"
echo "To automate, add that command to cron (Linux/macOS) or Task Scheduler (Windows)."
`;
}

function ps1Script(server: string, code: string): string {
  return `$ErrorActionPreference = 'Stop'
$Server = '${server}'
$Code = '${code}'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'Node.js >= 20 is required. Install it from https://nodejs.org (ccusage needs it too).'
  exit 1
}
$Dir = Join-Path $env:USERPROFILE '.config\\ccusage-cloud'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$Cli = Join-Path $Dir 'cli.js'
Invoke-WebRequest -UseBasicParsing -Uri "$Server/cli.js" -OutFile $Cli
node $Cli enroll --server $Server --code $Code
node $Cli sync
Write-Host ""
Write-Host "Done. To sync again later: node \`"$Cli\`" sync"
Write-Host "To automate, register a Scheduled Task that runs that command."
`;
}

export const bootstrapRoutes = new Hono<AppBindings>();

bootstrapRoutes.get('/i.sh', (c) => {
  const code = c.req.query('c') ?? '';
  if (!CODE_RE.test(code)) return c.text('invalid code\n', 400);
  return c.text(shScript(new URL(c.req.url).origin, code));
});

bootstrapRoutes.get('/i.ps1', (c) => {
  const code = c.req.query('c') ?? '';
  if (!CODE_RE.test(code)) return c.text('invalid code\n', 400);
  return c.text(ps1Script(new URL(c.req.url).origin, code));
});
