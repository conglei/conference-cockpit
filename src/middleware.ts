import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional HTTP Basic Auth gate for the deployed web app.
 *
 * A solo deployment is **public by default**. Set `SITE_PASSWORD` (and optionally
 * `SITE_USER`, default "admin") in the host's environment to require a password
 * before any page renders — the easiest way to keep your instance private. When
 * `SITE_PASSWORD` is unset (local dev, or an intentionally public demo) the gate
 * is off entirely and adds zero overhead.
 *
 * This protects the **web UI only**; the agent reads the DB directly, never
 * through the app. Always serve over HTTPS (Render/Vercel do) so the credentials
 * aren't sent in the clear.
 */
export function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next(); // no password configured → open

  const expectedUser = process.env.SITE_USER ?? "admin";
  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const [user, ...rest] = atob(header.slice(6)).split(":");
    const pass = rest.join(":"); // tolerate ':' inside the password
    if (user === expectedUser && pass === password) return NextResponse.next();
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Conference Compass", charset="UTF-8"' },
  });
}

export const config = {
  // Gate every route except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
