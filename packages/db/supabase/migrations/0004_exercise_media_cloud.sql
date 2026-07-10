-- SetFlow exercise media in the cloud + images on the glasses (2026-07-09).
-- Additive. Supersedes 0002 (which was written for a private bucket and never
-- applied): the bucket is PUBLIC so the no-auth glasses can load exercise
-- images by URL. File paths are unguessable (uuid names under the owner's
-- folder); writes are still owner-scoped by RLS. Documented trade-off in
-- docs/KNOWN_LIMITATIONS.md.

-- ---------------------------------------------------------------------------
-- Storage bucket for exercise photos + demo/set videos.
-- (No HEIC: browsers can't decode it - the web client rejects it with a hint.)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exercise-media',
  'exercise-media',
  true,
  52428800, -- 50MB, matches the web upload cap
  array['video/mp4', 'video/quicktime', 'video/webm',
        'image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Users manage files under their own folder: exercise-media/<user_id>/...
drop policy if exists "read own exercise media" on storage.objects;
create policy "read own exercise media"
  on storage.objects for select
  using (bucket_id = 'exercise-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "upload own exercise media" on storage.objects;
create policy "upload own exercise media"
  on storage.objects for insert
  with check (bucket_id = 'exercise-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "delete own exercise media" on storage.objects;
create policy "delete own exercise media"
  on storage.objects for delete
  using (bucket_id = 'exercise-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Media ownership lives on the MEDIA row, not the exercise: the built-in
-- exercise library is global (owner_user_id null on exercises), and users
-- must be able to attach their own photos/videos to those shared exercises
-- without their media leaking onto anyone else's glasses. The 0001 policies
-- tied media writes to exercise ownership, which made every upload to a
-- built-in exercise fail RLS - replaced below.
-- ---------------------------------------------------------------------------
alter table public.exercise_media
  add column if not exists owner_user_id uuid references auth.users (id) on delete cascade default auth.uid();

create index if not exists exercise_media_owner_idx on public.exercise_media (owner_user_id);

-- Optional session tag: lets a recorded set clip attach to the workout
-- session it was filmed in (Trainer-mode review, later).
alter table public.exercise_media
  add column if not exists session_id uuid references public.workout_sessions (id) on delete set null;

create index if not exists exercise_media_session_idx on public.exercise_media (session_id);

drop policy if exists "media follows exercise access" on public.exercise_media;
drop policy if exists "write media for own exercises" on public.exercise_media;
drop policy if exists "read global or own media" on public.exercise_media;
drop policy if exists "insert own media on visible exercises" on public.exercise_media;
drop policy if exists "update own media" on public.exercise_media;
drop policy if exists "delete own media" on public.exercise_media;

-- Read: your own media + built-in library media (owner null).
create policy "read global or own media" on public.exercise_media
  for select using (owner_user_id is null or owner_user_id = auth.uid());

-- Write: only as yourself, and only onto exercises you can see (global or own).
create policy "insert own media on visible exercises" on public.exercise_media
  for insert with check (
    owner_user_id = auth.uid()
    and exists (
      select 1 from public.exercises e
      where e.id = exercise_id
        and (e.owner_user_id is null or e.owner_user_id = auth.uid())
    )
  );

create policy "update own media" on public.exercise_media
  for update using (owner_user_id = auth.uid());

create policy "delete own media" on public.exercise_media
  for delete using (owner_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- glasses_get_plan v3: each exercise carries imageUrl - the token-owner's own
-- newest photo for it, falling back to built-in library images (owner null).
-- Never another user's media. Identical to 0003's version otherwise.
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
              'imageUrl', (
                select em.url from public.exercise_media em
                where em.exercise_id = e.id
                  and em.media_type = 'image'
                  and em.url like 'http%'
                  and (em.owner_user_id = v_user_id or em.owner_user_id is null)
                order by (em.owner_user_id is not null) desc, em.created_at desc
                limit 1
              ),
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
