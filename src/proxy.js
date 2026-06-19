import { NextResponse } from "next/server";

export function proxy() {
  const response = NextResponse.next();
  response.headers.set("ngrok-skip-browser-warning", "true");
  return response;
}

export const config = {
  matcher: ["/((?!_next/image|favicon.ico).*)"],
};