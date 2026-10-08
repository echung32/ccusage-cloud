import type { ReactNode } from "react";

const NAV = [
  { href: "/overview", label: "Overview", icon: "◈" },
  { href: "/sources", label: "Sources & Models", icon: "▥" },
  { href: "/projects", label: "Projects", icon: "▧" },
  { href: "/devices", label: "Devices", icon: "▣" },
  { href: "/sessions", label: "Sessions", icon: "≋" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function AppShell({
  active,
  children,
}: {
  active: string;
  children: ReactNode;
}) {
  return (
    <div className="workspace">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <a href="/overview" className="brand">
          <span className="brand-mark" aria-hidden="true">
            c<span>c</span>
          </span>
          <span>
            ccusage<span className="brand-sub">personal workspace</span>
          </span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              aria-current={active === item.href ? "page" : undefined}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="status-dot" />
          Private by design
          <p>
            Your usage. Your devices.
            <br />
            One clear picture.
          </p>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <span>
            Usage intelligence <span className="topbar-divider">/</span>{" "}
            <strong>{NAV.find((n) => n.href === active)?.label}</strong>
          </span>
          <a href="/settings" className="private-badge">
            <span className="status-dot" />
            Personal account
          </a>
        </header>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer className="workspace-footer">
          ccusage cloud <span>Built for a clearer view of your AI usage.</span>
        </footer>
      </div>
    </div>
  );
}
