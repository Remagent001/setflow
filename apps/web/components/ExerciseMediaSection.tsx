"use client";

// Photos & video for one exercise. Photos show on the glasses' NEXT UP card
// (so you can see what the movement is); videos are demo clips or recorded
// sets. On a phone, "Take photo" / "Record video" open the camera directly
// (capture inputs); on a desktop they fall back to a file picker. Supabase
// mode stores files in the public exercise-media bucket; mock mode keeps them
// in this browser's IndexedDB.

import { useEffect, useRef, useState } from "react";
import type { ExerciseMedia } from "@setflow/shared";
import { getApi } from "../lib/api";
import { getVideoBlob, isLocalMediaUrl } from "../lib/media-store";
import { deleteMediaByUrl, uploadMediaFile } from "../lib/media-upload";
import { probeVideo } from "../lib/video-utils";

const MAX_VIDEO_MB = 50;
const MAX_IMAGE_MB = 10;
const PREFERRED_MIN_S = 5;
const PREFERRED_MAX_S = 15;

const durationHint = (s?: number) => {
  if (s === undefined) return null;
  if (s < PREFERRED_MIN_S) return "Shorter than the suggested 5-15 seconds.";
  if (s > PREFERRED_MAX_S) return "Longer than the suggested 5-15 seconds.";
  return null;
};

