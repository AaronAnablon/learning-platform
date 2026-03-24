import { NextRequest, NextResponse } from "next/server";
import { defaultModel, getOpenAIClient } from "@/lib/openai";

type GeneratedLesson = {
  title: string;
  objective: string;
  lessonText: string;
  sections: Array<{
    title: string;
    content: string;
  }>;
  chapterMarkers: Array<{
    title: string;
    timestampMs: number;
  }>;
  estimatedDurationMs: number;
  manimScript: string;
};

const lessonJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    objective: { type: "string" },
    lessonText: { type: "string" },
    sections: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          content: { type: "string" },
        },
        required: ["title", "content"],
      },
    },
    chapterMarkers: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          timestampMs: { type: "integer", minimum: 0 },
        },
        required: ["title", "timestampMs"],
      },
    },
    estimatedDurationMs: { type: "integer", minimum: 1000 },
    manimScript: { type: "string" },
  },
  required: [
    "title",
    "objective",
    "lessonText",
    "sections",
    "chapterMarkers",
    "estimatedDurationMs",
    "manimScript",
  ],
} as const;

function parseGeneratedLesson(content: string): GeneratedLesson {
  const parsed = JSON.parse(content) as GeneratedLesson;
  if (!parsed?.title?.trim()) {
    throw new Error("Generated lesson is missing title");
  }

  if (!parsed.lessonText?.trim()) {
    throw new Error("Generated lesson is missing lessonText");
  }

  if (!parsed.manimScript?.trim()) {
    throw new Error("Generated lesson is missing manimScript");
  }

  return parsed;
}

export async function POST(request: NextRequest) {
  try {
    const { prompt } = (await request.json()) as { prompt?: string };

    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: defaultModel,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "generated_lesson",
          strict: true,
          schema: lessonJsonSchema,
        },
      },
      messages: [
        {
          role: "system",
          content:
            "You are an instructional designer and Manim author. Produce a complete lesson directly. Do not ask the user for more information, clarification, or follow-up questions. Make reasonable assumptions and provide final output.",
        },
        {
          role: "user",
          content: [
            "Generate a complete lesson for this prompt and return only valid JSON.",
            "Include a runnable Manim script in manimScript with one Scene class and a construct method.",
            "Set chapterMarkers in ascending timestampMs order.",
            "Prompt:",
            prompt,
          ].join("\n\n"),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const lesson = parseGeneratedLesson(content);

    return NextResponse.json({
      lesson,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to generate text", details: String(error) },
      { status: 500 }
    );
  }
}
