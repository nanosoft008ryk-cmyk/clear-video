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

  // Multi-directional patch reconstruction:
  //   1. Sample up to 4 neighbouring strips (left / right / top / bottom)
  //      from the area immediately around the marked region.
  //   2. Scale each to the expanded patch size and average them with
  //      `blend=all_mode=average` so no single side dominates — the
  //      background colour and texture come from all available sides.
  //   3. Apply only a narrow feathered alpha at the patch edge. The patch
  //      itself is not blurred, so the reconstructed background keeps the
  //      original video texture instead of turning the marked box soft.
  // This works with the stock ffmpeg.wasm filter set (no delogo needed).
  const M = Math.max(6, Math.round(Math.min(w, h) * 0.08));
  const F = Math.max(3, Math.min(10, Math.round(Math.min(w, h) * 0.035)));

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

  const leftRoom = Math.max(0, Math.floor(x));
  const rightRoom = Math.max(0, Math.floor(W - (x + w)));
  const topRoom = Math.max(0, Math.floor(y));
  const bottomRoom = Math.max(0, Math.floor(H - (y + h)));

  type Crop = { sx: number; sy: number; sw: number; sh: number };
  const sides: Crop[] = [];

  // Decide which sides we have room to sample from. We require at least
  // 4px of clean pixels on a side to consider it. fillMode lets the user
  // restrict sampling direction; "auto" / "clone" / "edge" use every
  // available side.
  const wantH = fillMode === "horizontal" || fillMode === "auto" ||
    fillMode === "clone" || fillMode === "edge";
  const wantV = fillMode === "vertical" || fillMode === "auto" ||
    fillMode === "clone" || fillMode === "edge";

  if (wantH && leftRoom >= 4) {
    const sw = Math.min(pw, leftRoom);
    sides.push({ sx: Math.max(0, Math.floor(x) - sw), sy: py, sw, sh: ph });
  }
  if (wantH && rightRoom >= 4) {
    const sw = Math.min(pw, rightRoom);
    sides.push({ sx: Math.floor(x + w), sy: py, sw, sh: ph });
  }
  if (wantV && topRoom >= 4) {
    const sh = Math.min(ph, topRoom);
    sides.push({ sx: px, sy: Math.max(0, Math.floor(y) - sh), sw: pw, sh });
  }
  if (wantV && bottomRoom >= 4) {
    const sh = Math.min(ph, bottomRoom);
    sides.push({ sx: px, sy: Math.floor(y + h), sw: pw, sh });
  }

  // Worst case: the box touches the frame on every restricted side. Fall
  // back to whatever single neighbour exists.
  if (sides.length === 0) {
    if (leftRoom >= 4) sides.push({ sx: Math.max(0, Math.floor(x) - Math.min(pw, leftRoom)), sy: py, sw: Math.min(pw, leftRoom), sh: ph });
    else if (rightRoom >= 4) sides.push({ sx: Math.floor(x + w), sy: py, sw: Math.min(pw, rightRoom), sh: ph });
    else if (topRoom >= 4) sides.push({ sx: px, sy: Math.max(0, Math.floor(y) - Math.min(ph, topRoom)), sw: pw, sh: Math.min(ph, topRoom) });
    else if (bottomRoom >= 4) sides.push({ sx: px, sy: Math.floor(y + h), sw: pw, sh: Math.min(ph, bottomRoom) });
    else sides.push({ sx: 0, sy: 0, sw: pw, sh: ph }); // degenerate
  }

  // Clamp every crop to the frame and to even pixel offsets.
  for (const c of sides) {
    c.sx = Math.max(0, Math.min(W - 2, Math.floor(c.sx)));
    c.sy = Math.max(0, Math.min(H - 2, Math.floor(c.sy)));
    c.sw = Math.max(2, Math.min(W - c.sx, Math.floor(c.sw)));
    c.sh = Math.max(2, Math.min(H - c.sy, Math.floor(c.sh)));
  }

  // Feathered alpha: 0 at the expanded patch border, fully opaque after a
  // small edge-only transition. This hides seams without blurring the mask
  // area or washing out the replacement background.
  const alphaExpr = `255*clip(min(min(X,W-X),min(Y,H-Y))/${F},0,1)`;

  const n = sides.length;
  // [0:v] is split into (n + 1) streams: 1 base + n side samples.
  const splitLabels = ["base", ...sides.map((_, i) => `s${i}`)];
  let graph = `[0:v]split=${n + 1}[${splitLabels.join("][")}];`;

  // Crop + scale each sampled side into a same-size patch candidate.
  for (let i = 0; i < n; i++) {
    const c = sides[i];
    graph += `[s${i}]crop=${c.sw}:${c.sh}:${c.sx}:${c.sy},scale=${pw}:${ph}:flags=lanczos[p${i}];`;
  }

  // Average the candidates pairwise so the final patch carries the colour
  // and texture of all available sides equally — no directional copy.
  let last = `p0`;
  for (let i = 1; i < n; i++) {
    const out = i === n - 1 ? "avg" : `b${i}`;
    graph += `[${last}][p${i}]blend=all_mode=average[${out}];`;
    last = out;
  }
  if (n === 1) {
    // Only one source — alias it as "avg" so downstream chain is the same.
    graph += `[p0]copy[avg];`;
  }

  graph +=
    `[avg]format=yuva420p,` +
    `geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='${alphaExpr}'[patch];` +
    `[base][patch]overlay=${px}:${py}:format=auto,` +
    `pad=ceil(iw/2)*2:ceil(ih/2)*2[outv]`;

  return graph;
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
