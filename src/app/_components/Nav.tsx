"use client";

import { usePathname } from "next/navigation";

/**
 * Primary destination is the trailer (`/`). The data tables are secondary —
 * "explore the underlying graph" — and live in a muted group so the home page
 * reads as the product, not as one tab among five (product-design §11 Phase 4).
 */
const EXPLORE = [
  { href: "/sessions", label: "Sessions" },
  { href: "/companies", label: "Companies" },
  { href: "/roles", label: "Roles" },
  { href: "/who-next", label: "Who next" },
] as const;

export default function Nav() {
  const pathname = usePathname();
  const onHome = pathname === "/";
  return (
    <header className="app-bar">
      <div className="app-bar-inner">
        <a className="brand" href="/" aria-label="Conference Compass — home">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Conference Compass</span>
        </a>
        <nav className="app-nav" aria-label="primary">
          <a href="/" data-active={onHome}>
            Who to meet
          </a>
          <span className="app-nav-divider" aria-hidden="true" />
          <span className="app-nav-group-label">explore</span>
          {EXPLORE.map((l) => (
            <a
              key={l.href}
              href={l.href}
              data-active={pathname.startsWith(l.href)}
              className="app-nav-secondary"
            >
              {l.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
