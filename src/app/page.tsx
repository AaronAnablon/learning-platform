export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-8 md:p-16">
      <h1 className="text-3xl font-bold">Learning Platform Starter</h1>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Full-stack Next.js starter with Supabase, Stripe, GPT integration, video
        pipeline hooks, and a Python LangChain service.
      </p>

      <section className="rounded-lg border p-4">
        <h2 className="mb-2 text-lg font-semibold">API Endpoints</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>GET /api/health</li>
          {/* <li>GET /api/heygen/test</li> */}
          <li>POST /api/generate-text</li>
          <li>POST /api/create-checkout-session</li>
          <li>POST /api/stripe/webhook</li>
          <li>POST /api/video/render</li>
        </ul>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-2 text-lg font-semibold">Next Steps</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Copy .env.example to .env.local and fill all required keys.</li>
          <li>Run Supabase locally and add your schema/migrations.</li>
          <li>Start the Python AI service in ./ai-service.</li>
          <li>Implement your video worker orchestration.</li>
        </ol>
      </section>
    </main>
  );
}
