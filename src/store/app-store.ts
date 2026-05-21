import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FillMode, VideoMeta, WatermarkRegion } from "@/lib/ffmpeg-engine";
import {
  subscribeCache,
  getCacheState,
  type CacheState,
} from "@/lib/ffmpeg-cache";
import {
  clearVideos as idbClearVideos,
  deleteExport as idbDeleteExport,
  deleteVideo as idbDeleteVideo,
  getAllExports as idbGetAllExports,
  getAllVideos as idbGetAllVideos,
  putExport as idbPutExport,
  putVideo as idbPutVideo,
} from "@/lib/idb-store";

export interface Template {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fillMode: FillMode;
  createdAt: number;
  // Reference resolution the box was drawn against (for proportional scaling
  // to any video size). If absent, treated as absolute pixels.
  refWidth?: number;
  refHeight?: number;
}

export type JobStatus =
  | "queued"
  | "processing"
  | "done"
  | "error"
  | "cancelled";

export interface VideoItem {
  id: string;
  name: string;
  size: number;
  meta: VideoMeta;
  thumbnail?: string;
  // Captured from <input webkitdirectory> or DataTransferItem entries.
  // Used to recreate folder structure inside the batch ZIP export.
  relativePath?: string;
}

export interface QueueJob {
  id: string;
  videoId: string;
  templateId: string;
  status: JobStatus;
  progress: number;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  attempts: number;
  command?: string;
  stderr?: string[];
  appliedPreset?: string;
  appliedCrf?: number;
  appliedAudio?: "aac" | "copy" | "none";
}

export interface ExportItem {
  id: string;
  jobId: string;
  name: string;
  size: number;
  createdAt: number;
  // Note: blob URLs are session-only; we keep metadata persistently
  // and store the actual Blob in a separate non-persisted Map.
}

interface Settings {
  concurrency: number;
  preset: "ultrafast" | "veryfast" | "fast" | "medium";
  crf: number;
  autoDelete: boolean;
  maxRetries: number;
}

interface Store {
  // session-only (not persisted)
  videoFiles: Map<string, File>;
  exportBlobs: Map<string, Blob>;

  videos: VideoItem[];
  templates: Template[];
  jobs: QueueJob[];
  exports: ExportItem[];
  settings: Settings;
  logs: string[];
  jobLogs: Record<string, string[]>;
  coreCache: CacheState;
  hydrated: boolean;

  addVideo: (v: VideoItem, file: File) => void;
  removeVideo: (id: string) => void;
  clearVideos: () => void;

  addTemplate: (t: Template) => void;
  updateTemplate: (id: string, patch: Partial<Template>) => void;
  removeTemplate: (id: string) => void;
  duplicateTemplate: (id: string) => void;

  enqueue: (videoIds: string[], templateId: string) => void;
  updateJob: (id: string, patch: Partial<QueueJob>) => void;
  cancelJob: (id: string) => void;
  retryJob: (id: string) => void;
  clearJobs: () => void;
  removeJob: (id: string) => void;

  addExport: (e: ExportItem, blob: Blob) => void;
  removeExport: (id: string) => void;

  setSettings: (patch: Partial<Settings>) => void;
  pushLog: (msg: string) => void;
  pushJobLog: (jobId: string, msg: string) => void;
  pushJobStderr: (jobId: string, msg: string) => void;
  setCoreCache: (s: CacheState) => void;
  rehydrateFromIDB: () => Promise<void>;
}

