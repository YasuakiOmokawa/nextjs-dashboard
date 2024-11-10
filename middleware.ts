import { NextResponse } from "next/server";
import { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/hoge")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
}
