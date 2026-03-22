import base64
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Learning Platform AI Service")


class GenerateRequest(BaseModel):
    prompt: str


class StrokePoint(BaseModel):
    x: float
    y: float
    pressure: float | None = None


class ReplayEvent(BaseModel):
    id: str
    timestampMs: int = Field(ge=0)
    type: Literal["pen_stroke", "erase", "slide_change", "voice_marker"]
    strokeId: str | None = None
    eraseId: str | None = None
    slideId: str | None = None
    markerId: str | None = None
    title: str | None = None
    text: str | None = None
    color: str | None = None
    width: float | None = None
    radius: float | None = None
    points: list[StrokePoint] | None = None


class RenderOptions(BaseModel):
    width: int = 1920
    height: int = 1080
    fps: int = 30
    backgroundColor: str = "#0F172A"


class ReplayCompileRequest(BaseModel):
    lessonId: str
    events: list[ReplayEvent]


class ReplayRenderRequest(BaseModel):
    jobId: str | None = None
    lessonId: str
    provider: Literal["manim"] = "manim"
    script: str
    estimatedDurationMs: int
    audioUrl: str | None = None
    chapterMarkers: list[dict]
    events: list[ReplayEvent]
    renderOptions: RenderOptions


def _run_ffmpeg(command: list[str]) -> None:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"FFmpeg command failed: {' '.join(command)}\n"
            f"stdout: {result.stdout}\n"
            f"stderr: {result.stderr}"
        )


def _encode_file(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("utf-8")


def _generate_video_artifacts(payload: ReplayRenderRequest) -> dict:
    ffmpeg_bin = os.getenv("FFMPEG_PATH", "ffmpeg")
    duration_seconds = max(1, int(round(payload.estimatedDurationMs / 1000)))
    width = payload.renderOptions.width
    height = payload.renderOptions.height
    fps = payload.renderOptions.fps
    color = payload.renderOptions.backgroundColor.lstrip("#") or "0F172A"

    with tempfile.TemporaryDirectory(prefix=f"replay-{payload.lessonId}-") as temp_dir:
        temp_path = Path(temp_dir)
        script_path = temp_path / "scene.py"
        mp4_path = temp_path / "lesson.mp4"
        hls_dir = temp_path / "hls"
        hls_dir.mkdir(parents=True, exist_ok=True)
        hls_manifest_path = hls_dir / "index.m3u8"

        script_path.write_text(payload.script, encoding="utf-8")

        _run_ffmpeg(
            [
                ffmpeg_bin,
                "-y",
                "-f",
                "lavfi",
                "-i",
                f"color=c={color}:s={width}x{height}:d={duration_seconds}:r={fps}",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                str(mp4_path),
            ]
        )

        _run_ffmpeg(
            [
                ffmpeg_bin,
                "-y",
                "-i",
                str(mp4_path),
                "-codec",
                "copy",
                "-start_number",
                "0",
                "-hls_time",
                "1",
                "-hls_list_size",
                "0",
                "-f",
                "hls",
                str(hls_manifest_path),
            ]
        )

        segment_files = []
        for segment_path in sorted(hls_dir.glob("*.ts")):
            segment_files.append(
                {
                    "name": segment_path.name,
                    "contentB64": _encode_file(segment_path),
                }
            )

        metadata = {
            "lessonId": payload.lessonId,
            "jobId": payload.jobId,
            "provider": payload.provider,
            "estimatedDurationMs": payload.estimatedDurationMs,
            "chapterMarkers": payload.chapterMarkers,
        }

        return {
            "sceneScript": {
                "name": "scene.py",
                "contentB64": _encode_file(script_path),
            },
            "videoMp4": {
                "name": "lesson.mp4",
                "contentB64": _encode_file(mp4_path),
            },
            "hlsManifest": {
                "name": "index.m3u8",
                "contentB64": _encode_file(hls_manifest_path),
            },
            "hlsSegments": segment_files,
            "metadata": {
                "name": "metadata.json",
                "contentB64": base64.b64encode(
                    json.dumps(metadata, indent=2).encode("utf-8")
                ).decode("utf-8"),
            },
        }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/generate")
def generate_text(payload: GenerateRequest):
    return {
        "message": "Integrate LangChain pipeline here",
        "prompt": payload.prompt,
    }


@app.post("/compile-replay")
def compile_replay(payload: ReplayCompileRequest):
    ordered_events = sorted(payload.events, key=lambda event: event.timestampMs)
    if len(ordered_events) == 0:
        return {"error": "events must not be empty"}

    chapter_markers = [
        {
            "title": event.title or f"Slide {event.slideId}",
            "timestampMs": event.timestampMs,
        }
        for event in ordered_events
        if event.type == "slide_change"
    ]

    script_lines = [
        "from manim import *",
        "",
        f"class Lesson_{payload.lessonId.replace('-', '_')}(Scene):",
        "    def construct(self):",
        "        # Generated replay timeline",
    ]

    for event in ordered_events:
        script_lines.append(f"        # [{event.timestampMs}ms] {event.type}::{event.id}")

    script_lines.append("        self.wait(0.5)")

    return {
        "lessonId": payload.lessonId,
        "estimatedDurationMs": ordered_events[-1].timestampMs,
        "chapterMarkers": chapter_markers,
        "script": "\n".join(script_lines),
    }


@app.post("/render-replay")
def render_replay(payload: ReplayRenderRequest):
    if payload.provider != "manim":
        return {"error": "Only manim provider is supported in MVP"}

    artifacts = _generate_video_artifacts(payload)

    return {
        "status": "completed",
        "jobId": payload.jobId or f"render-{payload.lessonId}",
        "lessonId": payload.lessonId,
        "provider": payload.provider,
        "eventCount": len(payload.events),
        "chapterCount": len(payload.chapterMarkers),
        "estimatedDurationMs": payload.estimatedDurationMs,
        "artifacts": artifacts,
    }