/** One media row: resolves local-media:// blobs to a playable object URL. */
function MediaItem({ media, onDelete }: { media: ExerciseMedia; onDelete: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    if (isLocalMediaUrl(media.url)) {
      getVideoBlob(media.url)
        .then((blob) => {
          if (cancelled) return;
          if (!blob) return setMissing(true);
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
        })
        .catch(() => !cancelled && setMissing(true));
    } else {
      setSrc(media.url);
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [media.url]);

  const hint = media.mediaType === "video" ? durationHint(media.durationSeconds) : null;

  return (
    <div className="card" style={{ background: "var(--panel2)", padding: 12 }}>
      {missing ? (
        <div style={{ fontSize: 13, color: "#ff7a7a" }}>
          This file is no longer in this browser&apos;s storage (it may have been
          cleared). Delete this entry and re-upload.
        </div>
      ) : !src ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading...</div>
      ) : media.mediaType === "image" ? (
        <img
          src={src}
          alt="exercise"
          style={{ width: "100%", maxWidth: 420, borderRadius: 8, display: "block" }}
        />
      ) : (
        <video
          src={src}
          controls
          muted
          playsInline
          poster={media.thumbnailUrl}
          style={{ width: "100%", maxWidth: 420, borderRadius: 8, background: "#000" }}
        />
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 8,
        }}
      >
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {media.mediaType === "image"
            ? "photo · shows on the glasses"
            : media.durationSeconds !== undefined
              ? `${Math.round(media.durationSeconds)}s video`
              : "video"}
          {media.angle ? ` · ${media.angle} angle` : ""}
          {isLocalMediaUrl(media.url) ? " · stored in this browser" : " · in the cloud"}
        </span>
        <button
          type="button"
          className="btn"
          style={{ background: "transparent", color: "#ff7a7a", padding: "4px 10px" }}
          onClick={onDelete}
        >
          Remove
        </button>
      </div>
      {hint && <div style={{ fontSize: 12, color: "#e6b450", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export default function ExerciseMediaSection({ exerciseId }: { exerciseId: string }) {
  const [items, setItems] = useState<ExerciseMedia[] | null>(null);
  const [busy, setBusy] = useState<"upload" | "url" | null>(null);
  const [error, setError] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const recordInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () =>
    getApi()
      .listExerciseMedia(exerciseId)
      .then(setItems)
      .catch(() => setError("Couldn't load media."));

  useEffect(() => {
    refresh();
  }, [exerciseId]);

  const handleFile = async (file: File) => {
    setError("");
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) {
      setError("That file isn't a photo or a video.");
      return;
    }
    if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) {
      // Browsers (and the glasses) can't display HEIC.
      setError(
        "That photo is in HEIC format, which browsers can't show. On iPhone: Settings → Camera → Formats → Most Compatible, then retake — or pick a JPEG."
      );
      return;
    }
    const maxMb = isImage ? MAX_IMAGE_MB : MAX_VIDEO_MB;
    if (file.size > maxMb * 1024 * 1024) {
      setError(
        isImage
          ? `Photo is too large (max ${MAX_IMAGE_MB}MB).`
          : `Video is too large (max ${MAX_VIDEO_MB}MB). Trim it to 5-15 seconds.`
      );
      return;
    }
    setBusy("upload");
    let storedUrl: string | null = null;
    try {
      let thumbnailUrl: string | undefined;
      let durationSeconds: number | undefined;
      if (isVideo) {
        const objectUrl = URL.createObjectURL(file);
        const probe = await probeVideo(objectUrl).finally(() => URL.revokeObjectURL(objectUrl));
        thumbnailUrl = probe.thumbnailDataUrl;
        durationSeconds = probe.durationSeconds;
      }
      storedUrl = await uploadMediaFile(file);
      await getApi().addExerciseMedia({
        exerciseId,
        mediaType: isImage ? "image" : "video",
        url: storedUrl,
        thumbnailUrl,
        durationSeconds,
      });
      await refresh();
    } catch (err) {
      // Don't leave orphaned bytes behind if the metadata save failed.
      if (storedUrl) await deleteMediaByUrl(storedUrl).catch(() => {});
      setError(err instanceof Error ? err.message : "Upload failed. Try again.");
    } finally {
      setBusy(null);
      for (const r of [photoInput, recordInput, fileInput]) if (r.current) r.current.value = "";
    }
  };

  const handleAttachUrl = async () => {
    const url = externalUrl.trim();
    setError("");
    if (!/^https?:\/\/.+/i.test(url)) {
      setError("Enter a full link starting with http:// or https://");
      return;
    }
    setBusy("url");
    try {
      // A link to a picture is an image row (it can show on the glasses);
      // anything else is treated as a video, probed best-effort.
      const path = url.split(/[?#]/)[0] ?? "";
      const isImageLink = /\.(jpe?g|png|webp|gif|avif)$/i.test(path);
      let thumbnailUrl: string | undefined;
      let durationSeconds: number | undefined;
      if (!isImageLink) {
        // External hosts often block frame capture; that's fine.
        const probe = await probeVideo(url);
        thumbnailUrl = probe.thumbnailDataUrl;
        durationSeconds = probe.durationSeconds;
      }
      await getApi().addExerciseMedia({
        exerciseId,
        mediaType: isImageLink ? "image" : "video",
        url,
        thumbnailUrl,
        durationSeconds,
      });
      setExternalUrl("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't attach that link.");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (media: ExerciseMedia) => {
    setError("");
    try {
      await getApi().deleteExerciseMedia(media.id);
      await deleteMediaByUrl(media.url).catch(() => {});
      await refresh();
    } catch {
      setError("Couldn't remove that.");
    }
  };

  const pickerButton = (
    label: string,
    ref: React.RefObject<HTMLInputElement | null>,
    subtle = false
  ) => (
    <button
      type="button"
      className="btn"
      disabled={busy !== null}
      onClick={() => ref.current?.click()}
      style={subtle ? { background: "var(--panel)", color: "var(--text)" } : undefined}
    >
      {label}
    </button>
  );

  return (
    <div className="card" style={{ background: "var(--panel2)", padding: 14, marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Photos &amp; video</div>
      <div style={{ fontSize: 12, color: "var(--muted)", margin: "2px 0 10px" }}>
        A photo shows on the glasses so you know what the exercise is. Record a video of a
        set here on your phone — it&apos;s saved to this exercise. Clips of 5-15 seconds work best.
      </div>

      {items === null ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading...</div>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
          No photos or videos yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
          {items.map((m) => (
            <MediaItem key={m.id} media={m} onDelete={() => handleDelete(m)} />
          ))}
        </div>
      )}

      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <input
        ref={recordInput}
        type="file"
        accept="video/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/*,video/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        {busy === "upload" ? (
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Uploading…</span>
        ) : (
          <>
            {pickerButton("📷 Take photo", photoInput)}
            {pickerButton("🎥 Record video", recordInput)}
            {pickerButton("Upload file", fileInput, true)}
          </>
        )}
        <span style={{ fontSize: 12, color: "var(--muted)" }}>or paste a link:</span>
        <input
          value={externalUrl}
          onChange={(e) => setExternalUrl(e.target.value)}
          placeholder="https://..."
          style={{ flex: "1 1 180px", minWidth: 160 }}
          disabled={busy !== null}
        />
        <button
          type="button"
          className="btn"
          disabled={busy !== null || !externalUrl.trim()}
          onClick={handleAttachUrl}
          style={{ background: "var(--panel)", color: "var(--text)" }}
        >
          {busy === "url" ? "Attaching..." : "Attach"}
        </button>
      </div>

      {error && <div style={{ color: "#ff7a7a", fontSize: 13, marginTop: 8 }}>{error}</div>}
    </div>
  );
}
