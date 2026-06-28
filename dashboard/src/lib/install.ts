export function buildInstallCommands(origin: string, code: string): { sh: string; ps1: string } {
  return {
    sh: `curl -fsSL "${origin}/i.sh?c=${code}" | sh`,
    ps1: `irm "${origin}/i.ps1?c=${code}" | iex`,
  };
}
