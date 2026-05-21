import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { getCoreURLs } from "./ffmpeg-cache";

let _ffmpeg: FFmpeg | null = null;
let _loading: Promise<FFmpeg> | null = null;
let _execChain: Promise<unknown> = Promise.resolve();
const _logListeners = new Set<(msg: string) => void>();

export async function getFFmpeg(): Promise<FFmpeg> {
  if (_ffmpeg) return _ffmpeg;
  if (_loading) return _loading;
  _loading = (async () => {
    const ff = new FFmpeg();
    ff.on("log", ({ message }) => {
      for (const fn of _logListeners) {
        try {
          fn(message);
        } catch {
          /* noop */
        }
      }
    });
    const { coreURL, wasmURL } = await getCoreURLs();
    await ff.load({ coreURL, wasmURL });
    _ffmpeg = ff;
    return ff;
  })();
  try {
    return await _loading;
  } catch (e) {
    _loading = null;
    throw e;
  }
}

/** Warm up FFmpeg in the background so first job starts instantly. */
export function preloadFFmpeg() {
  getFFmpeg().catch(() => {
    /* surfaced at first job */
  });
}

/**
 * ffmpeg.wasm uses a single shared virtual filesystem + WASM heap.
 * Two concurrent jobs writing/reading files would corrupt each other.
 * This mutex serializes the actual FFmpeg work while leaving the UI
 * concurrency knob in place for queue throughput tuning.
 */
function withEngineLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = _execChain.then(fn, fn);
  _execChain = next.catch(() => {});
  return next;
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
    let done = false;
    const finish = (ok: boolean, meta?: VideoMeta, err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      if (ok && meta) resolve(meta);
      else reject(err ?? new Error("Could not read video metadata"));
    };
    const tryResolve = () => {
      const w = v.videoWidth;
      const h = v.videoHeight;
      const d = isFinite(v.duration) ? v.duration : 0;
      if (w > 0 && h > 0) finish(true, { width: w, height: h, duration: d });
    };
    const timer = setTimeout(() => {
      // Last-ditch: if dimensions arrived but the duration event never did,
      // accept them rather than rejecting the whole upload.
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        finish(true, {
          width: v.videoWidth,
          height: v.videoHeight,
          duration: isFinite(v.duration) ? v.duration : 0,
        });
      } else {
        finish(false, undefined, new Error("Timed out reading video metadata"));
      }
    }, 15000);
    v.onloadedmetadata = tryResolve;
    v.onloadeddata = tryResolve;
    v.oncanplay = tryResolve;
    v.onerror = () =>
      finish(false, undefined, new Error("Could not read video metadata"));
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
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error("thumbnail timeout"));
    }, 8000);
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(0.5, v.duration / 2);
    };
    v.onseeked = () => {
      clearTimeout(timer);
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
      clearTimeout(timer);
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

  // Primary strategy: ffmpeg's `delogo` filter. It rebuilds the masked
  // rectangle by interpolating from the pixels immediately around it,
  // so the surrounding background is preserved exactly and the seam
  // dissolves into the source instead of showing a hard border.
  //
  // delogo requires the region to be strictly inside the frame (it reads
  // from a 1px border around the box). We also need the rectangle to be
  // at least a few pixels in each dimension. The `band` parameter widens
  // the fuzzy blend ring so the join into the surrounding video is soft.
  let dx = Math.max(1, Math.floor(x));
  let dy = Math.max(1, Math.floor(y));
  let dw = Math.floor(w);
  let dh = Math.floor(h);
  if (dx + dw >= W) dw = W - dx - 1;
  if (dy + dh >= H) dh = H - dy - 1;
  dw = Math.max(4, dw);
  dh = Math.max(4, dh);
  // Wider band = softer, more omnidirectional blend (samples a thicker ring
  // of surrounding pixels instead of just a thin edge). This keeps the
  // surrounding background visually identical and removes any "copied from
  // one side" look.
  const band = Math.max(4, Math.min(20, Math.round(Math.min(dw, dh) * 0.12)));

  // Always use delogo for the actual fill — it interpolates equally from
  // all four sides so the background pattern is preserved without showing
  // a directional patch. The neighbour-patch overlay only kicks in if the
  // region is so large that delogo can't physically interpolate it (more
  // than ~25% of the frame area or a side longer than half the frame).
  const areaRatio = (dw * dh) / (W * H);
  const useDelogo =
    areaRatio <= 0.25 && dw < W * 0.5 && dh < H * 0.5;

  if (useDelogo) {
    return (
      `[0:v]delogo=x=${dx}:y=${dy}:w=${dw}:h=${dh}:band=${band}:show=0,` +
      `pad=ceil(iw/2)*2:ceil(ih/2)*2[outv]`
    );
  }

  // Fallback path: feathered neighbour-patch overlay.
  // Margin (M) expands the patch beyond the marked region so its edges sit
  // over real video pixels we can feather into. Feather (F) is the width of
  // the soft alpha gradient that hides the seam.
  const M = Math.max(6, Math.round(Math.min(w, h) * 0.08));
  const F = M;

  // Target patch placement (expanded by M on every side, clamped to frame).
  let px = Math.floor(x) - M;
  let py = Math.floor(y) - M;
  let pw = Math.floor(w) + 2 * M;
  let ph = Math.floor(h) + 2 * M;
  if (px < 0) { pw += px; px = 0; }
  if (py < 0) { ph += py; py = 0; }
  if (px + pw > W) pw = W - px;
  if (py + ph > H) ph = H - py;
  pw = Math.max(4, pw - (pw % 2));
  ph = Math.max(4, ph - (ph % 2));

  // Compute source crop region based on fill direction (sized to expanded patch)
  let sx = 0;
  let sy = 0;
  let sw = pw;
  let sh = ph;

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
        sw = Math.max(4, Math.min(pw, leftRoom));
        sx = x - sw;
        sy = py;
        sh = ph;
      } else {
        sw = Math.max(4, Math.min(pw, rightRoom));
        sx = x + w;
        sy = py;
        sh = ph;
      }
      break;
    }
    case "vertical": {
      if (topRoom >= bottomRoom && topRoom > 4) {
        sh = Math.max(4, Math.min(ph, topRoom));
        sy = y - sh;
        sx = px;
        sw = pw;
      } else {
        sh = Math.max(4, Math.min(ph, bottomRoom));
        sy = y + h;
        sx = px;
        sw = pw;
      }
      break;
    }
    case "edge": {
      // Thin edge strip from nearest border, stretched across the patch
      if (leftRoom >= rightRoom && leftRoom > 2) {
        sw = 4;
        sx = Math.max(0, x - 4);
        sy = py;
        sh = ph;
      } else {
        sw = 4;
        sx = Math.min(W - 4, x + w);
        sy = py;
        sh = ph;
      }
      break;
    }
    case "clone": {
      // Mirror an adjacent block of equal size
      if (rightRoom >= leftRoom && rightRoom >= pw) {
        sx = x + w;
        sy = py;
        sw = pw;
        sh = ph;
      } else if (leftRoom >= pw) {
        sx = Math.max(0, x - pw);
        sy = py;
        sw = pw;
        sh = ph;
      } else {
        sw = Math.max(4, Math.min(pw, Math.max(leftRoom, rightRoom)));
        sx = leftRoom >= rightRoom ? Math.max(0, x - sw) : x + w;
        sy = py;
        sh = ph;
      }
      break;
    }
  }

  // Clamp to frame
  sx = Math.max(0, Math.min(W - 2, Math.floor(sx)));
  sy = Math.max(0, Math.min(H - 2, Math.floor(sy)));
  sw = Math.max(2, Math.min(W - sx, Math.floor(sw)));
  sh = Math.max(2, Math.min(H - sy, Math.floor(sh)));

  // Build a feathered alpha so the patch fades into the surrounding video.
  // The alpha is 0 at the patch border and ramps to opaque over F pixels,
  // making the rectangular seam invisible. A light gblur on the patch
  // hides micro detail mismatch (grain/compression) between source crop
  // and surrounding pixels.
  //
  // Use geq with X,Y in the patch's coordinate space (W=pw, H=ph for luma;
  // half that for chroma — min(...) still ramps correctly so we apply the
  // same expression to all planes).
  const alphaExpr = `255*clip(min(min(X,W-X),min(Y,H-Y))/${F},0,1)`;

  return (
    `[0:v]split=2[base][src];` +
    `[src]crop=${sw}:${sh}:${sx}:${sy},scale=${pw}:${ph}:flags=lanczos,` +
    `gblur=sigma=1.2,format=yuva420p,` +
    `geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='${alphaExpr}'[patch];` +
    `[base][patch]overlay=${px}:${py}:format=auto,` +
    `pad=ceil(iw/2)*2:ceil(ih/2)*2[outv]`
  );
}

