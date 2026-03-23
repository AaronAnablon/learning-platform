"use client";

import { useState } from "react";
import { RenderJobMonitor } from "@/components/render-job-monitor";

type GenerateResponse = {
  text?: string;
  error?: string;
  details?: string;
};

type QueueRenderResponse = {
  status?: string;
  jobId?: string | null;
  error?: string;
  details?: unknown;
};

type ReplayEvent = {
  id: string;
  timestampMs: number;
  type: "pen_stroke" | "erase" | "slide_change" | "voice_marker";
  slideId?: string;
  title?: string;
  markerId?: string;
  text?: string;
};

function buildLessonChunks(generatedText: string): string[] {
  const cleaned = generatedText.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return [];
  }

  const sentenceParts = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const sourceParts = sentenceParts.length > 0 ? sentenceParts : [cleaned];
  return sourceParts
    .slice(0, 6)
    .map((part) => (part.length > 80 ? `${part.slice(0, 77)}...` : part));
}

function buildDefaultEvents(lessonTitle: string, generatedText: string): ReplayEvent[] {
  const safeTitle = lessonTitle.trim() || "Lesson Intro";
  const chunks = buildLessonChunks(generatedText);

  const events: ReplayEvent[] = [
    {
      id: `slide-${crypto.randomUUID()}`,
      timestampMs: 0,
      type: "slide_change",
      slideId: "intro",
      title: safeTitle,
    },
  ];

  if (chunks.length === 0) {
    events.push({
      id: `marker-${crypto.randomUUID()}`,
      timestampMs: 1200,
      type: "voice_marker",
      markerId: "intro-note",
      text: `${safeTitle} overview`,
    });

    events.push({
      id: `slide-${crypto.randomUUID()}`,
      timestampMs: 4000,
      type: "slide_change",
      slideId: "summary",
      title: "Key takeaway",
    });

    return events;
  }

  chunks.forEach((chunk, index) => {
    const baseTimeMs = (index + 1) * 3500;

    events.push({
      id: `slide-${crypto.randomUUID()}`,
      timestampMs: baseTimeMs,
      type: "slide_change",
      slideId: `section-${index + 1}`,
      title: `Part ${index + 1}`,
    });

    events.push({
      id: `marker-${crypto.randomUUID()}`,
      timestampMs: baseTimeMs + 1200,
      type: "voice_marker",
      markerId: `note-${index + 1}`,
      text: chunk,
    });
  });

  return events;
}

export function MvpStudio() {
  const [prompt, setPrompt] = useState("");
  const [lessonTitle, setLessonTitle] = useState("Intro Lesson");
  const [lessonId, setLessonId] = useState(`lesson-${Date.now()}`);
  const [generatedText, setGeneratedText] = useState("");
  const [eventsJson, setEventsJson] = useState("");
  const [working, setWorking] = useState<"idle" | "generating" | "queuing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastJobId, setLastJobId] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<string>("");

  async function generateLessonText() {
    setWorking("generating");
    setError(null);

    try {
      const response = await fetch("/api/generate-text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      });

      const body = (await response.json()) as GenerateResponse;

      if (!response.ok) {
        setError(body.error ?? "Failed to generate text");
        return;
      }

      setGeneratedText(body.text ?? "");
    } catch (requestError) {
      setError(String(requestError));
    } finally {
      setWorking("idle");
    }
  }

  function parseEventsOrDefault(): ReplayEvent[] {
    if (eventsJson.trim()) {
      const parsed = JSON.parse(eventsJson) as unknown;
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("Events JSON must be a non-empty array.");
      }
      return parsed as ReplayEvent[];
    }

    return buildDefaultEvents(lessonTitle, generatedText);
  }

  async function queueRender() {
    setWorking("queuing");
    setError(null);
    setQueueStatus("");

    try {
      const events = parseEventsOrDefault();
      const response = await fetch("/api/video/render", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lessonId,
          events,
        }),
      });

      const body = (await response.json()) as QueueRenderResponse;

      if (!response.ok) {
        setError(body.error ?? "Failed to queue render");
        return;
      }

      setLastJobId(body.jobId ?? null);
      setQueueStatus(body.status ?? "queued");
    } catch (requestError) {
      if (requestError instanceof SyntaxError) {
        setError("Events JSON is invalid. Please fix formatting and try again.");
      } else {
        setError(String(requestError));
      }
    } finally {
      setWorking("idle");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 p-8 md:p-12">
      <header className="rounded-lg border p-5">
        <h1 className="text-3xl font-bold">Learning Platform MVP Studio</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Generate lesson copy, queue replay render jobs, and inspect output artifacts.
        </p>
      </header>

      <section className="rounded-lg border p-5">
        <h2 className="text-lg font-semibold">1) Generate lesson text</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Use GPT to draft lesson narration or script notes.
        </p>

        <textarea
          className="mt-3 min-h-28 w-full rounded-md border px-3 py-2 text-sm"
          placeholder="Write a prompt for lesson generation"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border px-3 py-2 text-sm font-medium"
            onClick={generateLessonText}
            disabled={working !== "idle" || !prompt.trim()}
          >
            {working === "generating" ? "Generating..." : "Generate Text"}
          </button>
        </div>

        <textarea
          className="mt-3 min-h-28 w-full rounded-md border px-3 py-2 text-sm"
          placeholder="Generated lesson text appears here"
          value={generatedText}
          onChange={(event) => setGeneratedText(event.target.value)}
        />
      </section>

      <section className="rounded-lg border p-5">
        <h2 className="text-lg font-semibold">2) Queue replay render</h2>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Lesson ID
            <input
              className="rounded-md border px-3 py-2"
              value={lessonId}
              onChange={(event) => setLessonId(event.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Lesson Title
            <input
              className="rounded-md border px-3 py-2"
              value={lessonTitle}
              onChange={(event) => setLessonTitle(event.target.value)}
            />
          </label>
        </div>

        <label className="mt-3 flex flex-col gap-1 text-sm">
          Optional custom events JSON
          <textarea
            className="min-h-36 w-full rounded-md border px-3 py-2 text-xs"
            placeholder="Leave blank to use an auto-generated starter timeline"
            value={eventsJson}
            onChange={(event) => setEventsJson(event.target.value)}
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-md border px-3 py-2 text-sm font-medium"
            onClick={queueRender}
            disabled={working !== "idle" || !lessonId.trim()}
          >
            {working === "queuing" ? "Queueing..." : "Queue Render"}
          </button>

          {queueStatus ? (
            <span className="text-sm text-gray-700 dark:text-gray-200">
              Status: {queueStatus}
            </span>
          ) : null}

          {lastJobId ? (
            <span className="text-sm text-gray-700 dark:text-gray-200">
              Job: {lastJobId}
            </span>
          ) : null}
        </div>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </section>

      <RenderJobMonitor initialLessonId={lessonId} focusJobId={lastJobId} />
    </main>
  );
}
