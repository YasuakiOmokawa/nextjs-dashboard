import { NextMiddleware, NextResponse } from "next/server";
import { MiddlewareFactory } from "./types";

export function stackMiddleware(
  functions: MiddlewareFactory[] = [],
  index = 0
): NextMiddleware {
  const current = functions[index];

  if (current) {
    const next = stackMiddleware(functions, index + 1);
    return current(next);
  } else {
    // currentがfalseになると、上記のconst next にNextResponse.next が代入される
    return () => NextResponse.next();
  }
}
