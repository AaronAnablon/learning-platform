import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface RouteContext {
  params: {
    jobId: string;
  };
}

type ArtifactRecord = {
  path?: unknown;
  signedUrl?: unknown;
};

async function refreshArtifactSignedUrls(input: unknown) {
  if (!input || typeof input !== "object") {
    return input;
  }

  const typedInput = input as Record<string, unknown>;
  const artifacts = typedInput.artifacts;

  if (!artifacts || typeof artifacts !== "object") {
    return input;
  }

  const bucketName = process.env.SUPABASE_STORAGE_BUCKET ?? "render-artifacts";
  const supabase = createAdminClient();
  const refreshedArtifacts: Record<string, unknown> = {
    ...(artifacts as Record<string, unknown>),
  };

  await Promise.all(
    Object.entries(artifacts as Record<string, unknown>).map(async ([key, value]) => {
      if (!value || typeof value !== "object") {
        return;
      }

      const artifact = value as ArtifactRecord;
      if (typeof artifact.path !== "string" || !artifact.path.trim()) {
        return;
      }

      const { data, error } = await supabase.storage
        .from(bucketName)
        .createSignedUrl(artifact.path, 60 * 60 * 24 * 7);

      if (error || !data?.signedUrl) {
        return;
      }

      refreshedArtifacts[key] = {
        ...(artifact as Record<string, unknown>),
        signedUrl: data.signedUrl,
      };
    })
  );

  return {
    ...typedInput,
    artifacts: refreshedArtifacts,
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

    const queueResponse = await refreshArtifactSignedUrls(data.queue_response);

    return NextResponse.json({
      job: {
        ...data,
        queue_response: queueResponse,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch render job", details: String(error) },
      { status: 500 }
    );
  }
}
