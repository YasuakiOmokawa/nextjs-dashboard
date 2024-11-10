import {
  NextMiddleware,
  NextRequest,
  NextResponse,
  NextFetchEvent,
} from "next/server";
import { MiddlewareFactory } from "./types";

export const redirectHoge: MiddlewareFactory = (middleware: NextMiddleware) => {
  return async (request: NextRequest, _event: NextFetchEvent) => {
    if (request.nextUrl.searchParams.has("redirect")) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    return middleware(request, _event);
  };
};
