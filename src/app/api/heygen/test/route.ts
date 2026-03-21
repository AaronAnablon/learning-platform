import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "HeyGen features are disabled in this app.",
    },
    { status: 410 }
  );
}

/*
HeyGen endpoint implementation has been intentionally disabled.

Original behavior:
- Read HEYGEN_API_KEY from environment variables
- Call https://api.heygen.com/v2/avatars
- Return reachability/key validation details
*/
