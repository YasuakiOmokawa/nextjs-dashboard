import { NextFetchEvent, NextResponse, type NextRequest } from "next/server";
import { stackMiddleware } from "./middlewares/stackMiddleware";
import { redirectHoge } from "./middlewares/redirectHoge";
import { MiddlewareFactory } from "./middlewares/types";

// mapping route pattern and middleware
const routeMiddlewares: { [key: string]: MiddlewareFactory[] } = {
  "/hoge/*": [redirectHoge],
};

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const response = NextResponse.next();
  const path = request.nextUrl.pathname;

  for (const route in routeMiddlewares) {
    const regex = new RegExp(route);

    if (regex.test(path)) {
      const middlewares = routeMiddlewares[route];
      const stackedMiddleware = stackMiddleware(middlewares);
      return stackedMiddleware(request, event);
    }
  }
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
