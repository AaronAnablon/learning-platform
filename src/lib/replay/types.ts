export type ReplayEventType =
  | "pen_stroke"
  | "erase"
  | "slide_change"
  | "voice_marker";

export interface ReplayEventBase {
  id: string;
  timestampMs: number;
  type: ReplayEventType;
}

export interface StrokePoint {
  x: number;
  y: number;
  pressure?: number;
}

export interface PenStrokeEvent extends ReplayEventBase {
  type: "pen_stroke";
  strokeId: string;
  color: string;
  width: number;
  points: StrokePoint[];
}

export interface EraseEvent extends ReplayEventBase {
  type: "erase";
  eraseId: string;
  radius: number;
  points: StrokePoint[];
}

export interface SlideChangeEvent extends ReplayEventBase {
  type: "slide_change";
  slideId: string;
  title?: string;
}

export interface VoiceMarkerEvent extends ReplayEventBase {
  type: "voice_marker";
  markerId: string;
  text: string;
}

export type ReplayEvent =
  | PenStrokeEvent
  | EraseEvent
  | SlideChangeEvent
  | VoiceMarkerEvent;

export interface RenderOptions {
  width: number;
  height: number;
  fps: number;
  backgroundColor: string;
}

export interface ReplayRenderRequest {
  lessonId: string;
  events?: ReplayEvent[];
  script?: string;
  estimatedDurationMs?: number;
  chapterMarkers?: Array<{ title: string; timestampMs: number }>;
  audioUrl?: string;
  options?: Partial<RenderOptions>;
}

export interface ReplaySceneArtifact {
  normalizedEvents: ReplayEvent[];
  manimScript: string;
  estimatedDurationMs: number;
  chapterMarkers: Array<{ title: string; timestampMs: number }>;
}

export interface ProcessVideoPayload {
  jobId?: string;
  lessonId: string;
  provider: "manim";
  script: string;
  estimatedDurationMs: number;
  audioUrl?: string;
  chapterMarkers: Array<{ title: string; timestampMs: number }>;
  events: ReplayEvent[];
  renderOptions: RenderOptions;
}

export const defaultRenderOptions: RenderOptions = {
  width: 1920,
  height: 1080,
  fps: 30,
  backgroundColor: "#0F172A",
};
