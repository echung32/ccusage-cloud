import type { ReactNode } from 'react';

const NAV = [
  { href: '/overview', label: 'Overview' },
  { href: '/sources', label: 'Sources & Models' },
  { href: '/projects', label: 'Projects' },
  { href: '/devices', label: 'Devices' },
  { href: '/sessions', label: 'Sessions' },
  { href: '/settings', label: 'Settings' },
];

export function AppShell({ active, scope = 'me', children }: { active: string; scope?: 'me' | 'group'; children: ReactNode }) {
  const groupHidden = new Set(['/projects', '/sessions']);
  const nav = scope === 'group' ? NAV.filter((n) => !groupHidden.has(n.href)) : NAV;
  const toggleHref = (s: 'me' | 'group') => {
    const p = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
    if (s === 'group') p.set('scope', 'group'); else p.delete('scope');
    const qs = p.toString();
    return qs ? `?${qs}` : (typeof window !== 'undefined' ? window.location.pathname : '/overview');
  };
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200">
        <nav className="flex items-center gap-4 px-6 py-3 text-sm" aria-label="primary">
          <span className="font-semibold">ccusage-cloud</span>
          {nav.map((n) => (
            <a key={n.href} href={n.href} className={n.href === active ? 'font-semibold text-slate-900' : 'text-slate-500 hover:text-slate-900'}>{n.label}</a>
          ))}
          <span className="ml-auto inline-flex overflow-hidden rounded-md border border-slate-300 text-xs">
            <a href={toggleHref('me')} className={scope === 'me' ? 'bg-slate-900 px-2 py-1 text-white' : 'px-2 py-1 text-slate-600'}>Me</a>
            <a href={toggleHref('group')} className={scope === 'group' ? 'bg-slate-900 px-2 py-1 text-white' : 'px-2 py-1 text-slate-600'}>Group</a>
          </span>
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
