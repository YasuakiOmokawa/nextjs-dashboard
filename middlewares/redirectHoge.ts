import {
  NextMiddleware,
  NextRequest,
  NextResponse,
  NextFetchEvent,
} from "next/server";

export function redirectHoge(middleware: NextMiddleware) {
  return async (request: NextRequest, event: NextFetchEvent) => {
    if (request.nextUrl.pathname.startsWith("/hoge")) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    return middleware(request, event);
  };
}
