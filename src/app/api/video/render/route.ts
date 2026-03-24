import { NextRequest, NextResponse } from "next/server";
import {
  buildProcessVideoPayloadFromScript,
} from "@/lib/replay/compiler";
import { ReplayRenderRequest } from "@/lib/replay/types";
import { createAdminClient } from "@/lib/supabase/admin";

function normalizePythonServiceUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  const withoutHealthSuffix = trimmed.replace(/\/health\/?$/i, "");
  if (/^https?:\/\//i.test(trimmed)) {
    return withoutHealthSuffix.replace(/\/$/, "");
  }

  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(withoutHealthSuffix)) {
    return `http://${withoutHealthSuffix}`.replace(/\/$/, "");
  }

  return `https://${withoutHealthSuffix}`.replace(/\/$/, "");
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const cause =
      error.cause instanceof Error
        ? `${error.cause.name}: ${error.cause.message}`
        : error.cause
        ? String(error.cause)
        : "";
    return cause ? `${error.name}: ${error.message} (cause: ${cause})` : `${error.name}: ${error.message}`;
  }

  return String(error);
}

function readVideoUrlFromDispatchResult(input: unknown): string | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const artifacts = (input as Record<string, unknown>).artifacts;
  if (!artifacts || typeof artifacts !== "object") {
    return null;
  }

  const videoMp4 = (artifacts as Record<string, unknown>).videoMp4;
  if (!videoMp4 || typeof videoMp4 !== "object") {
    return null;
  }

  const signedUrl = (videoMp4 as Record<string, unknown>).signedUrl;
  return typeof signedUrl === "string" && signedUrl.trim() ? signedUrl : null;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkPythonWorkerHealth() {
  const configuredUrl = process.env.PYTHON_AI_SERVICE_URL;

  if (!configuredUrl?.trim()) {
    return {
      ok: false,
      reason: "PYTHON_AI_SERVICE_URL is not configured",
    };
  }

  const pythonServiceUrl = normalizePythonServiceUrl(configuredUrl);
  const healthUrl = `${pythonServiceUrl}/health`;

  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await fetch(healthUrl, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        return {
          ok: false,
          reason: `Python worker health check failed with status ${response.status} at ${healthUrl}`,
        };
      }

      const body = (await response.json()) as { status?: string };
      if (body.status === "ok") {
        return { ok: true as const };
      }

      if (attempt < 2) {
        await sleep(1000);
        continue;
      }

      return {
        ok: false,
        reason: `Python worker health response was not ok at ${healthUrl}`,
      };
    }

    return {
      ok: false,
      reason: `Python worker health check exhausted retries at ${healthUrl}`,
    };
  } catch (error) {
    return {
      ok: false,
      reason: `Python worker is unreachable at ${healthUrl}: ${extractErrorMessage(error)}`,
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as ReplayRenderRequest;

    if (!payload.lessonId?.trim()) {
      return NextResponse.json(
        { error: "lessonId is required" },
        { status: 400 }
      );
    }

    const hasScript = Boolean(payload.script?.trim());

    if (!hasScript) {
      return NextResponse.json(
        { error: "manimScript is required to queue render jobs" },
        { status: 400 }
      );
    }

    let processVideoPayload = buildProcessVideoPayloadFromScript(payload);

    const supabaseUrl =
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const functionName = process.env.SUPABASE_VIDEO_FUNCTION ?? "process-video";

    let jobId: string | null = null;

    if (supabaseUrl && serviceRoleKey) {
      const pythonHealth = await checkPythonWorkerHealth();
      if (!pythonHealth.ok) {
        return NextResponse.json(
          {
            error: "Python worker health check failed",
            details: pythonHealth.reason,
          },
          { status: 503 }
        );
      }
    }

    if (supabaseUrl && serviceRoleKey) {
      const supabase = createAdminClient();
      const now = new Date().toISOString();
      const insertResult = await supabase
        .from("render_jobs")
        .insert({
          lesson_id: payload.lessonId,
          provider: "manim",
          status: "queued",
          request_payload: payload,
          compiled_payload: processVideoPayload,
          queued_at: now,
          updated_at: now,
        })
        .select("id")
        .single();

      if (insertResult.error) {
        return NextResponse.json(
          {
            error: "Failed to persist render job",
            details: insertResult.error.message,
          },
          { status: 500 }
        );
      }

      jobId = insertResult.data.id;
      processVideoPayload = {
        ...processVideoPayload,
        jobId: jobId ?? undefined,
      };
    }

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({
        status: "dry-run",
        message:
          "Render payload compiled, but Supabase function credentials are not configured.",
        jobId,
        functionName,
        payload: processVideoPayload,
      });
    }

    const functionUrl = `${supabaseUrl}/functions/v1/${functionName}`;
    const dispatchResponse = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify(processVideoPayload),
    });

    const dispatchResult = await dispatchResponse.json();
    const videoUrl = readVideoUrlFromDispatchResult(dispatchResult);

    if (!dispatchResponse.ok) {
      if (jobId) {
        const supabase = createAdminClient();
        const now = new Date().toISOString();
        await supabase
          .from("render_jobs")
          .update({
            status: "failed",
            queue_response: dispatchResult,
            error_message: "Failed to dispatch render job",
            completed_at: now,
            updated_at: now,
          })
          .eq("id", jobId);
      }

      return NextResponse.json(
        {
          error: "Failed to dispatch render job",
          jobId,
          functionName,
          details: dispatchResult,
        },
        { status: 502 }
      );
    }

    if (jobId) {
      const supabase = createAdminClient();
      await supabase
        .from("render_jobs")
        .update({
          queue_response: dispatchResult,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    }

    return NextResponse.json({
      status: "queued",
      jobId,
      videoUrl,
      functionName,
      queueResult: dispatchResult,
      payload: processVideoPayload,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to queue video render", details: String(error) },
      { status: 500 }
    );
  }
}
