interface ProcessVideoPayload {
  jobId?: string;
  lessonId: string;
  provider: "manim";
  script: string;
  estimatedDurationMs: number;
  audioUrl?: string;
  chapterMarkers: Array<{ title: string; timestampMs: number }>;
  events: Array<{
    id: string;
    type: "pen_stroke" | "erase" | "slide_change" | "voice_marker";
    timestampMs: number;
  }>;
  renderOptions: {
    width: number;
    height: number;
    fps: number;
    backgroundColor: string;
  };
}

interface ArtifactInfo {
  path: string;
  signedUrl: string;
}

interface PythonArtifactFile {
  name: string;
  contentB64: string;
}

interface PythonRenderArtifacts {
  sceneScript: PythonArtifactFile;
  videoMp4: PythonArtifactFile;
  hlsManifest: PythonArtifactFile;
  hlsSegments: PythonArtifactFile[];
  metadata: PythonArtifactFile;
}

interface PythonRenderResponse {
  status: string;
  jobId: string;
  artifacts: PythonRenderArtifacts;
}

async function updateRenderJob(
  jobId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const supabaseUrl = edgeRuntime.Deno?.env.get("SUPABASE_URL");
  const serviceRoleKey = edgeRuntime.Deno?.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return;
  }

  await fetch(`${supabaseUrl}/rest/v1/render_jobs?id=eq.${jobId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify(payload),
  });
}

function getSupabaseConfig() {
  const supabaseUrl = edgeRuntime.Deno?.env.get("SUPABASE_URL");
  const serviceRoleKey = edgeRuntime.Deno?.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const bucketName = edgeRuntime.Deno?.env.get("SUPABASE_STORAGE_BUCKET") ?? "render-artifacts";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase runtime configuration is missing for storage uploads");
  }

  return {
    supabaseUrl,
    serviceRoleKey,
    bucketName,
  };
}

async function ensureBucketExists(): Promise<void> {
  const { supabaseUrl, serviceRoleKey, bucketName } = getSupabaseConfig();

  const response = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      id: bucketName,
      name: bucketName,
      public: false,
      file_size_limit: "52428800",
    }),
  });

  if (response.ok) {
    return;
  }

  const errorText = await response.text();
  if (response.status === 409 || errorText.toLowerCase().includes("already exists")) {
    return;
  }

  throw new Error(`Failed to ensure storage bucket: ${errorText}`);
}

async function uploadArtifact(
  path: string,
  body: string | Uint8Array,
  contentType: string
): Promise<void> {
  const { supabaseUrl, serviceRoleKey, bucketName } = getSupabaseConfig();

  const requestBody: BodyInit =
    typeof body === "string"
      ? body
      : Uint8Array.from(body);

  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/${bucketName}/${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "x-upsert": "true",
      },
      body: requestBody,
    }
  );

  if (!response.ok) {
    throw new Error(`Failed uploading ${path}: ${await response.text()}`);
  }
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function renderWithPythonService(
  payload: ProcessVideoPayload,
  jobId: string
): Promise<PythonRenderArtifacts | null> {
  const pythonServiceUrl =
    edgeRuntime.Deno?.env.get("PYTHON_AI_SERVICE_URL") ?? "http://127.0.0.1:8000";

  try {
    const response = await fetch(`${pythonServiceUrl}/render-replay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...payload,
        jobId,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as PythonRenderResponse;
    if (!data.artifacts) {
      return null;
    }

    return data.artifacts;
  } catch {
    return null;
  }
}

async function createPlaceholderArtifactsData(payload: ProcessVideoPayload) {
  const encoder = new TextEncoder();
  const hlsManifest = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:1",
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXTINF:1.0,",
    "segment0.ts",
    "#EXT-X-ENDLIST",
  ].join("\n");

  const metadata = JSON.stringify(
    {
      lessonId: payload.lessonId,
      provider: payload.provider,
      generatedAt: new Date().toISOString(),
      estimatedDurationMs: payload.estimatedDurationMs,
      chapterMarkers: payload.chapterMarkers,
      mode: "placeholder",
    },
    null,
    2
  );

  return {
    sceneScript: {
      name: "scene.py",
      bytes: encoder.encode(payload.script),
      contentType: "text/x-python",
    },
    videoMp4: {
      name: "lesson.mp4",
      bytes: encoder.encode("MVP placeholder MP4 bytes - replace with FFmpeg output"),
      contentType: "video/mp4",
    },
    hlsManifest: {
      name: "index.m3u8",
      bytes: encoder.encode(hlsManifest),
      contentType: "application/vnd.apple.mpegurl",
    },
    hlsSegments: [
      {
        name: "segment0.ts",
        bytes: encoder.encode("placeholder-ts"),
        contentType: "video/mp2t",
      },
    ],
    metadata: {
      name: "metadata.json",
      bytes: encoder.encode(metadata),
      contentType: "application/json",
    },
    mode: "placeholder",
  };
}

