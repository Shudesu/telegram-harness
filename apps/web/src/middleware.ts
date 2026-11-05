import { isLocalUiRequest } from "./local-ui-policy";
import { NextResponse, type NextRequest } from "next/server";
// Local phase 1 only. A Cloud authenticated gateway is a separate release gate.
export function middleware(request: NextRequest) {
  if (
    !isLocalUiRequest(
      process.env.TELEGRAM_LOCAL_UI,
      request.headers.get("host"),
    )
  ) {
    return new NextResponse(
      "Local UI disabled. See README for loopback-only setup.",
      { status: 403 },
    );
  }
  return NextResponse.next();
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
