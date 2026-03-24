import base64
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

app = FastAPI(title="Learning Platform AI Service")


class GenerateRequest(BaseModel):
    prompt: str


class LessonSection(BaseModel):
    title: str
    content: str


class ChapterMarker(BaseModel):
    title: str
    timestampMs: int = Field(ge=0)


class GeneratedLesson(BaseModel):
    title: str
    objective: str
    lessonText: str
    sections: list[LessonSection]
    chapterMarkers: list[ChapterMarker]
    estimatedDurationMs: int = Field(ge=1000)
    manimScript: str


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


class RenderPipelineError(RuntimeError):
    def __init__(
        self,
        *,
        stage: str,
        command: list[str],
        returncode: int,
        stdout: str,
        stderr: str,
    ) -> None:
        self.stage = stage
        self.command = command
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr
        super().__init__(
            f"{stage} command failed with exit code {returncode}: {' '.join(command)}"
        )


def _tail_text(value: str, max_chars: int = 4000) -> str:
    trimmed = value.strip()
    if len(trimmed) <= max_chars:
        return trimmed
    return trimmed[-max_chars:]


def _extract_json_content(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def _run_ffmpeg(command: list[str]) -> None:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RenderPipelineError(
            stage="ffmpeg",
            command=command,
            returncode=result.returncode,
            stdout=result.stdout,
            stderr=result.stderr,
        )


def _run_command(command: list[str], command_name: str) -> None:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RenderPipelineError(
            stage=command_name.lower(),
            command=command,
            returncode=result.returncode,
            stdout=result.stdout,
            stderr=result.stderr,
        )


def _encode_file(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("utf-8")


def _find_scene_name(script: str) -> str:
    scene_matches = re.findall(
        r"class\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*[^)]*Scene[^)]*\)\s*:",
        script,
    )

    if not scene_matches:
        raise RuntimeError(
            "No renderable Manim Scene class found in script. "
            "Expected a class like 'class MyScene(Scene):'."
        )

    return scene_matches[0]


def _build_manim_script_with_config(payload: ReplayRenderRequest) -> str:
    color = payload.renderOptions.backgroundColor or "#0F172A"
    header_lines = [
        f"config.pixel_width = {payload.renderOptions.width}",
        f"config.pixel_height = {payload.renderOptions.height}",
        f"config.frame_rate = {payload.renderOptions.fps}",
        f"config.background_color = '{color}'",
        "",
    ]
    return "\n".join(header_lines) + payload.script


def _render_with_manim(script_path: Path, scene_name: str, payload: ReplayRenderRequest) -> Path:
    manim_bin = os.getenv("MANIM_PATH", "manim")
    media_dir = script_path.parent / "media"
    media_dir.mkdir(parents=True, exist_ok=True)

    width = payload.renderOptions.width
    height = payload.renderOptions.height
    fps = payload.renderOptions.fps

    command = [
        manim_bin,
        "--progress_bar",
        "none",
        "--disable_caching",
        "-qk",
        "--fps",
        str(fps),
        "-r",
        f"{width},{height}",
        "--format",
        "mp4",
        "--media_dir",
        str(media_dir),
        "--output_file",
        "lesson",
        str(script_path),
        scene_name,
    ]

    _run_command(command, "Manim")

    rendered_candidates = sorted(media_dir.rglob("lesson.mp4"))
    if not rendered_candidates:
        rendered_candidates = sorted(media_dir.rglob("*.mp4"))

    if not rendered_candidates:
        raise RuntimeError("Manim did not produce an MP4 output file")

    return rendered_candidates[0]


def _generate_video_artifacts(payload: ReplayRenderRequest) -> dict:
    ffmpeg_bin = os.getenv("FFMPEG_PATH", "ffmpeg")

    with tempfile.TemporaryDirectory(prefix=f"replay-{payload.lessonId}-") as temp_dir:
        temp_path = Path(temp_dir)
        script_path = temp_path / "scene.py"
        mp4_path = temp_path / "lesson.mp4"
        hls_dir = temp_path / "hls"
        hls_dir.mkdir(parents=True, exist_ok=True)
        hls_manifest_path = hls_dir / "index.m3u8"

        configured_script = _build_manim_script_with_config(payload)
        script_path.write_text(configured_script, encoding="utf-8")
        scene_name = _find_scene_name(configured_script)
        rendered_mp4 = _render_with_manim(script_path, scene_name, payload)

        _run_ffmpeg(
            [
                ffmpeg_bin,
                "-y",
                "-i",
                str(rendered_mp4),
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
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
            "sceneName": scene_name,
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
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY is not configured for ai-service",
        )

    model_name = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    system_prompt = (
        "You are an instructional designer and Manim author. "
        "Return a complete lesson as JSON only. "
        "Do not ask for more information, clarification, or follow-up questions. "
        "Make reasonable assumptions and finalize the lesson."
    )

    user_prompt = (
        "Generate a lesson and return only JSON with this exact top-level structure: "
        "{title, objective, lessonText, sections, chapterMarkers, estimatedDurationMs, manimScript}. "
        "sections must be an array of {title, content}. "
        "chapterMarkers must be an array of {title, timestampMs} in ascending timestamp order. "
        "estimatedDurationMs must be >= 1000. "
        "manimScript must be runnable Python Manim code with exactly one Scene class and a construct method. "
        "Prompt:\n\n"
        f"{payload.prompt}"
    )

    try:
        llm = ChatOpenAI(model=model_name, api_key=api_key, temperature=0)
        response = llm.invoke(
            [
                ("system", system_prompt),
                ("user", user_prompt),
            ]
        )
        content = response.content

        if isinstance(content, list):
            text = "\n".join(
                str(part.get("text", "")) if isinstance(part, dict) else str(part)
                for part in content
            ).strip()
        else:
            text = str(content).strip()

        parsed = json.loads(_extract_json_content(text))
        lesson = GeneratedLesson.model_validate(parsed)

        return {
            "lesson": lesson.model_dump(),
        }
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to generate text via LangChain: {exc}",
        ) from exc


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

    try:
        artifacts = _generate_video_artifacts(payload)
    except RenderPipelineError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "error": "Render pipeline command failed",
                "stage": exc.stage,
                "returncode": exc.returncode,
                "command": " ".join(exc.command),
                "stderrTail": _tail_text(exc.stderr),
                "stdoutTail": _tail_text(exc.stdout),
            },
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Render pipeline failed",
                "message": str(exc),
            },
        ) from exc

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
