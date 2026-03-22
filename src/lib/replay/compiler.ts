import {
  ProcessVideoPayload,
  ReplayEvent,
  ReplayRenderRequest,
  ReplaySceneArtifact,
  defaultRenderOptions,
} from "@/lib/replay/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function normalizeReplayEvents(events: ReplayEvent[]): ReplayEvent[] {
  assert(Array.isArray(events), "events must be an array");
  assert(events.length > 0, "events must not be empty");

  const normalized = [...events].sort(
    (left, right) => left.timestampMs - right.timestampMs
  );

  for (const event of normalized) {
    assert(event.id, "each event requires an id");
    assert(
      Number.isFinite(event.timestampMs) && event.timestampMs >= 0,
      `event ${event.id} has invalid timestampMs`
    );

    if (event.type === "pen_stroke" || event.type === "erase") {
      assert(event.points.length > 0, `event ${event.id} must include points`);
    }

    if (event.type === "voice_marker") {
      assert(event.text.trim().length > 0, `event ${event.id} has empty marker text`);
    }
  }

  return normalized;
}

function formatVoiceComment(event: ReplayEvent): string | null {
  if (event.type !== "voice_marker") {
    return null;
  }

  return `# [${event.timestampMs}ms] Voice: ${event.text.replace(/\n/g, " ")}`;
}

export function compileEventsToManimScript(
  lessonId: string,
  events: ReplayEvent[]
): ReplaySceneArtifact {
  const normalizedEvents = normalizeReplayEvents(events);
  const estimatedDurationMs = normalizedEvents[normalizedEvents.length - 1].timestampMs;

  const chapterMarkers = normalizedEvents
    .filter((event) => event.type === "slide_change")
    .map((event) => ({
      title: event.title?.trim() || `Slide ${event.slideId}`,
      timestampMs: event.timestampMs,
    }));

  const voiceComments = normalizedEvents
    .map((event) => formatVoiceComment(event))
    .filter((line): line is string => Boolean(line));

  const script = [
    "from manim import *",
    "",
    `class Lesson_${lessonId.replace(/[^a-zA-Z0-9_]/g, "_")}(Scene):`,
    "    def construct(self):",
    "        title = Text('Whiteboard Replay').scale(0.8)",
    "        self.play(FadeIn(title))",
    "        self.wait(0.3)",
    "        self.play(FadeOut(title))",
    "",
    "        # Replay actions (generated from event stream)",
    ...normalizedEvents.map((event) => {
      const prefix = `        # [${event.timestampMs}ms]`;
      switch (event.type) {
        case "pen_stroke":
          return `${prefix} draw stroke ${event.strokeId} (${event.points.length} points)`;
        case "erase":
          return `${prefix} erase ${event.eraseId} (${event.points.length} points)`;
        case "slide_change":
          return `${prefix} slide -> ${event.slideId}`;
        case "voice_marker":
          return `${prefix} voice marker -> ${event.text.replace(/\n/g, " ")}`;
      }
    }),
    "",
    "        # TODO: replace comments above with actual Manim mobject operations",
    "        self.wait(0.5)",
    "",
    "# Voice alignment markers",
    ...voiceComments,
  ].join("\n");

  return {
    normalizedEvents,
    estimatedDurationMs,
    chapterMarkers,
    manimScript: script,
  };
}

export function buildProcessVideoPayload(
  request: ReplayRenderRequest
): ProcessVideoPayload {
  const renderOptions = {
    ...defaultRenderOptions,
    ...request.options,
  };

  const artifact = compileEventsToManimScript(request.lessonId, request.events);

  return {
    lessonId: request.lessonId,
    provider: "manim",
    script: artifact.manimScript,
    estimatedDurationMs: artifact.estimatedDurationMs,
    audioUrl: request.audioUrl,
    chapterMarkers: artifact.chapterMarkers,
    events: artifact.normalizedEvents,
    renderOptions,
  };
}
