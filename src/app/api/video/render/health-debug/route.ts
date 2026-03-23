import { NextResponse } from "next/server";

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

    return cause
      ? `${error.name}: ${error.message} (cause: ${cause})`
      : `${error.name}: ${error.message}`;
  }

  return String(error);
}

export async function GET() {
  const configuredUrl = process.env.PYTHON_AI_SERVICE_URL;

  if (!configuredUrl?.trim()) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        reason: "PYTHON_AI_SERVICE_URL is not configured",
      },
      { status: 503 }
    );
  }

  const baseUrl = normalizePythonServiceUrl(configuredUrl);
  const healthUrl = `${baseUrl}/health`;

  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    return NextResponse.json(
      {
        ok: response.ok && (body as { status?: string } | null)?.status === "ok",
        configured: true,
        baseUrl,
        healthUrl,
        statusCode: response.status,
        body,
      },
      { status: response.ok ? 200 : 503 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        baseUrl,
        healthUrl,
        reason: extractErrorMessage(error),
      },
      { status: 503 }
    );
  }
}
