-- SetFlow initial schema (Segment 02).
-- Postgres / Supabase. Auth users live in Supabase's auth.users; app data
-- references them via user_id uuid columns. Naming: snake_case in SQL,
-- mapped to the camelCase types in @setflow/shared by the api-client.

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user (display name, preferences)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  default_weight_unit text not null default 'lb' check (default_weight_unit in ('lb', 'kg')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- exercises: library of movements. owner_user_id null = built-in/global.
-- ---------------------------------------------------------------------------
create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users (id) on delete cascade,
  name text not null,
  description text,
  primary_muscle_group text,
  secondary_muscle_groups text[],
  equipment text[],
  instructions text,
  common_mistakes text[],
  cues text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists exercises_owner_idx on public.exercises (owner_user_id);
create index if not exists exercises_created_idx on public.exercises (created_at);

-- ---------------------------------------------------------------------------
-- exercise_media: demo videos / images per exercise
-- ---------------------------------------------------------------------------
create table if not exists public.exercise_media (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  media_type text not null check (media_type in ('video', 'image')),
  url text not null,
  thumbnail_url text,
  duration_seconds numeric,
  angle text check (angle in ('front', 'side', 'other')),
  created_at timestamptz not null default now()
);

create index if not exists exercise_media_exercise_idx on public.exercise_media (exercise_id);

-- ---------------------------------------------------------------------------
-- workout_plans + workout_steps: the planned workout
-- ---------------------------------------------------------------------------
create table if not exists public.workout_plans (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text,
  difficulty text check (difficulty in ('beginner', 'intermediate', 'advanced')),
  estimated_duration_minutes integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workout_plans_owner_idx on public.workout_plans (owner_user_id);
create index if not exists workout_plans_created_idx on public.workout_plans (created_at);

create table if not exists public.workout_steps (
  id uuid primary key default gen_random_uuid(),
  workout_plan_id uuid not null references public.workout_plans (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  order_index integer not null,
  set_count integer not null default 3,
  target_reps integer,
  target_weight numeric,
  target_duration_seconds integer,
  rest_seconds integer not null default 90,
  notes text,
  cue text,
  unique (workout_plan_id, order_index)
);

create index if not exists workout_steps_plan_idx on public.workout_steps (workout_plan_id);
create index if not exists workout_steps_exercise_idx on public.workout_steps (exercise_id);

-- ---------------------------------------------------------------------------
-- workout_sessions: one row per performed (or attempted) workout
-- ---------------------------------------------------------------------------
create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workout_plan_id uuid not null references public.workout_plans (id) on delete restrict,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed', 'abandoned')),
  started_at timestamptz,
  completed_at timestamptz,
  duration_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workout_sessions_user_idx on public.workout_sessions (user_id);
create index if not exists workout_sessions_plan_idx on public.workout_sessions (workout_plan_id);
create index if not exists workout_sessions_created_idx on public.workout_sessions (created_at);

-- ---------------------------------------------------------------------------
-- set_logs: one row per performed set
-- ---------------------------------------------------------------------------
create table if not exists public.set_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions (id) on delete cascade,
  workout_step_id uuid not null references public.workout_steps (id) on delete restrict,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  set_number integer not null,
  target_weight numeric,
  target_reps integer,
  target_duration_seconds integer,
  actual_weight numeric,
  actual_reps integer,
  actual_duration_seconds integer,
  unit text not null default 'lb' check (unit in ('lb', 'kg', 'bodyweight')),
  status text not null default 'completed' check (status in ('completed', 'failed', 'skipped')),
  difficulty text check (difficulty in ('easy', 'moderate', 'hard', 'brutal')),
  rpe numeric check (rpe >= 1 and rpe <= 10),
  note text,
  logged_by text not null default 'manual'
    check (logged_by in ('glasses_voice', 'mobile_voice', 'manual', 'gesture')),
  transcript text,
  confidence numeric check (confidence >= 0 and confidence <= 1),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists set_logs_session_idx on public.set_logs (session_id);
create index if not exists set_logs_exercise_idx on public.set_logs (exercise_id);
create index if not exists set_logs_created_idx on public.set_logs (created_at);

-- ---------------------------------------------------------------------------
-- voice_log_attempts: raw voice-parse attempts (for confidence tuning)
-- ---------------------------------------------------------------------------
create table if not exists public.voice_log_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions (id) on delete cascade,
  set_log_id uuid references public.set_logs (id) on delete set null,
  raw_transcript text not null,
  parsed_weight numeric,
  parsed_reps integer,
  parsed_unit text check (parsed_unit in ('lb', 'kg', 'bodyweight')),
  parsed_difficulty text,
  parsed_status text,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  confirmed boolean not null default false,
  correction_required boolean not null default false,
  source text not null check (source in ('glasses_mic', 'mobile_mic')),
  created_at timestamptz not null default now()
);

create index if not exists voice_log_attempts_session_idx on public.voice_log_attempts (session_id);

-- ---------------------------------------------------------------------------
-- workout_journals: light pre/post-workout journal, one per session
-- ---------------------------------------------------------------------------
create table if not exists public.workout_journals (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.workout_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  energy text check (energy in ('low', 'medium', 'high')),
  soreness text check (soreness in ('none', 'mild', 'moderate', 'high')),
  sleep text check (sleep in ('poor', 'okay', 'good')),
  motivation text check (motivation in ('low', 'medium', 'high')),
  pre_workout_meal text,
  meal_timing_minutes_before integer,
  hydration text check (hydration in ('low', 'normal', 'high')),
  supplements text,
  overall_effort text check (overall_effort in ('easy', 'moderate', 'hard', 'brutal')),
  mood_after text check (mood_after in ('worse', 'same', 'better')),
  pain text check (pain in ('none', 'mild', 'moderate', 'severe')),
  best_lift text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workout_journals_user_idx on public.workout_journals (user_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: users can only touch their own rows. Built-in
-- exercises (owner_user_id is null) are readable by everyone.
-- The anon key ships inside the apps, so RLS is on from day one.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.exercises enable row level security;
alter table public.exercise_media enable row level security;
alter table public.workout_plans enable row level security;
alter table public.workout_steps enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.set_logs enable row level security;
alter table public.voice_log_attempts enable row level security;
alter table public.workout_journals enable row level security;

create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "read global or own exercises" on public.exercises
  for select using (owner_user_id is null or auth.uid() = owner_user_id);
create policy "write own exercises" on public.exercises
  for insert with check (auth.uid() = owner_user_id);
create policy "update own exercises" on public.exercises
  for update using (auth.uid() = owner_user_id);
create policy "delete own exercises" on public.exercises
  for delete using (auth.uid() = owner_user_id);

create policy "media follows exercise access" on public.exercise_media
  for select using (
    exists (
      select 1 from public.exercises e
      where e.id = exercise_id and (e.owner_user_id is null or e.owner_user_id = auth.uid())
    )
  );
create policy "write media for own exercises" on public.exercise_media
  for all using (
    exists (
      select 1 from public.exercises e
      where e.id = exercise_id and e.owner_user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.exercises e
      where e.id = exercise_id and e.owner_user_id = auth.uid()
    )
  );

create policy "own plans" on public.workout_plans
  for all using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

create policy "steps follow plan ownership" on public.workout_steps
  for all using (
    exists (
      select 1 from public.workout_plans p
      where p.id = workout_plan_id and p.owner_user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.workout_plans p
      where p.id = workout_plan_id and p.owner_user_id = auth.uid()
    )
  );

create policy "own sessions" on public.workout_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "set logs follow session ownership" on public.set_logs
  for all using (
    exists (
      select 1 from public.workout_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.workout_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );

create policy "voice attempts follow session ownership" on public.voice_log_attempts
  for all using (
    exists (
      select 1 from public.workout_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.workout_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );

create policy "own journals" on public.workout_journals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
