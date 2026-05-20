/**
 * Stable local/offline cache for the FFmpeg core.
 *
 * Important: FFmpeg's worker imports ffmpeg-core.js with importScripts().
 * Some browsers reject Blob URLs created from IndexedDB-cached scripts, even
 * when the MIME type is re-applied. To eliminate the recurring
 * "failed to import ffmpeg-core.js" error, the engine now loads versioned,
 * same-origin core files from /public and uses Cache Storage + a service
 * worker only for persistence/offline serving.
 */

export const CORE_VERSION = "0.12.9";
const CORE_CACHE_REVISION = "2";
const CORE_CACHE_TOKEN = `${CORE_VERSION}-r${CORE_CACHE_REVISION}`;
const CORE_PATH = `/ffmpeg-core/${CORE_VERSION}`;
const CACHE_NAME = `ffmpeg-core-${CORE_CACHE_TOKEN}`;
const LEGACY_DB_NAME = "ffmpeg-core-cache";

export const CORE_FILES = [
  {
    path: "ffmpeg-core.js",
    mime: "text/javascript",
    minBytes: 50_000,
    signature: "export default createFFmpegCore",
  },
  { path: "ffmpeg-core.wasm", mime: "application/wasm", minBytes: 1_000_000 },
] as const;

export type CacheStatus = "idle" | "checking" | "downloading" | "ready" | "error";

export interface CacheState {
  status: CacheStatus;
  loaded: number;
  total: number;
  fromCache: boolean;
  error?: string;
}

let state: CacheState = {
  status: "idle",
  loaded: 0,
  total: 0,
  fromCache: false,
};
const listeners = new Set<(s: CacheState) => void>();

function setState(patch: Partial<CacheState>) {
  state = { ...state, ...patch };
  for (const fn of listeners) {
    try {
      fn(state);
    } catch {
      /* noop */
    }
  }
}

export function getCacheState(): CacheState {
  return state;
}

export function subscribeCache(fn: (s: CacheState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

async function fetchWithProgress(
  url: string,
  mime: string,
  onChunk: (delta: number, totalHint: number) => void,
): Promise<Blob> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  const totalHint = Number(r.headers.get("content-length") || 0);
  if (!r.body) {
    const blob = await r.blob();
    onChunk(blob.size, totalHint || blob.size);
    return new Blob([blob], { type: mime });
  }
  const reader = r.body.getReader();
  const chunks: BlobPart[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    chunks.push(copy.buffer);
    onChunk(value.byteLength, totalHint);
  }
  return new Blob(chunks, { type: mime });
}

async function deleteLegacyIDB() {
  if (!("indexedDB" in window)) return;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

async function registerCoreServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((reg) => new URL(reg.scope).pathname === "/ffmpeg-core/")
        .map((reg) => reg.unregister()),
    );
    const reg = await navigator.serviceWorker.register("/ffmpeg-core-sw.js", {
      scope: "/",
    });
    await reg.update().catch(() => undefined);
  } catch {
    // Static same-origin files still load; offline caching is best-effort.
  }
}

function coreUrl(path: string) {
  return `${CORE_PATH}/${path}`;
}

async function hasUsableCoreCache(cache: Cache): Promise<boolean> {
  const checks = await Promise.all(
    CORE_FILES.map(async (file) => {
      const res = await cache.match(coreUrl(file.path));
      if (!res?.ok) return false;
      const blob = await res.blob();
      if (blob.size < file.minBytes) return false;
      if ("signature" in file) {
        const text = await blob.text();
        return text.includes(file.signature);
      }
      return true;
    }),
  );
  return checks.every(Boolean);
}

async function warmCoreCache(): Promise<void> {
  if (!("caches" in window)) return;
  const cache = await caches.open(CACHE_NAME);
  if (await hasUsableCoreCache(cache)) {
    const sizes = await Promise.all(
      CORE_FILES.map(async (file) => {
        const res = await cache.match(coreUrl(file.path));
        const blob = await res?.blob();
        return blob?.size ?? 0;
      }),
    );
    const total = sizes.reduce((a, b) => a + b, 0);
    setState({ status: "ready", loaded: total, total, fromCache: true });
    return;
  }

  setState({ status: "downloading", loaded: 0, total: 0, fromCache: false });
  let loaded = 0;
  let total = 0;
  for (const file of CORE_FILES) {
    let fileTotal = 0;
    const blob = await fetchWithProgress(coreUrl(file.path), file.mime, (d, t) => {
      loaded += d;
      if (t && t !== fileTotal) {
        total += t - fileTotal;
        fileTotal = t;
      }
      setState({ loaded, total: Math.max(total, loaded) });
    });
    await cache.put(
      coreUrl(file.path),
      new Response(blob, {
        headers: {
          "Content-Type": file.mime,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      }),
    );
  }
  const finalTotal = Math.max(total, loaded);
  setState({ status: "ready", loaded: finalTotal, total: finalTotal, fromCache: false });
}

/**
 * Returns stable same-origin URLs for the core js + wasm files. They are safe
 * for importScripts() and are cached for offline use by Cache Storage/SW.
 */
export async function getCoreURLs(): Promise<{
  coreURL: string;
  wasmURL: string;
}> {
  setState({ status: "checking", loaded: 0, total: 0, error: undefined });
  try {
    await deleteLegacyIDB();
    await registerCoreServiceWorker();
    await warmCoreCache();
    return {
      coreURL: coreUrl("ffmpeg-core.js"),
      wasmURL: coreUrl("ffmpeg-core.wasm"),
    };
  } catch (e) {
    setState({
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

export async function clearCoreCache(): Promise<void> {
  await Promise.all([
    deleteLegacyIDB(),
    "caches" in window ? caches.delete(CACHE_NAME) : Promise.resolve(false),
  ]);
  setState({
    status: "idle",
    loaded: 0,
    total: 0,
    fromCache: false,
    error: undefined,
  });
}