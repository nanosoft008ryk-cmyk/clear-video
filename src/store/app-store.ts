import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FillMode, VideoMeta, WatermarkRegion } from "@/lib/ffmpeg-engine";

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

  addExport: (e: ExportItem, blob: Blob) => void;
  removeExport: (id: string) => void;

  setSettings: (patch: Partial<Settings>) => void;
  pushLog: (msg: string) => void;
  pushJobLog: (jobId: string, msg: string) => void;
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
      },

      addVideo: (v, file) => {
        get().videoFiles.set(v.id, file);
        set((s) => ({ videos: [...s.videos, v] }));
      },
      removeVideo: (id) => {
        get().videoFiles.delete(id);
        set((s) => ({ videos: s.videos.filter((v) => v.id !== id) }));
      },
      clearVideos: () => {
        get().videoFiles.clear();
        set({ videos: [] });
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
            j.id === id ? { ...j, status: "queued", progress: 0, error: undefined } : j,
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
      },
      removeExport: (id) => {
        get().exportBlobs.delete(id);
        set((s) => ({ exports: s.exports.filter((e) => e.id !== id) }));
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
    }),
    {
      name: "bvwr-store",
      partialize: (s) => ({
        templates: s.templates,
        settings: s.settings,
      }),
    },
  ),
);

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