async function createSignedUrl(path: string): Promise<string> {
  const { supabaseUrl, serviceRoleKey, bucketName } = getSupabaseConfig();

  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/sign/${bucketName}/${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        expiresIn: 60 * 60 * 24 * 30,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed signing ${path}: ${await response.text()}`);
  }

  const body = (await response.json()) as { signedURL?: string };
  if (!body.signedURL) {
    throw new Error(`Signed URL missing for ${path}`);
  }

  return `${supabaseUrl}/storage/v1${body.signedURL}`;
}

async function createArtifacts(payload: ProcessVideoPayload, jobId: string) {
  await ensureBucketExists();

  const basePath = `${payload.lessonId}/${jobId}`;
  const hlsBasePath = `${basePath}/hls`;

  const pythonArtifacts = await renderWithPythonService(payload, jobId);
  const artifactSource =
    pythonArtifacts === null
      ? await createPlaceholderArtifactsData(payload)
      : {
          sceneScript: {
            name: pythonArtifacts.sceneScript.name,
            bytes: decodeBase64ToBytes(pythonArtifacts.sceneScript.contentB64),
            contentType: "text/x-python",
          },
          videoMp4: {
            name: pythonArtifacts.videoMp4.name,
            bytes: decodeBase64ToBytes(pythonArtifacts.videoMp4.contentB64),
            contentType: "video/mp4",
          },
          hlsManifest: {
            name: pythonArtifacts.hlsManifest.name,
            bytes: decodeBase64ToBytes(pythonArtifacts.hlsManifest.contentB64),
            contentType: "application/vnd.apple.mpegurl",
          },
          hlsSegments: pythonArtifacts.hlsSegments.map((segment) => ({
            name: segment.name,
            bytes: decodeBase64ToBytes(segment.contentB64),
            contentType: "video/mp2t",
          })),
          metadata: {
            name: pythonArtifacts.metadata.name,
            bytes: decodeBase64ToBytes(pythonArtifacts.metadata.contentB64),
            contentType: "application/json",
          },
          mode: "python",
        };

  const scriptPath = `${basePath}/${artifactSource.sceneScript.name}`;
  const videoPath = `${basePath}/${artifactSource.videoMp4.name}`;
  const manifestPath = `${hlsBasePath}/${artifactSource.hlsManifest.name}`;
  const metadataPath = `${basePath}/${artifactSource.metadata.name}`;

  await uploadArtifact(
    scriptPath,
    artifactSource.sceneScript.bytes,
    artifactSource.sceneScript.contentType
  );
  await uploadArtifact(
    videoPath,
    artifactSource.videoMp4.bytes,
    artifactSource.videoMp4.contentType
  );
  await uploadArtifact(
    manifestPath,
    artifactSource.hlsManifest.bytes,
    artifactSource.hlsManifest.contentType
  );
  await uploadArtifact(
    metadataPath,
    artifactSource.metadata.bytes,
    artifactSource.metadata.contentType
  );

  for (const segment of artifactSource.hlsSegments) {
    await uploadArtifact(
      `${hlsBasePath}/${segment.name}`,
      segment.bytes,
      segment.contentType
    );
  }

  const artifacts: Record<string, ArtifactInfo> = {
    sceneScript: {
      path: scriptPath,
      signedUrl: await createSignedUrl(scriptPath),
    },
    hlsManifest: {
      path: manifestPath,
      signedUrl: await createSignedUrl(manifestPath),
    },
    videoMp4: {
      path: videoPath,
      signedUrl: await createSignedUrl(videoPath),
    },
    metadata: {
      path: metadataPath,
      signedUrl: await createSignedUrl(metadataPath),
    },
  };

  const modePath = `${basePath}/render_mode.txt`;
  await uploadArtifact(modePath, artifactSource.mode, "text/plain");
  artifacts.renderMode = {
    path: modePath,
    signedUrl: await createSignedUrl(modePath),
  };

  return artifacts;
}

const edgeRuntime = globalThis as typeof globalThis & {
  Deno?: {
    serve: (handler: (request: Request) => Promise<Response> | Response) => void;
    env: {
      get: (name: string) => string | undefined;
    };
  };
};

if (!edgeRuntime.Deno?.serve) {
  throw new Error("Deno.serve is not available in this runtime");
}

edgeRuntime.Deno.serve(async (request: Request) => {
  try {
    const payload = (await request.json()) as ProcessVideoPayload;

    if (!payload.lessonId?.trim()) {
      return new Response(
        JSON.stringify({ error: "lessonId is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!payload.script?.trim()) {
      return new Response(JSON.stringify({ error: "script is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!Array.isArray(payload.events) || payload.events.length === 0) {
      return new Response(JSON.stringify({ error: "events are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const jobId = payload.jobId ?? crypto.randomUUID();
    const startedAt = new Date().toISOString();

    if (payload.jobId) {
      await updateRenderJob(payload.jobId, {
        status: "running",
        started_at: startedAt,
        updated_at: startedAt,
      });
    }

    const artifacts = await createArtifacts(payload, jobId);
    const completedAt = new Date().toISOString();

    if (payload.jobId) {
      await updateRenderJob(payload.jobId, {
        status: "completed",
        queue_response: {
          status: "completed",
          artifacts,
        },
        completed_at: completedAt,
        updated_at: completedAt,
        error_message: null,
      });
    }

    return new Response(
      JSON.stringify({
        jobId,
        startedAt,
        completedAt,
        status: "completed",
        lessonId: payload.lessonId,
        provider: payload.provider,
        eventCount: payload.events.length,
        estimatedDurationMs: payload.estimatedDurationMs,
        chapterCount: payload.chapterMarkers.length,
        renderOptions: payload.renderOptions,
        artifacts,
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    let jobId: string | null = null;
    try {
      const body = (await request.clone().json()) as { jobId?: string };
      jobId = body.jobId ?? null;
    } catch {
      jobId = null;
    }

    if (jobId) {
      const failedAt = new Date().toISOString();
      await updateRenderJob(jobId, {
        status: "failed",
        error_message: String(error),
        completed_at: failedAt,
        updated_at: failedAt,
      });
    }

    return new Response(
      JSON.stringify({
        error: "Invalid payload",
        details: String(error),
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
