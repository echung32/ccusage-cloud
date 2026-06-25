export const fmtInt = (n: number) => n.toLocaleString('en-US');
export const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
export const fmtTime = (s: string | null) => (s ? s.replace('T', ' ').replace('Z', ' UTC') : '—');
