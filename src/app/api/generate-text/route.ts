import { NextRequest, NextResponse } from "next/server";
import { defaultModel, getOpenAIClient } from "@/lib/openai";

export async function POST(request: NextRequest) {
  try {
    const { prompt } = (await request.json()) as { prompt?: string };

    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: defaultModel,
      messages: [{ role: "user", content: prompt }],
    });

    return NextResponse.json({
      text: completion.choices[0]?.message?.content ?? "",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to generate text", details: String(error) },
      { status: 500 }
    );
  }
}
