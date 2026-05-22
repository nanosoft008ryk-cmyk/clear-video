/**
 * Minimal IndexedDB wrapper used to persist large binary data
 * (uploaded video Files + exported Blobs) across page reloads.
 * Zustand's `persist` middleware only handles JSON, so blobs need
 * their own store. Metadata (the JSON-safe parts) is still mirrored
 * into zustand so the UI re-renders without awaiting IDB.
 */

const DB_NAME = "clearvideo-store";
const DB_VERSION = 1;
const VIDEOS_STORE = "videos";
const EXPORTS_STORE = "exports";

export interface PersistedVideo {
  id: string;
  name: string;
  size: number;
  meta: { width: number; height: number; duration: number };
  thumbnail?: string;
  relativePath?: string;
  file: Blob;
}

export interface PersistedExport {
  id: string;
  jobId: string;
  name: string;
  size: number;
  createdAt: number;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(VIDEOS_STORE)) {
        db.createObjectStore(VIDEOS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(EXPORTS_STORE)) {
        db.createObjectStore(EXPORTS_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | void> {
  return openDB().then(
    (db) =>
      new Promise<T | void>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let result: T | undefined;
        const req = run(s);
        if (req) {
          req.onsuccess = () => {
            result = req.result as T;
          };
          req.onerror = () => reject(req.error);
        }
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export async function putVideo(v: PersistedVideo): Promise<void> {
  await tx(VIDEOS_STORE, "readwrite", (s) => s.put(v));
}
export async function deleteVideo(id: string): Promise<void> {
  await tx(VIDEOS_STORE, "readwrite", (s) => s.delete(id));
}
export async function clearVideos(): Promise<void> {
  await tx(VIDEOS_STORE, "readwrite", (s) => s.clear());
}
export async function getAllVideos(): Promise<PersistedVideo[]> {
  const out = (await tx<PersistedVideo[]>(VIDEOS_STORE, "readonly", (s) =>
    s.getAll(),
  )) as PersistedVideo[] | undefined;
  return out ?? [];
}

export async function putExport(e: PersistedExport): Promise<void> {
  await tx(EXPORTS_STORE, "readwrite", (s) => s.put(e));
}
export async function deleteExport(id: string): Promise<void> {
  await tx(EXPORTS_STORE, "readwrite", (s) => s.delete(id));
}
export async function clearExports(): Promise<void> {
  await tx(EXPORTS_STORE, "readwrite", (s) => s.clear());
}
export async function getAllExports(): Promise<PersistedExport[]> {
  const out = (await tx<PersistedExport[]>(EXPORTS_STORE, "readonly", (s) =>
    s.getAll(),
  )) as PersistedExport[] | undefined;
  return out ?? [];
}
export async function deleteExportsForJobs(jobIds: Set<string>): Promise<void> {
  const all = await getAllExports();
  for (const e of all) {
    if (jobIds.has(e.jobId)) await deleteExport(e.id);
  }
}