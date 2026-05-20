/**
 * Persistent IndexedDB cache for the FFmpeg core (~30 MB) so it only
 * downloads once and is available offline afterwards.
 *
 * Exposes a tiny subscribe/getState API that the app-store mirrors so
 * UI components can render a download progress and an "offline ready"
 * indicator without coupling the engine to React.
 */

const DB_NAME = "ffmpeg-core-cache";
const STORE = "files";
const VERSION = 1;

export const CORE_VERSION = "0.12.10";
export const CORE_FILES = [
  { path: "ffmpeg-core.js", mime: "text/javascript" },
  { path: "ffmpeg-core.wasm", mime: "application/wasm" },
] as const;

const CORE_BASES = [
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
];

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<Blob | undefined> {
  try {
    const db = await openDB();
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result as Blob | undefined);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return undefined;
  }
}

async function idbPut(key: string, value: Blob): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* cache write failures are non-fatal */
  }
}

async function idbClear(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* noop */
  }
}

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
  const r = await fetch(url, { cache: "force-cache" });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  const totalHint = Number(r.headers.get("content-length") || 0);
  if (!r.body) {
    const blob = await r.blob();
    onChunk(blob.size, totalHint || blob.size);
    return new Blob([blob], { type: mime });
  }
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onChunk(value.byteLength, totalHint);
  }
  return new Blob(chunks, { type: mime });
}

async function fetchCoreFile(
  path: string,
  mime: string,
  onChunk: (d: number, t: number) => void,
): Promise<Blob> {
  let lastErr: unknown;
  for (const base of CORE_BASES) {
    try {
      return await fetchWithProgress(`${base}/${path}`, mime, onChunk);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("core fetch failed");
}

/**
 * Returns blob URLs for the core js + wasm files, fetching and caching
 * them in IndexedDB on first run. Subsequent calls are instant offline.
 */
export async function getCoreBlobURLs(): Promise<{
  coreURL: string;
  wasmURL: string;
}> {
  setState({ status: "checking", loaded: 0, total: 0, error: undefined });

  const cached = await Promise.all(
    CORE_FILES.map(async (f) => ({
      meta: f,
      blob: await idbGet(`${CORE_VERSION}/${f.path}`),
    })),
  );

  if (cached.every((c) => c.blob)) {
    const blobs = cached.map((c) => c.blob!);
    const total = blobs.reduce((a, b) => a + b.size, 0);
    setState({
      status: "ready",
      loaded: total,
      total,
      fromCache: true,
    });
    return {
      coreURL: URL.createObjectURL(blobs[0]),
      wasmURL: URL.createObjectURL(blobs[1]),
    };
  }

  setState({ status: "downloading", loaded: 0, total: 0, fromCache: false });

  // Approximate total — content-length from CDN updates total once first
  // response header lands; we accumulate from per-file totals as known.
  let loaded = 0;
  let total = 0;
  const blobs: Blob[] = [];
  try {
    for (const c of cached) {
      if (c.blob) {
        blobs.push(c.blob);
        loaded += c.blob.size;
        total += c.blob.size;
        setState({ loaded, total });
        continue;
      }
      let fileTotal = 0;
      const blob = await fetchCoreFile(c.meta.path, c.meta.mime, (d, t) => {
        loaded += d;
        if (t && t !== fileTotal) {
          total += t - fileTotal;
          fileTotal = t;
        }
        setState({ loaded, total: Math.max(total, loaded) });
      });
      blobs.push(blob);
      await idbPut(`${CORE_VERSION}/${c.meta.path}`, blob);
    }
    const finalTotal = blobs.reduce((a, b) => a + b.size, 0);
    setState({
      status: "ready",
      loaded: finalTotal,
      total: finalTotal,
      fromCache: false,
    });
    return {
      coreURL: URL.createObjectURL(blobs[0]),
      wasmURL: URL.createObjectURL(blobs[1]),
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
  await idbClear();
  setState({
    status: "idle",
    loaded: 0,
    total: 0,
    fromCache: false,
    error: undefined,
  });
}