export const useAppStore = create<Store>()(
  persist(
    (set, get) => ({
      videoFiles: new Map(),
      exportBlobs: new Map(),
      videos: [],
      templates: [],
      jobs: [],
      exports: [],
      logs: [],
      jobLogs: {},
      settings: {
        concurrency: 2,
        preset: "veryfast",
        crf: 20,
        autoDelete: false,
        maxRetries: 2,
      },
      coreCache: getCacheState(),
      hydrated: false,

      addVideo: (v, file) => {
        get().videoFiles.set(v.id, file);
        set((s) => ({ videos: [...s.videos, v] }));
        void idbPutVideo({
          id: v.id,
          name: v.name,
          size: v.size,
          meta: v.meta,
          thumbnail: v.thumbnail,
          relativePath: v.relativePath,
          file,
        }).catch(() => undefined);
      },
      removeVideo: (id) => {
        get().videoFiles.delete(id);
        set((s) => ({ videos: s.videos.filter((v) => v.id !== id) }));
        void idbDeleteVideo(id).catch(() => undefined);
      },
      clearVideos: () => {
        get().videoFiles.clear();
        set({ videos: [] });
        void idbClearVideos().catch(() => undefined);
      },

      addTemplate: (t) => set((s) => ({ templates: [t, ...s.templates] })),
      updateTemplate: (id, patch) =>
        set((s) => ({
          templates: s.templates.map((t) =>
            t.id === id ? { ...t, ...patch } : t,
          ),
        })),
      removeTemplate: (id) =>
        set((s) => ({
          templates: s.templates.filter((t) => t.id !== id),
          jobs: s.jobs.map((j) =>
            j.templateId === id && j.status === "queued"
              ? { ...j, status: "cancelled" as JobStatus, error: "Template deleted" }
              : j,
          ),
        })),
      duplicateTemplate: (id) =>
        set((s) => {
          const t = s.templates.find((x) => x.id === id);
          if (!t) return s;
          return {
            templates: [
              {
                ...t,
                id: crypto.randomUUID(),
                name: `${t.name} copy`,
                createdAt: Date.now(),
              },
              ...s.templates,
            ],
          };
        }),

      enqueue: (videoIds, templateId) =>
        set((s) => ({
          jobs: [
            ...s.jobs,
            ...videoIds.map((vid) => ({
              id: crypto.randomUUID(),
              videoId: vid,
              templateId,
              status: "queued" as JobStatus,
              progress: 0,
              attempts: 0,
            })),
          ],
        })),
      updateJob: (id, patch) =>
        set((s) => ({
          jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)),
        })),
      cancelJob: (id) =>
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.id === id && (j.status === "queued" || j.status === "processing")
              ? { ...j, status: "cancelled" }
              : j,
          ),
        })),
      retryJob: (id) =>
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.id === id
              ? {
                  ...j,
                  status: "queued",
                  progress: 0,
                  error: undefined,
                  attempts: 0,
                  stderr: [],
                  command: undefined,
                }
              : j,
          ),
        })),
      clearJobs: () =>
        set((s) => ({
          jobs: s.jobs.filter(
            (j) => j.status === "queued" || j.status === "processing",
          ),
        })),

      addExport: (e, blob) => {
        get().exportBlobs.set(e.id, blob);
        set((s) => ({ exports: [e, ...s.exports] }));
        void idbPutExport({
          id: e.id,
          jobId: e.jobId,
          name: e.name,
          size: e.size,
          createdAt: e.createdAt,
          blob,
        }).catch(() => undefined);
      },
      removeExport: (id) => {
        get().exportBlobs.delete(id);
        set((s) => ({ exports: s.exports.filter((e) => e.id !== id) }));
        void idbDeleteExport(id).catch(() => undefined);
      },

      setSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),
      pushLog: (msg) =>
        set((s) => ({ logs: [...s.logs.slice(-499), msg] })),
      pushJobLog: (jobId, msg) =>
        set((s) => {
          const prev = s.jobLogs[jobId] ?? [];
          return {
            jobLogs: { ...s.jobLogs, [jobId]: [...prev.slice(-299), msg] },
          };
        }),
      pushJobStderr: (jobId, msg) =>
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.id === jobId
              ? { ...j, stderr: [...(j.stderr ?? []).slice(-299), msg] }
              : j,
          ),
        })),
      setCoreCache: (cs) => set({ coreCache: cs }),

      rehydrateFromIDB: async () => {
        if (get().hydrated) return;
        try {
          const [vids, exps] = await Promise.all([
            idbGetAllVideos(),
            idbGetAllExports(),
          ]);
          const videoFiles = get().videoFiles;
          const exportBlobs = get().exportBlobs;
          const videos: VideoItem[] = [];
          for (const v of vids) {
            videoFiles.set(
              v.id,
              new File([v.file], v.name, { type: v.file.type || "video/mp4" }),
            );
            videos.push({
              id: v.id,
              name: v.name,
              size: v.size,
              meta: v.meta,
              thumbnail: v.thumbnail,
              relativePath: v.relativePath,
            });
          }
          const exports: ExportItem[] = [];
          for (const e of exps) {
            exportBlobs.set(e.id, e.blob);
            exports.push({
              id: e.id,
              jobId: e.jobId,
              name: e.name,
              size: e.size,
              createdAt: e.createdAt,
            });
          }
          // Resume jobs interrupted by the reload.
          const jobs = get().jobs.map((j) =>
            j.status === "processing"
              ? { ...j, status: "queued" as JobStatus, progress: 0 }
              : j,
          );
          set({ videos, exports, jobs, hydrated: true });
        } catch {
          set({ hydrated: true });
        }
      },
    }),
    {
      name: "bvwr-store",
      partialize: (s) => ({
        templates: s.templates,
        settings: s.settings,
        jobs: s.jobs,
      }),
    },
  ),
);

// Mirror the FFmpeg core cache state into the zustand store so React
// components can re-render without a separate subscription.
if (typeof window !== "undefined") {
  subscribeCache((cs) => {
    useAppStore.getState().setCoreCache(cs);
  });
}

export function templateToRegion(
  t: Template,
  meta: VideoMeta,
): WatermarkRegion {
  if (t.refWidth && t.refHeight) {
    const sx = meta.width / t.refWidth;
    const sy = meta.height / t.refHeight;
    return {
      x: Math.round(t.x * sx),
      y: Math.round(t.y * sy),
      width: Math.round(t.width * sx),
      height: Math.round(t.height * sy),
      fillMode: t.fillMode,
    };
  }
  return {
    x: t.x,
    y: t.y,
    width: t.width,
    height: t.height,
    fillMode: t.fillMode,
  };
}