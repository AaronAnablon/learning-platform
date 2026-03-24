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
  renderPlan: Array<{
    id: string;
    title: string;
    timestampMs: number;
    onScreenText: string;
    visualGoal: string;
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
    renderPlan: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          timestampMs: { type: "integer", minimum: 0 },
          onScreenText: { type: "string" },
          visualGoal: { type: "string" },
        },
        required: ["id", "title", "timestampMs", "onScreenText", "visualGoal"],
      },
    },
    estimatedDurationMs: { type: "integer", minimum: 1000 },
    manimScript: {
      type: "string",
      minLength: 80,
      pattern:
        "class\\s+[A-Za-z_][A-Za-z0-9_]*\\s*\\([^)]*Scene[^)]*\\)\\s*:[\\s\\S]*def\\s+construct\\s*\\(\\s*self\\s*\\)",
    },
  },
  required: [
    "title",
    "objective",
    "lessonText",
    "sections",
    "chapterMarkers",
    "renderPlan",
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

  if (!Array.isArray(parsed.renderPlan) || parsed.renderPlan.length === 0) {
    throw new Error("Generated lesson is missing renderPlan");
  }

  const sortedRenderPlan = [...parsed.renderPlan].sort(
    (left, right) => left.timestampMs - right.timestampMs
  );

  return {
    ...parsed,
    chapterMarkers: [...parsed.chapterMarkers].sort(
      (left, right) => left.timestampMs - right.timestampMs
    ),
    renderPlan: sortedRenderPlan,
  };
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
            "You are an instructional designer and Manim author. Produce complete output directly as JSON only. Do not ask for clarification. Ensure the renderPlan timeline and chapterMarkers match what the manimScript animates on screen.",
        },
        {
          role: "user",
          content: [
            "Generate a complete lesson for this prompt and return only valid JSON following the schema.",
            "Return fields: title, objective, lessonText, sections, chapterMarkers, renderPlan, estimatedDurationMs, manimScript.",
            "renderPlan must be a chronological array of steps with {id,title,timestampMs,onScreenText,visualGoal}.",
            "manimScript must be runnable Python code with exactly one Scene class and a construct method.",
            "The script must render visible objects (Text/MathTex/Shapes) and animate all renderPlan steps in sequence.",
            "Do not wrap the script with markdown code fences.",
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