export interface ProcessOptions {
  region: WatermarkRegion;
  meta: VideoMeta;
  filename: string;
  preset?: "ultrafast" | "veryfast" | "fast" | "medium";
  crf?: number;
  audioMode?: "aac" | "copy" | "none";
  onProgress?: (ratio: number) => void;
  onLog?: (msg: string) => void;
  onCommand?: (cmd: string) => void;
}

export async function removeWatermark(
  file: File,
  opts: ProcessOptions,
): Promise<Blob> {
  return withEngineLock(async () => {
    const ff = await getFFmpeg();
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
    const inputName = `in_${stamp}.${ext}`;
    const outputName = `out_${stamp}.mp4`;

    const progressHandler = ({ progress }: { progress: number }) => {
      if (opts.onProgress)
        opts.onProgress(Math.min(1, Math.max(0, progress)));
    };
    ff.on("progress", progressHandler);
    if (opts.onLog) _logListeners.add(opts.onLog);

    try {
      await ff.writeFile(inputName, await fetchFile(file));
      const filter = buildFilter(opts.region, opts.meta);
      // Default to stream-copying audio: re-encoding the whole audio track
      // is often the slowest part of the pipeline and is unnecessary when
      // the source codec is already MP4-compatible. The retry ladder
      // automatically re-encodes to AAC if copy fails.
      const audioMode = opts.audioMode ?? "copy";
      const audioArgs: string[] =
        audioMode === "none"
          ? ["-an"]
          : audioMode === "copy"
            ? ["-map", "0:a?", "-c:a", "copy"]
            : ["-map", "0:a?", "-c:a", "aac", "-b:a", "128k"];
      const args = [
        "-threads", "0",
        "-i", inputName,
        "-filter_complex", filter,
        "-map", "[outv]",
        ...audioArgs,
        "-c:v", "libx264",
        "-preset", opts.preset ?? "veryfast",
        "-crf", String(opts.crf ?? 20),
        "-tune", "fastdecode",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-avoid_negative_ts", "make_zero",
        "-y",
        outputName,
      ];
      if (opts.onCommand) {
        opts.onCommand(`ffmpeg ${args.map(shellQuote).join(" ")}`);
      }
      await ff.exec(args);
      const data = (await ff.readFile(outputName)) as Uint8Array;
      const ab = new ArrayBuffer(data.byteLength);
      new Uint8Array(ab).set(data);
      const blob = new Blob([ab], { type: "video/mp4" });
      await ff.deleteFile(inputName).catch(() => {});
      await ff.deleteFile(outputName).catch(() => {});
      return blob;
    } finally {
      ff.off("progress", progressHandler);
      if (opts.onLog) _logListeners.delete(opts.onLog);
    }
  });
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./:=+@\-\[\]]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}
