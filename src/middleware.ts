import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap edge check: no session cookie → send to /login. The real check
 * (token hash lookup, expiry, MFA state, role) happens server-side in requireUser().
 */
const PUBLIC = ["/login", "/register", "/_next", "/favicon", "/guide", "/scenarios", "/library"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // The compliance guide (home, search, guides, library) needs no account.
  if (pathname === "/" || PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (!req.cookies.get("fc_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
