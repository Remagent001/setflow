-- Segment 06: Storage bucket for exercise demo videos.
-- NOT YET APPLIED to the live project — the web app is still in mock mode
-- (videos live in the browser's IndexedDB). Apply this when swapping to the
-- real Supabase client; uploads then go to this bucket and exercise_media.url
-- stores the resulting public/signed URL.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exercise-media',
  'exercise-media',
  false,
  52428800, -- 50MB, matches the web upload cap
  array['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;

-- Users manage files under their own folder: exercise-media/<user_id>/...
create policy "read own exercise media"
  on storage.objects for select
  using (bucket_id = 'exercise-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "upload own exercise media"
  on storage.objects for insert
  with check (bucket_id = 'exercise-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "delete own exercise media"
  on storage.objects for delete
  using (bucket_id = 'exercise-media' and (storage.foldername(name))[1] = auth.uid()::text);
