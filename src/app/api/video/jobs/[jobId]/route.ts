import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface RouteContext {
  params: {
    jobId: string;
  };
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { jobId } = context.params;

    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("render_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch render job", details: error.message },
        { status: 404 }
      );
    }

    return NextResponse.json({ job: data });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch render job", details: String(error) },
      { status: 500 }
    );
  }
}
