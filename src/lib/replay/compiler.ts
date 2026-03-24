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

function toPythonStringLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, " ");
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

  const replayActions = normalizedEvents.map((event) => {
    const prefix = `        # [${event.timestampMs}ms]`;

    switch (event.type) {
      case "pen_stroke": {
        const strokeId = toPythonStringLiteral(event.strokeId);
        const color = toPythonStringLiteral(event.color);
        const points = event.points
          .map((point) => `to_scene((${point.x.toFixed(4)}, ${point.y.toFixed(4)}))`)
          .join(", ");

        return [
          `${prefix} draw stroke ${strokeId} (${event.points.length} points)`,
          `        points = [${points}]`,
          "        if len(points) >= 2:",
          "            segment_group = VGroup(*[",
          `                Line(points[i], points[i + 1], color='${color}', stroke_width=${Math.max(event.width, 1).toFixed(2)})`,
          "                for i in range(len(points) - 1)",
          "            ])",
          "            self.play(Create(segment_group), run_time=max(0.15, min(1.0, len(points) * 0.03)))",
          `            strokes['${strokeId}'] = segment_group`,
        ].join("\n");
      }
      case "erase": {
        const eraseId = toPythonStringLiteral(event.eraseId);
        return [
          `${prefix} erase ${eraseId} (${event.points.length} points)`,
          `        if '${eraseId}' in strokes:`,
          `            self.play(FadeOut(strokes.pop('${eraseId}')), run_time=0.2)`,
        ].join("\n");
      }
      case "slide_change": {
        const title = toPythonStringLiteral(
          event.title?.trim() || `Slide ${event.slideId}`
        );
        return [
          `${prefix} slide -> ${toPythonStringLiteral(event.slideId)}`,
          `        next_slide = Text('${title}').scale(0.5).to_edge(UP)`,
          "        self.play(Transform(current_slide, next_slide), run_time=0.35)",
        ].join("\n");
      }
      case "voice_marker":
        return `${prefix} voice marker -> ${event.text.replace(/\n/g, " ")}`;
    }
  });

  const script = [
    "from manim import *",
    "",
    "def to_scene(point):",
    "    x = (point[0] - 0.5) * 12",
    "    y = (0.5 - point[1]) * 6.75",
    "    return [x, y, 0]",
    "",
    `class Lesson_${lessonId.replace(/[^a-zA-Z0-9_]/g, "_")}(Scene):`,
    "    def construct(self):",
    "        title = Text('Whiteboard Replay').scale(0.8)",
    "        self.play(FadeIn(title), run_time=0.25)",
    "        self.wait(0.2)",
    "        self.play(FadeOut(title), run_time=0.2)",
    "",
    "        strokes = {}",
    "        current_slide = Text('Lesson Start').scale(0.5).to_edge(UP)",
    "        self.play(FadeIn(current_slide), run_time=0.25)",
    "",
    "        # Replay actions (generated from event stream)",
    ...replayActions,
    "",
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
  assert(Array.isArray(request.events), "events must be provided");
  assert(request.events.length > 0, "events must not be empty");

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

function normalizeChapterMarkers(
  chapterMarkers?: Array<{ title: string; timestampMs: number }>
) {
  if (!Array.isArray(chapterMarkers) || chapterMarkers.length === 0) {
    return [];
  }

  return [...chapterMarkers]
    .filter(
      (marker) =>
        marker.title.trim().length > 0 &&
        Number.isFinite(marker.timestampMs) &&
        marker.timestampMs >= 0
    )
    .sort((left, right) => left.timestampMs - right.timestampMs);
}

function buildFallbackEventsFromMarkers(
  chapterMarkers: Array<{ title: string; timestampMs: number }>
): ReplayEvent[] {
  if (chapterMarkers.length === 0) {
    return [
      {
        id: "slide-0",
        timestampMs: 0,
        type: "slide_change",
        slideId: "intro",
        title: "Lesson Intro",
      },
    ];
  }

  return chapterMarkers.map((marker, index) => ({
    id: `slide-${index + 1}`,
    timestampMs: marker.timestampMs,
    type: "slide_change",
    slideId: `section-${index + 1}`,
    title: marker.title,
  }));
}

export function buildProcessVideoPayloadFromScript(
  request: ReplayRenderRequest
): ProcessVideoPayload {
  const script = request.script?.trim();
  assert(script, "script must be provided");

  const renderOptions = {
    ...defaultRenderOptions,
    ...request.options,
  };

  const chapterMarkers = normalizeChapterMarkers(request.chapterMarkers);
  const normalizedEvents =
    Array.isArray(request.events) && request.events.length > 0
      ? normalizeReplayEvents(request.events)
      : buildFallbackEventsFromMarkers(chapterMarkers);

  const estimatedDurationMs =
    request.estimatedDurationMs && request.estimatedDurationMs > 0
      ? request.estimatedDurationMs
      : Math.max(normalizedEvents[normalizedEvents.length - 1]?.timestampMs ?? 0, 1000);

  return {
    lessonId: request.lessonId,
    provider: "manim",
    script,
    estimatedDurationMs,
    audioUrl: request.audioUrl,
    chapterMarkers,
    events: normalizedEvents,
    renderOptions,
  };
}
