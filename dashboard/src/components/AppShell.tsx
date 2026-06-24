import type { ReactNode } from 'react';

const NAV = [
  { href: '/overview', label: 'Overview' },
  { href: '/sources', label: 'Sources & Models' },
  { href: '/projects', label: 'Projects' },
  { href: '/devices', label: 'Devices' },
  { href: '/sessions', label: 'Sessions' },
  { href: '/settings', label: 'Settings' },
];

export function AppShell({ active, children }: { active: string; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200">
        <nav className="flex gap-4 px-6 py-3 text-sm" aria-label="primary">
          <span className="font-semibold">ccusage-cloud</span>
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className={n.href === active ? 'font-semibold text-slate-900' : 'text-slate-500 hover:text-slate-900'}
            >
              {n.label}
            </a>
          ))}
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
