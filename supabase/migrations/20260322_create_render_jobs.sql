create extension if not exists pgcrypto;

create table if not exists public.render_jobs (
  id uuid primary key default gen_random_uuid(),
  lesson_id text not null,
  provider text not null default 'manim',
  status text not null check (status in ('dry_run', 'queued', 'running', 'completed', 'failed')),
  request_payload jsonb not null,
  compiled_payload jsonb,
  queue_response jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  queued_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists render_jobs_lesson_id_created_at_idx
  on public.render_jobs (lesson_id, created_at desc);

create index if not exists render_jobs_status_created_at_idx
  on public.render_jobs (status, created_at desc);
