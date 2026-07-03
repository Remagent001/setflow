"use client";

// Segment 06 — demo video management for one exercise. Upload a short clip
// (stored locally in IndexedDB while we're in mock mode) or attach an
// external video URL. Shows previews, duration guidance (5-15s preferred),
// and handles failure states without losing the rest of the page.

import { useEffect, useRef, useState } from "react";
import type { ExerciseMedia } from "@setflow/shared";
import { getApi } from "../lib/api";
import {
  deleteVideoBlob,
  getVideoBlob,
  isLocalMediaUrl,
  saveVideoBlob,
} from "../lib/media-store";
import { probeVideo } from "../lib/video-utils";

const MAX_FILE_MB = 50;
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

  const hint = durationHint(media.durationSeconds);

  return (
    <div className="card" style={{ background: "var(--panel2)", padding: 12 }}>
      {missing ? (
        <div style={{ fontSize: 13, color: "#ff7a7a" }}>
          Video file is no longer in this browser&apos;s storage (it may have been
          cleared). Delete this entry and re-upload.
        </div>
      ) : src ? (
        <video
          src={src}
          controls
          muted
          playsInline
          poster={media.thumbnailUrl}
          style={{ width: "100%", maxWidth: 420, borderRadius: 8, background: "#000" }}
        />
      ) : (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading video...</div>
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
          {media.durationSeconds !== undefined
            ? `${Math.round(media.durationSeconds)}s`
            : "duration unknown"}
          {media.angle ? ` · ${media.angle} angle` : ""}
          {isLocalMediaUrl(media.url) ? " · stored in this browser" : " · external link"}
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
    if (!file.type.startsWith("video/")) {
      setError("That file isn't a video. Pick an mp4, mov, or webm.");
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`Video is too large (max ${MAX_FILE_MB}MB). Trim it to 5-15 seconds.`);
      return;
    }
    setBusy("upload");
    let localUrl: string | null = null;
    try {
      const objectUrl = URL.createObjectURL(file);
      const probe = await probeVideo(objectUrl).finally(() => URL.revokeObjectURL(objectUrl));
      localUrl = await saveVideoBlob(file);
      await getApi().addExerciseMedia({
        exerciseId,
        mediaType: "video",
        url: localUrl,
        thumbnailUrl: probe.thumbnailDataUrl,
        durationSeconds: probe.durationSeconds,
      });
      await refresh();
    } catch (err) {
      // Don't leave an orphaned blob behind if the metadata save failed.
      if (localUrl) await deleteVideoBlob(localUrl).catch(() => {});
      setError(err instanceof Error ? err.message : "Upload failed. Try again.");
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
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
      // Best-effort probe; external hosts often block frame capture, that's fine.
      const probe = await probeVideo(url);
      await getApi().addExerciseMedia({
        exerciseId,
        mediaType: "video",
        url,
        thumbnailUrl: probe.thumbnailDataUrl,
        durationSeconds: probe.durationSeconds,
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
      await deleteVideoBlob(media.url).catch(() => {});
      await refresh();
    } catch {
      setError("Couldn't remove that video.");
    }
  };

  return (
    <div className="card" style={{ background: "var(--panel2)", padding: 14, marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Demo video</div>
      <div style={{ fontSize: 12, color: "var(--muted)", margin: "2px 0 10px" }}>
        A short clip of the movement, shown on the glasses demo card. 5-15 seconds
        works best.
      </div>

      {items === null ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading...</div>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
          No demo video yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
          {items.map((m) => (
            <MediaItem key={m.id} media={m} onDelete={() => handleDelete(m)} />
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <input
          ref={fileInput}
          type="file"
          accept="video/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() => fileInput.current?.click()}
        >
          {busy === "upload" ? "Uploading..." : "Upload video"}
        </button>
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
