-- SetFlow glasses ↔ cloud sync (2026-07-09).
-- Additive only: one new table, one new nullable column, two RPC functions.
-- Nothing in 0001/0002 changes.
--
-- The glasses are a no-keyboard device with no auth session. They authenticate
-- with a durable, revocable DEVICE TOKEN carried in their URL. The dashboard
-- generates a token, stores only its SHA-256 hash, and shows the raw token once
-- (baked into the glasses URL). The glasses call two SECURITY DEFINER functions
-- with the raw token; each function hashes it, looks up the owning user, and
-- acts ONLY on that user's own rows. No service-role key ever ships to a device.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- glasses_pair_tokens: one row per paired device. Only the hash is stored.
-- ---------------------------------------------------------------------------
create table if not exists public.glasses_pair_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,          -- sha256 hex of the raw token
  label text,                               -- e.g. "Keith's Ray-Bans"
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists glasses_pair_tokens_user_idx on public.glasses_pair_tokens (user_id);

-- Idempotency key for glasses-synced sessions: the glasses stamp a stable
-- clientId per finished workout so a retried upload never double-logs.
-- Unique PER USER (not globally): two different users' devices could produce
-- the same clientId (e.g. the offline counter fallback), and the idempotency
-- lookups below are user-scoped, so a global unique would let user B's insert
-- collide with user A's row and silently drop B's workout. Nulls are distinct,
-- so existing rows (all null) are unaffected.
alter table public.workout_sessions
  add column if not exists client_id text;
create unique index if not exists workout_sessions_user_client_uniq
  on public.workout_sessions (user_id, client_id);

-- ---------------------------------------------------------------------------
-- RLS: the dashboard (authenticated user) manages its own tokens. The glasses
-- never touch this table directly - they go through the SECURITY DEFINER
-- functions below, which run as the table owner and bypass RLS.
-- ---------------------------------------------------------------------------
alter table public.glasses_pair_tokens enable row level security;

create policy "own pair tokens" on public.glasses_pair_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- glasses_get_plan(token): returns the token-owner's live plans as an array of
-- EngineWorkout objects (camelCase keys, matching what the engine consumes).
-- nulls are stripped so the shape matches the old baked snapshot.
-- ---------------------------------------------------------------------------
create or replace function public.glasses_get_plan(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
  v_hash text := encode(digest(p_token, 'sha256'), 'hex');
  v_result jsonb;
begin
  select user_id into v_user_id
  from public.glasses_pair_tokens
  where token_hash = v_hash and revoked_at is null;

  if v_user_id is null then
    return jsonb_build_object('error', 'invalid_token');
  end if;

  update public.glasses_pair_tokens set last_used_at = now() where token_hash = v_hash;

  select coalesce(jsonb_agg(w order by (w->'plan'->>'title')), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'plan', jsonb_build_object(
        'id', p.id,
        'ownerUserId', p.owner_user_id,
        'title', p.title,
        'description', p.description,
        'estimatedDurationMinutes', p.estimated_duration_minutes,
        'createdAt', p.created_at,
        'updatedAt', p.updated_at
      ),
      'steps', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'step', jsonb_build_object(
              'id', s.id,
              'workoutPlanId', s.workout_plan_id,
              'exerciseId', s.exercise_id,
              'orderIndex', s.order_index,
              'setCount', s.set_count,
              'targetReps', s.target_reps,
              'targetWeight', s.target_weight,
              'targetDurationSeconds', s.target_duration_seconds,
              'restSeconds', s.rest_seconds,
              'cue', s.cue,
              'notes', s.notes
            ),
            'exercise', jsonb_build_object(
              'id', e.id,
              'name', e.name,
              'primaryMuscleGroup', e.primary_muscle_group,
              'cues', coalesce(to_jsonb(e.cues), '[]'::jsonb),
              'commonMistakes', coalesce(to_jsonb(e.common_mistakes), '[]'::jsonb),
              'createdAt', e.created_at,
              'updatedAt', e.updated_at
            )
          ) order by s.order_index
        )
        from public.workout_steps s
        join public.exercises e on e.id = s.exercise_id
        where s.workout_plan_id = p.id
      ), '[]'::jsonb)
    ) as w
    from public.workout_plans p
    where p.owner_user_id = v_user_id
  ) sub;

  return jsonb_build_object('workouts', jsonb_strip_nulls(v_result));
end;
$$;

