"use client";

import { usePathname } from "next/navigation";

/** Top-level destinations, in display order. */
const LINKS = [
  { href: "/plan", label: "Plan" },
  { href: "/", label: "Companies" },
  { href: "/roles", label: "Roles" },
  { href: "/applications", label: "Applications" },
  { href: "/who-next", label: "Who next" },
] as const;

/**
 * Global nav bar rendered on every page (in `layout.tsx`). The active link is
 * marked via `data-active` so the styling in `globals.css` can highlight it.
 * `/` only matches exactly (otherwise it would light up on every route).
 */
export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="app-nav" aria-label="primary">
      {LINKS.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <a key={l.href} href={l.href} data-active={active}>
            {l.label}
          </a>
        );
      })}
    </nav>
  );
}
