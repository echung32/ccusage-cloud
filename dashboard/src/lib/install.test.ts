import { describe, expect, it } from 'vitest';
import { buildInstallCommands } from './install';

describe('buildInstallCommands', () => {
  it('builds curl and PowerShell one-liners from origin + code', () => {
    const { sh, ps1 } = buildInstallCommands('https://ccusage.example.dev', 'ec_abc123');
    expect(sh).toBe('curl -fsSL "https://ccusage.example.dev/i.sh?c=ec_abc123" | sh');
    expect(ps1).toBe('irm "https://ccusage.example.dev/i.ps1?c=ec_abc123" | iex');
  });
});
