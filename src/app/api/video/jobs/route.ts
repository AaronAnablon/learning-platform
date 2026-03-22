import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient();
    const lessonId = request.nextUrl.searchParams.get("lessonId");
    const limitValue = Number(request.nextUrl.searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(limitValue)
      ? Math.min(Math.max(Math.floor(limitValue), 1), 100)
      : 20;

    let query = supabase
      .from("render_jobs")
      .select(
        "id,lesson_id,provider,status,created_at,updated_at,queued_at,started_at,completed_at,error_message"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (lessonId) {
      query = query.eq("lesson_id", lessonId);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch render jobs", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ jobs: data });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch render jobs", details: String(error) },
      { status: 500 }
    );
  }
}
