"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type RenderJob = {
  id: string;
  lesson_id: string;
  status: "dry_run" | "queued" | "running" | "completed" | "failed";
  provider: string;
  created_at: string;
  updated_at: string;
  error_message: string | null;
};

type RenderJobDetail = RenderJob & {
  queue_response?: Record<string, unknown> | null;
};

type ArtifactInfo = {
  name: string;
  path: string;
  signedUrl: string;
};

type StorageArtifact = {
  name: string;
  path: string;
  signedUrl?: string;
  size?: number | null;
  created_at?: string | null;
};

interface RenderJobMonitorProps {
  initialLessonId?: string;
  focusJobId?: string | null;
}

function readArtifacts(input: unknown): ArtifactInfo[] {
  if (!input || typeof input !== "object") {
    return [];
  }

  const response = input as Record<string, unknown>;
  const artifacts = response.artifacts;

  if (!artifacts || typeof artifacts !== "object") {
    return [];
  }

  return Object.entries(artifacts)
    .map(([name, value]) => {
      if (!value || typeof value !== "object") {
        return null;
      }

      const typedValue = value as Record<string, unknown>;
      const path = typedValue.path;
      const signedUrl = typedValue.signedUrl;

      if (typeof path !== "string" || typeof signedUrl !== "string") {
        return null;
      }

      return { name, path, signedUrl };
    })
    .filter((value): value is ArtifactInfo => Boolean(value));
}

export function RenderJobMonitor({
  initialLessonId = "",
  focusJobId = null,
}: RenderJobMonitorProps) {
  const [lessonId, setLessonId] = useState(initialLessonId);
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<RenderJobDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageItems, setStorageItems] = useState<StorageArtifact[]>([]);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const query = new URLSearchParams();
      if (lessonId.trim()) {
        query.set("lessonId", lessonId.trim());
      }

      const response = await fetch(`/api/video/jobs?${query.toString()}`);
      const body = (await response.json()) as {
        jobs?: RenderJob[];
        error?: string;
        details?: string;
      };

      if (!response.ok) {
        setError(body.error ?? "Failed to load jobs");
        setJobs([]);
        return;
      }

      setJobs(body.jobs ?? []);
    } catch (fetchError) {
      setError(String(fetchError));
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  const loadJobDetails = useCallback(async (jobId: string) => {
    setDetailLoading(true);

    try {
      const response = await fetch(`/api/video/jobs/${jobId}`);
      const body = (await response.json()) as {
        job?: RenderJobDetail;
        error?: string;
      };

      if (!response.ok) {
        setError(body.error ?? "Failed to load job details");
        setSelectedJob(null);
        return;
      }

      setSelectedJob(body.job ?? null);
    } catch (detailError) {
      setError(String(detailError));
      setSelectedJob(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadStorageArtifacts = useCallback(async () => {
    const trimmedLessonId = lessonId.trim();
    if (!trimmedLessonId) {
      setStorageError("Enter a lessonId to check storage.");
      setStorageItems([]);
      return;
    }

    setStorageLoading(true);
    setStorageError(null);

    try {
      const response = await fetch(
        `/api/video/artifacts?lessonId=${encodeURIComponent(trimmedLessonId)}`
      );
      const body = (await response.json()) as {
        items?: StorageArtifact[];
        error?: string;
      };

      if (!response.ok) {
        setStorageError(body.error ?? "Failed to list storage artifacts");
        setStorageItems([]);
        return;
      }

      setStorageItems(body.items ?? []);
    } catch (storageFetchError) {
      setStorageError(String(storageFetchError));
      setStorageItems([]);
    } finally {
      setStorageLoading(false);
    }
  }, [lessonId]);

  useEffect(() => {
    setLessonId(initialLessonId);
  }, [initialLessonId]);

  useEffect(() => {
    if (focusJobId) {
      loadJobDetails(focusJobId);
    }
  }, [focusJobId, loadJobDetails]);

  const selectedArtifacts = useMemo(
    () => readArtifacts(selectedJob?.queue_response),
    [selectedJob]
  );

  const videoArtifact = useMemo(
    () => selectedArtifacts.find((artifact) => artifact.name === "videoMp4"),
    [selectedArtifacts]
  );

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-2 text-lg font-semibold">Render Job Monitor</h2>
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
        Query recent render jobs and status updates persisted in Supabase.
      </p>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={lessonId}
          onChange={(event) => setLessonId(event.target.value)}
          placeholder="Optional lessonId filter"
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={loadJobs}
          className="rounded-md border px-3 py-2 text-sm font-medium"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <ul className="space-y-2 text-sm">
        {jobs.map((job) => (
          <li key={job.id} className="rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{job.id}</span>
              <span className="rounded border px-2 py-0.5 text-xs uppercase">
                {job.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              lessonId: {job.lesson_id} • provider: {job.provider}
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              created: {new Date(job.created_at).toLocaleString()}
            </p>
            <button
              type="button"
              className="mt-2 rounded border px-2 py-1 text-xs font-medium"
              onClick={() => loadJobDetails(job.id)}
            >
              View Details
            </button>
            {job.error_message ? (
              <p className="mt-1 text-xs text-red-600">{job.error_message}</p>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-md border p-3">
        <h3 className="text-sm font-semibold">Selected Job Details</h3>

        {detailLoading ? (
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">Loading details...</p>
        ) : null}

        {!detailLoading && !selectedJob ? (
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
            Select a job to inspect artifacts and playback URL.
          </p>
        ) : null}

        {selectedJob ? (
          <div className="mt-2 space-y-2 text-xs">
            <p>
              <span className="font-medium">jobId:</span> {selectedJob.id}
            </p>
            <p>
              <span className="font-medium">status:</span> {selectedJob.status}
            </p>

            {selectedArtifacts.length > 0 ? (
              <ul className="space-y-1">
                {selectedArtifacts.map((artifact) => (
                  <li key={artifact.name}>
                    <a
                      href={artifact.signedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      {artifact.name}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-600 dark:text-gray-300">
                No artifacts available yet.
              </p>
            )}

            {videoArtifact ? (
              <video
                controls
                className="w-full rounded border"
                src={videoArtifact.signedUrl}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-md border p-3">
        <h3 className="text-sm font-semibold">Storage Artifacts</h3>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          Lists objects saved to Supabase Storage for the current lessonId.
        </p>

        <button
          type="button"
          onClick={loadStorageArtifacts}
          className="mt-2 rounded border px-2 py-1 text-xs font-medium"
        >
          {storageLoading ? "Checking..." : "Check Storage"}
        </button>

        {storageError ? (
          <p className="mt-2 text-xs text-red-600">{storageError}</p>
        ) : null}

        {!storageLoading && storageItems.length === 0 && !storageError ? (
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
            No storage artifacts found.
          </p>
        ) : null}

        {storageItems.length > 0 ? (
          <ul className="mt-2 space-y-1 text-xs">
            {storageItems.map((item) => (
              <li key={item.path} className="flex flex-col gap-1">
                <span className="font-medium">{item.name}</span>
                <span className="text-gray-600 dark:text-gray-300">
                  {item.path}
                  {typeof item.size === "number" ? ` • ${item.size} bytes` : ""}
                </span>
                {item.signedUrl ? (
                  <a
                    href={item.signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Open MP4
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
