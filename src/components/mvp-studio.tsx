"use client";

import { useRef, useState } from "react";

type GenerateResponse = {
  lesson?: GeneratedLesson;
  error?: string;
  details?: string;
};

type GeneratedLesson = {
  title: string;
  objective: string;
  lessonText: string;
  sections: Array<{ title: string; content: string }>;
  chapterMarkers: Array<{ title: string; timestampMs: number }>;
  renderPlan?: Array<{
    id: string;
    title: string;
    timestampMs: number;
    onScreenText: string;
    visualGoal: string;
  }>;
  estimatedDurationMs: number;
  manimScript: string;
};

type QueueRenderResponse = {
  status?: string;
  jobId?: string | null;
  videoUrl?: string | null;
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

function chapterMarkersToEvents(
  chapterMarkers: Array<{ title: string; timestampMs: number }>
): ReplayEvent[] {
  return chapterMarkers
    .filter(
      (marker) =>
        marker.title.trim().length > 0 &&
        Number.isFinite(marker.timestampMs) &&
        marker.timestampMs >= 0
    )
    .sort((left, right) => left.timestampMs - right.timestampMs)
    .map((marker, index) => ({
      id: `slide-${index + 1}`,
      timestampMs: marker.timestampMs,
      type: "slide_change",
      slideId: `section-${index + 1}`,
      title: marker.title,
    }));
}

function renderPlanToEvents(
  renderPlan: Array<{
    id: string;
    title: string;
    timestampMs: number;
    onScreenText: string;
  }>
): ReplayEvent[] {
  return [...renderPlan]
    .filter(
      (step) =>
        step.id.trim().length > 0 &&
        step.title.trim().length > 0 &&
        Number.isFinite(step.timestampMs) &&
        step.timestampMs >= 0
    )
    .sort((left, right) => left.timestampMs - right.timestampMs)
    .flatMap((step, index) => {
      const baseTimestamp = step.timestampMs;
      const markerTimestamp = baseTimestamp + 600;

      return [
        {
          id: `slide-${step.id}`,
          timestampMs: baseTimestamp,
          type: "slide_change" as const,
          slideId: `section-${index + 1}`,
          title: step.title,
        },
        {
          id: `marker-${step.id}`,
          timestampMs: markerTimestamp,
          type: "voice_marker" as const,
          markerId: `note-${index + 1}`,
          text: step.onScreenText,
        },
      ];
    });
}

export function MvpStudio() {
  const [prompt, setPrompt] = useState("");
  const [lessonTitle, setLessonTitle] = useState("Intro Lesson");
  const [lessonId] = useState(`lesson-${Date.now()}`);
  const [generatedLesson, setGeneratedLesson] = useState<GeneratedLesson | null>(null);
  const [generatedLessonJson, setGeneratedLessonJson] = useState("");
  const [working, setWorking] = useState<"idle" | "generating" | "queuing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastJobId, setLastJobId] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<string>("");
  const [queuedVideoUrl, setQueuedVideoUrl] = useState<string | null>(null);
  const [renderErrorDetail, setRenderErrorDetail] = useState<string | null>(null);
  const generateAbortController = useRef<AbortController | null>(null);
  const activeManimScript = generatedLesson?.manimScript?.trim() ?? "";
  const hasValidManimScript = activeManimScript.length > 0;

  async function generateLessonText() {
    const controller = new AbortController();
    generateAbortController.current = controller;
    setWorking("generating");
    setError(null);

    try {
      const response = await fetch("/api/generate-text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      });

      const body = (await response.json()) as GenerateResponse;

      if (!response.ok) {
        setError(body.error ?? "Failed to generate text");
        return;
      }

      if (!body.lesson) {
        setError("Generation response did not include lesson JSON.");
        return;
      }

      setGeneratedLesson(body.lesson);
      setGeneratedLessonJson(JSON.stringify(body.lesson, null, 2));

      if (body.lesson.title?.trim()) {
        setLessonTitle(body.lesson.title.trim());
      }
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") {
        setError("Generation cancelled.");
      } else {
        setError(String(requestError));
      }
    } finally {
      generateAbortController.current = null;
      setWorking("idle");
    }
  }

  function cancelLessonGeneration() {
    generateAbortController.current?.abort();
  }

  async function findVideoUrlForJob(jobId: string): Promise<string | null> {
    const response = await fetch(`/api/video/jobs/${jobId}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as {
      job?: {
        queue_response?: {
          artifacts?: {
            videoMp4?: {
              signedUrl?: string;
            };
          };
        };
      };
    };

    const signedUrl = body.job?.queue_response?.artifacts?.videoMp4?.signedUrl;
    return typeof signedUrl === "string" && signedUrl.trim().length > 0
      ? signedUrl
      : null;
  }

  async function getRenderErrorDetail(jobId: string): Promise<string | null> {
    const response = await fetch(`/api/video/jobs/${jobId}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as {
      job?: {
        error_message?: string | null;
        queue_response?: {
          status?: string;
          detail?: { error?: string; message?: string; stderrTail?: string };
          message?: string;
        };
      };
    };

    const errorMessage = body.job?.error_message?.trim();
    const detail = body.job?.queue_response?.detail;
    const detailMessage = detail?.error ?? detail?.message;
    const stderrTail = detail?.stderrTail;
    const fallback = body.job?.queue_response?.message;

    return errorMessage || detailMessage || stderrTail || fallback || null;
  }

  async function waitForVideoUrl(jobId: string): Promise<string | null> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const videoUrl = await findVideoUrlForJob(jobId);
      if (videoUrl) {
        return videoUrl;
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    return null;
  }

  function parseEventsOrDefault(): ReplayEvent[] {
    if (generatedLesson?.renderPlan?.length) {
      const mappedEvents = renderPlanToEvents(generatedLesson.renderPlan);
      if (mappedEvents.length > 0) {
        return mappedEvents;
      }
    }

    if (generatedLesson?.chapterMarkers?.length) {
      const markerEvents = chapterMarkersToEvents(generatedLesson.chapterMarkers);
      if (markerEvents.length > 0) {
        return markerEvents;
      }
    }

    return buildDefaultEvents(lessonTitle, generatedLesson?.lessonText ?? "");
  }

  async function queueRender() {
    if (!hasValidManimScript) {
      setError("Generate lesson JSON with a valid manimScript before queueing render.");
      return;
    }

    setWorking("queuing");
    setError(null);
    setQueueStatus("");
    setQueuedVideoUrl(null);
    setRenderErrorDetail(null);

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
          script: activeManimScript,
          chapterMarkers: generatedLesson?.chapterMarkers,
          estimatedDurationMs: generatedLesson?.estimatedDurationMs,
        }),
      });

      const body = (await response.json()) as QueueRenderResponse;

      if (!response.ok) {
        setError(body.error ?? "Failed to queue render");
        return;
      }

      setLastJobId(body.jobId ?? null);
      setQueueStatus(body.status ?? "queued");

      if (body.videoUrl) {
        setQueuedVideoUrl(body.videoUrl);
      } else if (body.jobId) {
        const resolvedVideoUrl = await waitForVideoUrl(body.jobId);
        setQueuedVideoUrl(resolvedVideoUrl);
        if (!resolvedVideoUrl) {
          const detail = await getRenderErrorDetail(body.jobId);
          if (detail) {
            setRenderErrorDetail(detail);
          }
        }
      }
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
          Generate lesson copy, queue replay render jobs, and view the video output.
        </p>
      </header>

      <section className="rounded-lg border p-5">
        <h2 className="text-lg font-semibold">Generate lesson text</h2>

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
            {working === "generating" ? "Generating..." : "Generate Lesson"}
          </button>

          {working === "generating" ? (
            <button
              type="button"
              className="rounded-md border px-3 py-2 text-sm font-medium"
              onClick={cancelLessonGeneration}
            >
              Cancel
            </button>
          ) : null}
        </div>

        <textarea
          className="mt-3 min-h-28 w-full rounded-md border px-3 py-2 text-sm"
          placeholder="Generated lesson JSON appears here"
          value={generatedLessonJson}
          readOnly
        />
      </section>

      <section className="rounded-lg border p-5">
        <h2 className="text-lg font-semibold">Generate video</h2>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-md border px-3 py-2 text-sm font-medium"
            onClick={queueRender}
            disabled={working !== "idle" || !lessonId.trim() || !hasValidManimScript}
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

        {!hasValidManimScript ? (
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
            Generate lesson JSON first. Queueing requires a non-empty manimScript.
          </p>
        ) : null}

        {working === "queuing" ? (
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
            Rendering is queued. This can take a few minutes.
          </p>
        ) : null}

        {queuedVideoUrl ? (
          <div className="mt-3 space-y-2">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              Video is ready. <a className="underline" href={queuedVideoUrl}>Open video</a>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Latest queued output video preview
            </p>
            <video controls className="w-full rounded border" src={queuedVideoUrl} />
          </div>
        ) : null}

        {renderErrorDetail ? (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <p className="font-semibold">Render error detail</p>
            <p className="mt-1 whitespace-pre-wrap">{renderErrorDetail}</p>
          </div>
        ) : null}

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </section>
    </main>
  );
}
