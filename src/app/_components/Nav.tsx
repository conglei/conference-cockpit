"use client";

import { usePathname } from "next/navigation";

/**
 * A single, clean nav row: the brand goes home (the "who to meet" trailer), and
 * one flat, uniformly-styled list of destinations. The row never wraps — it
 * scrolls horizontally on narrow screens — so the header stays one tidy line.
 */
const LINKS = [
  { href: "/", label: "Who to meet", exact: true },
  { href: "/sessions", label: "Sessions" },
  { href: "/people", label: "People" },
  { href: "/companies", label: "Companies" },
  { href: "/roles", label: "Roles" },
  { href: "/who-next", label: "Who next" },
] as const;

export default function Nav() {
  const pathname = usePathname();
  return (
    <header className="app-bar">
      <div className="app-bar-inner">
        <a className="brand" href="/" aria-label="Conference Compass — home">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Conference Compass</span>
        </a>
        <nav className="app-nav" aria-label="primary">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              data-active={
                "exact" in l && l.exact ? pathname === l.href : pathname.startsWith(l.href)
              }
            >
              {l.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
