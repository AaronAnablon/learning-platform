import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type StorageObject = {
  name: string;
  path: string;
  signedUrl?: string;
  size?: number | null;
  created_at?: string | null;
};

async function createSignedUrl(bucket: string, path: string): Promise<string | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 60 * 60 * 24 * 7);

    if (error || !data?.signedUrl) {
      return null;
    }

    return data.signedUrl;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const lessonId = request.nextUrl.searchParams.get("lessonId")?.trim();
    if (!lessonId) {
      return NextResponse.json(
        { error: "lessonId is required" },
        { status: 400 }
      );
    }

    const bucketName = process.env.SUPABASE_STORAGE_BUCKET ?? "render-artifacts";
    const supabase = createAdminClient();
    const prefix = `${lessonId}/`;

    const { data, error } = await supabase.storage
      .from(bucketName)
      .list(prefix, { limit: 200, offset: 0, sortBy: { column: "name", order: "desc" } });

    if (error) {
      return NextResponse.json(
        { error: "Failed to list storage artifacts", details: error.message },
        { status: 500 }
      );
    }

    const items: StorageObject[] = [];
    for (const item of data ?? []) {
      if (!item?.name) {
        continue;
      }

      const path = `${prefix}${item.name}`;
      const signedUrl = item.name.endsWith(".mp4")
        ? (await createSignedUrl(bucketName, path)) ?? undefined
        : undefined;

      items.push({
        name: item.name,
        path,
        signedUrl,
        size: item.metadata?.size ?? null,
        created_at: item.created_at ?? null,
      });
    }

    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to list storage artifacts", details: String(error) },
      { status: 500 }
    );
  }
}
