"use client";

// Media upload with a backend switch: supabase mode uploads to the public
// 'exercise-media' storage bucket (owner's folder, uuid filename → an https
// URL usable by the web, the phone, AND the no-auth glasses); mock mode keeps
// the existing IndexedDB blob path (local-media:// URL).

import { BACKEND, getSupabase } from "./backend";
import { deleteVideoBlob, isLocalMediaUrl, saveVideoBlob } from "./media-store";

const BUCKET = "exercise-media";
const PUBLIC_MARKER = `/object/public/${BUCKET}/`;

/** Store a media file; returns the URL to save on the exercise_media row. */
export async function uploadMediaFile(file: File): Promise<string> {
  if (BACKEND !== "supabase") return saveVideoBlob(file);

  const sb = getSupabase();
  const { data: userData, error: uErr } = await sb.auth.getUser();
  const uid = userData?.user?.id;
  if (uErr || !uid) throw new Error("You're not signed in.");

  const ext = (file.name.split(".").pop() || file.type.split("/")[1] || "bin")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const path = `${uid}/${crypto.randomUUID()}.${ext}`;

  const { error } = await sb.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined });
  if (error) throw new Error(error.message);

  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Best-effort removal of the stored bytes behind a media URL. */
export async function deleteMediaByUrl(url: string): Promise<void> {
  if (isLocalMediaUrl(url)) {
    await deleteVideoBlob(url).catch(() => {});
    return;
  }
  if (BACKEND !== "supabase") return;
  const i = url.indexOf(PUBLIC_MARKER);
  if (i < 0) return; // external link - nothing of ours to delete
  const path = decodeURIComponent(url.slice(i + PUBLIC_MARKER.length));
  await getSupabase().storage.from(BUCKET).remove([path]).then(
    () => undefined,
    () => undefined // orphaned bytes are acceptable; the row is gone
  );
}
