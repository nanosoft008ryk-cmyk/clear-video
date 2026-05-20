import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let _ffmpeg: FFmpeg | null = null;
let _loading: Promise<FFmpeg> | null = null;

const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";

export async function getFFmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (_ffmpeg) return _ffmpeg;
  if (_loading) return _loading;
  _loading = (async () => {
    const ff = new FFmpeg();
    if (onLog) ff.on("log", ({ message }) => onLog(message));
    await ff.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    });
    _ffmpeg = ff;
    return ff;
  })();
  return _loading;
}

export type FillMode =
  | "horizontal"
  | "vertical"
  | "auto"
  | "edge"
  | "clone";

export interface WatermarkRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  fillMode: FillMode;
}

export interface VideoMeta {
  width: number;
  height: number;
  duration: number;
}

export async function probeVideo(file: File): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.src = url;
    v.onloadedmetadata = () => {
      const meta = {
        width: v.videoWidth,
        height: v.videoHeight,
        duration: v.duration,
      };
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read video metadata"));
    };
  });
}

export async function extractThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.src = url;
    v.crossOrigin = "anonymous";
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(0.5, v.duration / 2);
    };
    v.onseeked = () => {
      const canvas = document.createElement("canvas");
      const scale = 320 / v.videoWidth;
      canvas.width = 320;
      canvas.height = Math.round(v.videoHeight * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("thumbnail failed"));
    };
  });
}

/**
 * Build a filter_complex that crops a clean neighbouring patch,
 * scales it to the watermark region, and overlays it.
 * No blur — pure pixel reconstruction via stretch-fill.
 */
function buildFilter(
  region: WatermarkRegion,
  meta: VideoMeta,
): string {
  const { x, y, width: w, height: h, fillMode } = region;
  const { width: W, height: H } = meta;

  // Compute source crop region based on fill direction
  let sx = 0;
  let sy = 0;
  let sw = w;
  let sh = h;

  const leftRoom = x;
  const rightRoom = W - (x + w);
  const topRoom = y;
  const bottomRoom = H - (y + h);

  const mode: FillMode =
    fillMode === "auto"
      ? Math.max(leftRoom, rightRoom) >= Math.max(topRoom, bottomRoom)
        ? "horizontal"
        : "vertical"
      : fillMode;

  switch (mode) {
    case "horizontal": {
      if (leftRoom >= rightRoom && leftRoom > 4) {
        sw = Math.max(4, Math.min(w, leftRoom));
        sx = x - sw;
        sy = y;
        sh = h;
      } else {
        sw = Math.max(4, Math.min(w, rightRoom));
        sx = x + w;
        sy = y;
        sh = h;
      }
      break;
    }
    case "vertical": {
      if (topRoom >= bottomRoom && topRoom > 4) {
        sh = Math.max(4, Math.min(h, topRoom));
        sy = y - sh;
        sx = x;
        sw = w;
      } else {
        sh = Math.max(4, Math.min(h, bottomRoom));
        sy = y + h;
        sx = x;
        sw = w;
      }
      break;
    }
    case "edge": {
      // 2px edge strip from nearest border, expanded
      if (leftRoom >= rightRoom && leftRoom > 2) {
        sw = 2;
        sx = Math.max(0, x - 2);
        sy = y;
        sh = h;
      } else {
        sw = 2;
        sx = Math.min(W - 2, x + w);
        sy = y;
        sh = h;
      }
      break;
    }
    case "clone": {
      // Mirror an adjacent block of equal size
      if (rightRoom >= leftRoom && rightRoom >= w) {
        sx = x + w;
        sy = y;
        sw = w;
        sh = h;
      } else if (leftRoom >= w) {
        sx = Math.max(0, x - w);
        sy = y;
        sw = w;
        sh = h;
      } else {
        sw = Math.max(4, Math.min(w, Math.max(leftRoom, rightRoom)));
        sx = leftRoom >= rightRoom ? Math.max(0, x - sw) : x + w;
        sy = y;
        sh = h;
      }
      break;
    }
  }

  // Clamp to frame
  sx = Math.max(0, Math.min(W - 2, Math.floor(sx)));
  sy = Math.max(0, Math.min(H - 2, Math.floor(sy)));
  sw = Math.max(2, Math.min(W - sx, Math.floor(sw)));
  sh = Math.max(2, Math.min(H - sy, Math.floor(sh)));

  const px = Math.floor(x);
  const py = Math.floor(y);
  const pw = Math.floor(w);
  const ph = Math.floor(h);

  return `[0:v]split=2[base][src];[src]crop=${sw}:${sh}:${sx}:${sy},scale=${pw}:${ph}:flags=lanczos[patch];[base][patch]overlay=${px}:${py}:format=auto[outv]`;
}

export interface ProcessOptions {
  region: WatermarkRegion;
  meta: VideoMeta;
  filename: string;
  preset?: "ultrafast" | "veryfast" | "fast" | "medium";
  crf?: number;
  onProgress?: (ratio: number) => void;
  onLog?: (msg: string) => void;
}

export async function removeWatermark(
  file: File,
  opts: ProcessOptions,
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onLog);
  const inputName = `in_${Date.now()}.${(file.name.split(".").pop() || "mp4").toLowerCase()}`;
  const outputName = `out_${Date.now()}.mp4`;

  const handler = ({ progress }: { progress: number }) => {
    if (opts.onProgress) opts.onProgress(Math.min(1, Math.max(0, progress)));
  };
  ff.on("progress", handler);

  try {
    await ff.writeFile(inputName, await fetchFile(file));
    const filter = buildFilter(opts.region, opts.meta);
    const args = [
      "-i", inputName,
      "-filter_complex", filter,
      "-map", "[outv]",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-preset", opts.preset ?? "veryfast",
      "-crf", String(opts.crf ?? 20),
      "-pix_fmt", "yuv420p",
      "-c:a", "copy",
      "-movflags", "+faststart",
      outputName,
    ];
    await ff.exec(args);
    const data = await ff.readFile(outputName);
    const blob = new Blob([data as Uint8Array], { type: "video/mp4" });
    await ff.deleteFile(inputName).catch(() => {});
    await ff.deleteFile(outputName).catch(() => {});
    return blob;
  } finally {
    ff.off("progress", handler);
  }
}
