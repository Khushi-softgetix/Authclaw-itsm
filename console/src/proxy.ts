import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const unsafeMethod = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  if (path.startsWith("/api/") && unsafeMethod) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    const fetchSite = request.headers.get("sec-fetch-site");
    let originHost = "";
    try {
      originHost = origin ? new URL(origin).host : "";
    } catch {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }
    if ((originHost && originHost !== host) || (fetchSite && !["same-origin", "none"].includes(fetchSite))) {
      return NextResponse.json({ error: "Cross-site request rejected" }, { status: 403 });
    }
  }
  const publicMarketingFiles = new Set([
    "/",
    "/product",
    "/itsm",
    "/itsm/roles",
    "/pricing",
    "/security",
    "/company",
    "/privacy",
    "/terms",
    "/cookies",
    "/subprocessors",
    "/dpa",
    "/demo",
    "/early-access",
    "/index.html",
    "/product.html",
    "/itsm.html",
    "/pricing.html",
    "/security.html",
    "/company.html",
    "/robots.txt",
    "/sitemap.xml",
    "/opengraph-image",
  ]);

  // 1. Define public and asset paths
  const isPublicPath =
    publicMarketingFiles.has(path) ||
    path.startsWith("/opengraph-image") ||
    path.startsWith("/twitter-image") ||
    path === "/login" ||
    path === "/itsm/login" ||
    path === "/signup" ||
    path.startsWith("/trust/shared") ||
    path.startsWith("/trust-center") ||
    path.startsWith("/api/auth");
  const isAssetPath =
    path.startsWith("/_next") ||
    path.startsWith("/favicon.ico") ||
    path.startsWith("/api/"); // skip standard middleware for internal APIs (handled in routes)

  if (isAssetPath) {
    return NextResponse.next();
  }

  // 2. Extract session cookie
  const sessionCookie = request.cookies.get("authclaw_session")?.value;
  const session = Boolean(sessionCookie?.startsWith("acl_session_"));

  // 3. Handle redirects
  if (!session && path.startsWith("/developer")) {
    return NextResponse.redirect(new URL("/login?developer=1", request.url));
  }

  if (!session && !isPublicPath) {
    if (path.startsWith("/itsm")) {
      return NextResponse.redirect(new URL("/itsm/login", request.url));
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const hasAccessError = request.nextUrl.searchParams.get("error") === "access_denied";

  if (session && path === "/itsm/login") {
    if (!hasAccessError) {
      // Redirect authenticated user away from ITSM login
      const returnTo =
        request.nextUrl.searchParams.get("returnTo") ||
        request.nextUrl.searchParams.get("redirect");
      const safeRedirect =
        returnTo && returnTo.startsWith("/itsm") && !returnTo.startsWith("//")
          ? returnTo
          : "/itsm/incidents";
      return NextResponse.redirect(new URL(safeRedirect, request.url));
    }
  }

  if (session && path === "/login") {
    if (request.nextUrl.searchParams.get("developer") !== "1" && !hasAccessError) {
      // Redirect authenticated user away from Governance login
      const returnTo =
        request.nextUrl.searchParams.get("returnTo") ||
        request.nextUrl.searchParams.get("redirect");
      const safeRedirect =
        returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") && !returnTo.startsWith("/itsm")
          ? returnTo
          : "/overview";
      return NextResponse.redirect(new URL(safeRedirect, request.url));
    }
  }

  if (session && path === "/signup") {
    return NextResponse.redirect(new URL("/overview", request.url));
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-authclaw-pathname", path);
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
