interface ProcessVideoPayload {
  lessonId: string;
  script: string;
  provider: "manim";
  // provider: "manim" | "heygen";
}

Deno.serve(async (request) => {
  try {
    const payload = (await request.json()) as ProcessVideoPayload;

    return new Response(
      JSON.stringify({
        status: "queued",
        payload,
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
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