-- ---------------------------------------------------------------------------
-- glasses_sync_session(token, session): stores one finished workout bundle.
-- Every write is scoped to the token-owner; step/exercise ids are re-derived
-- server-side so a tampered or stale bundle can never write to another user or
-- an invalid row. Idempotent on clientId. Returns {sessionId} or {error}.
-- ---------------------------------------------------------------------------
create or replace function public.glasses_sync_session(p_token text, p_session jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
  v_hash text := encode(digest(p_token, 'sha256'), 'hex');
  v_session_id uuid;
  v_plan_id uuid;
  v_client_id text := p_session->>'clientId';
  v_log jsonb;
  v_roll jsonb;
  v_step_id uuid;
  v_exercise_id uuid;
begin
  select user_id into v_user_id
  from public.glasses_pair_tokens
  where token_hash = v_hash and revoked_at is null;

  if v_user_id is null then
    return jsonb_build_object('error', 'invalid_token');
  end if;

  update public.glasses_pair_tokens set last_used_at = now() where token_hash = v_hash;

  v_plan_id := (p_session->>'planId')::uuid;

  -- The plan must belong to this user (never trust the client's planId).
  if not exists (
    select 1 from public.workout_plans where id = v_plan_id and owner_user_id = v_user_id
  ) then
    return jsonb_build_object('error', 'stale_plan');
  end if;

  -- Idempotency: a retried upload with the same clientId returns the first row.
  if v_client_id is not null then
    select id into v_session_id from public.workout_sessions
    where client_id = v_client_id and user_id = v_user_id;
    if v_session_id is not null then
      return jsonb_build_object('sessionId', v_session_id, 'idempotent', true);
    end if;
  end if;

  begin
    insert into public.workout_sessions
      (user_id, workout_plan_id, status, started_at, completed_at, duration_seconds, client_id)
    values (
      v_user_id, v_plan_id,
      coalesce(p_session->>'status', 'completed'),
      (p_session->>'startedAt')::timestamptz,
      now(),
      (p_session->>'durationSeconds')::integer,
      v_client_id
    )
    returning id into v_session_id;
  exception when unique_violation then
    -- Concurrent duplicate on client_id: return the row the other call inserted.
    select id into v_session_id from public.workout_sessions
    where client_id = v_client_id and user_id = v_user_id;
    return jsonb_build_object('sessionId', v_session_id, 'idempotent', true);
  end;

  -- Set logs. The step is validated against this user's plans and the
  -- exercise id is re-derived from the step, so client-sent ids can't escape
  -- the user's own data or violate a foreign key.
  for v_log in select * from jsonb_array_elements(coalesce(p_session->'logs', '[]'::jsonb))
  loop
    v_step_id := (v_log->>'workoutStepId')::uuid;

    select s.exercise_id into v_exercise_id
    from public.workout_steps s
    join public.workout_plans pl on pl.id = s.workout_plan_id
    where s.id = v_step_id and pl.owner_user_id = v_user_id;

    if v_exercise_id is null then
      -- The plan was edited on the web after the glasses cached it. Roll the
      -- whole bundle back and tell the glasses to refetch.
      delete from public.workout_sessions where id = v_session_id;
      return jsonb_build_object('error', 'stale_plan');
    end if;

    insert into public.set_logs (
      session_id, workout_step_id, exercise_id, set_number,
      target_weight, target_reps, target_duration_seconds,
      actual_weight, actual_reps, actual_duration_seconds,
      unit, status, logged_by
    ) values (
      v_session_id, v_step_id, v_exercise_id,
      (v_log->>'setNumber')::integer,
      (v_log->>'targetWeight')::numeric,
      (v_log->>'targetReps')::integer,
      (v_log->>'targetDurationSeconds')::integer,
      (v_log->>'actualWeight')::numeric,
      (v_log->>'actualReps')::integer,
      (v_log->>'actualDurationSeconds')::integer,
      coalesce(v_log->>'unit', 'lb'),
      coalesce(v_log->>'status', 'completed'),
      'gesture'
    );
  end loop;

  -- Roll finishing weights/reps forward as the new plan defaults - user's own
  -- steps only (the join to workout_plans enforces ownership).
  for v_roll in select * from jsonb_array_elements(coalesce(p_session->'rollforward', '[]'::jsonb))
  loop
    update public.workout_steps s
      set target_weight = coalesce((v_roll->>'targetWeight')::numeric, s.target_weight),
          target_reps   = coalesce((v_roll->>'targetReps')::integer, s.target_reps)
    from public.workout_plans pl
    where s.id = (v_roll->>'stepId')::uuid
      and pl.id = s.workout_plan_id
      and pl.owner_user_id = v_user_id;
  end loop;

  return jsonb_build_object('sessionId', v_session_id);
end;
$$;

grant execute on function public.glasses_get_plan(text) to anon, authenticated;
grant execute on function public.glasses_sync_session(text, jsonb) to anon, authenticated;
