import { useState, type ReactNode } from 'react';
import AppLayout from '@cloudscape-design/components/app-layout';
import TopNavigation from '@cloudscape-design/components/top-navigation';
import SideNavigation from '@cloudscape-design/components/side-navigation';

const NAV = [
  { type: 'link' as const, text: 'Overview', href: '/overview' },
  { type: 'link' as const, text: 'Sources & Models', href: '/sources' },
  { type: 'link' as const, text: 'Projects', href: '/projects' },
  { type: 'link' as const, text: 'Devices', href: '/devices' },
  { type: 'link' as const, text: 'Sessions', href: '/sessions' },
  { type: 'link' as const, text: 'Settings', href: '/settings' },
];

function scopeHref(target: 'me' | 'group'): string {
  const p = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  if (target === 'group') p.set('scope', 'group'); else p.delete('scope');
  const path = typeof window !== 'undefined' ? window.location.pathname : '/overview';
  const qs = p.toString();
  return qs ? `${path}?${qs}` : path;
}

export function AppShell({ active, scope = 'me', children }: { active: string; scope?: 'me' | 'group'; children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(true);
  const groupHidden = new Set(['/projects', '/sessions']);
  const items = scope === 'group' ? NAV.filter((n) => !groupHidden.has(n.href)) : NAV;
  return (
    <>
      <div id="top-nav">
        <TopNavigation
          identity={{ href: '/overview', title: 'ccusage-cloud' }}
          utilities={[
            { type: 'button', text: 'Me', href: scopeHref('me') },
            { type: 'button', text: 'Group', href: scopeHref('group') },
          ]}
        />
      </div>
      <AppLayout
        headerSelector="#top-nav"
        toolsHide
        navigationOpen={navOpen}
        onNavigationChange={({ detail }) => setNavOpen(detail.open)}
        navigation={<SideNavigation activeHref={active} header={{ href: '/overview', text: 'ccusage-cloud' }} items={items} />}
        content={children}
      />
    </>
  );
}
