import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    app: "learning-platform",
    timestamp: new Date().toISOString(),
  });
}
