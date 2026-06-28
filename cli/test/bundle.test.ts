import { execSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(__dirname, '..');
const bundleSrc = join(cliDir, 'bundle', 'index.js');

describe('standalone bundle', () => {
  let tempDir: string;

  beforeAll(() => {
    // Build the self-contained bundle
    execSync('pnpm build:bundle', { cwd: cliDir, stdio: 'inherit' });

    // Copy bundle to a fresh temp dir with NO node_modules — this is the production scenario
    tempDir = mkdtempSync(join(tmpdir(), 'ccc-bundle-'));
    copyFileSync(bundleSrc, join(tempDir, 'cli.js'));
  }, 120_000);

  it('bundle exists and valibot is inlined (no bare import)', () => {
    const src = readFileSync(bundleSrc, 'utf8');
    // Must not contain a bare external import of valibot
    expect(src).not.toMatch(/from\s*["']valibot["']/);
  });

  it('node cli.js --help exits 0 and lists enroll and sync', () => {
    const output = execSync('node cli.js --help', { cwd: tempDir }).toString();
    expect(output).toContain('enroll');
    expect(output).toContain('sync');
  });

  it('node cli.js sync does not crash with ERR_MODULE_NOT_FOUND', () => {
    // sync may print "Not logged in" or push 0 sessions — both are fine
    // What must NOT happen is a module-not-found crash
    let output = '';
    try {
      output = execSync('node cli.js sync', { cwd: tempDir }).toString();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ERR_MODULE_NOT_FOUND') || msg.includes('Cannot find package')) {
        throw new Error(`Bundle crashed with module-not-found:\n${msg}`);
      }
      // Any other non-zero exit (e.g. "Not logged in") is acceptable
      output = msg;
    }
    expect(output).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    expect(output).not.toMatch(/Cannot find package/);
  });
});
