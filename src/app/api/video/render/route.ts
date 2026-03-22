import { NextRequest, NextResponse } from "next/server";
import { buildProcessVideoPayload } from "@/lib/replay/compiler";
import { ReplayRenderRequest } from "@/lib/replay/types";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as ReplayRenderRequest;

    if (!payload.lessonId?.trim()) {
      return NextResponse.json(
        { error: "lessonId is required" },
        { status: 400 }
      );
    }

    if (!Array.isArray(payload.events) || payload.events.length === 0) {
      return NextResponse.json(
        { error: "events array is required" },
        { status: 400 }
      );
    }

    let processVideoPayload = buildProcessVideoPayload(payload);

    const supabaseUrl =
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const functionName = process.env.SUPABASE_VIDEO_FUNCTION ?? "process-video";

    let jobId: string | null = null;

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
