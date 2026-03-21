import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as {
      script?: string;
      provider?: "manim";
      // provider?: "manim" | "heygen";
    };

    if (!payload.script) {
      return NextResponse.json({ error: "Missing script" }, { status: 400 });
    }

    return NextResponse.json({
      message:
        "Video render request accepted. Integrate your FFmpeg/Manim worker here.",
      received: payload,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to queue video render", details: String(error) },
      { status: 500 }
    );
  }
}
