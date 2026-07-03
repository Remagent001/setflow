"use client";

// Client-side video inspection: read duration and grab a small thumbnail
// frame via an off-screen <video> + <canvas>. Best-effort — some codecs or
// cross-origin URLs won't yield a frame, so callers treat both as optional.

export type VideoProbe = {
  durationSeconds?: number;
  /** Small JPEG data URI (~10-20KB) suitable for the mock store. */
  thumbnailDataUrl?: string;
};

const THUMB_WIDTH = 320;

export function probeVideo(src: string): Promise<VideoProbe> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    // No crossOrigin: setting it makes hosts without CORS headers fail to load
    // at all. Without it, metadata/duration always works; frame capture on a
    // cross-origin video throws (tainted canvas) and is caught below — local
    // blob: uploads still get thumbnails.
    video.src = src;

    const finish = (probe: VideoProbe) => {
      video.removeAttribute("src");
      video.load();
      resolve(probe);
    };
    const timeout = window.setTimeout(() => finish({}), 8000);

    let duration: number | undefined;
    video.onloadedmetadata = () => {
      duration = Number.isFinite(video.duration) ? video.duration : undefined;
      // Seek a hair in so we don't capture a black first frame.
      video.currentTime = Math.min(0.5, (duration ?? 1) / 2);
    };
    video.onseeked = () => {
      window.clearTimeout(timeout);
      try {
        const scale = THUMB_WIDTH / (video.videoWidth || THUMB_WIDTH);
        const canvas = document.createElement("canvas");
        canvas.width = THUMB_WIDTH;
        canvas.height = Math.max(1, Math.round((video.videoHeight || THUMB_WIDTH) * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return finish({ durationSeconds: duration });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish({
          durationSeconds: duration,
          thumbnailDataUrl: canvas.toDataURL("image/jpeg", 0.7),
        });
      } catch {
        // Canvas capture can throw on tainted/cross-origin frames.
        finish({ durationSeconds: duration });
      }
    };
    video.onerror = () => {
      window.clearTimeout(timeout);
      finish({ durationSeconds: duration });
    };
  });
}
