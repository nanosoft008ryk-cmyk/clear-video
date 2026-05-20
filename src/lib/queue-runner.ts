import { removeWatermark } from "@/lib/ffmpeg-engine";
import { templateToRegion, useAppStore } from "@/store/app-store";

let running = 0;
let started = false;
let unsub: (() => void) | null = null;

export function startQueueRunner() {
  if (started) return;
  started = true;
  const tick = async () => {
    const { concurrency } = useAppStore.getState().settings;
    while (running < concurrency) {
      const next = useAppStore.getState().jobs.find((j) => j.status === "queued");
      if (!next) break;
      // Optimistically mark as processing so the next loop iteration
      // doesn't pick the same job before runJob's async state update lands.
      useAppStore.getState().updateJob(next.id, { status: "processing", progress: 0 });
      running++;
      runJob(next.id).finally(() => {
        running--;
        tick();
      });
    }
  };
  // Re-tick only when jobs array changes, not on every progress update.
  unsub = useAppStore.subscribe((s, prev) => {
    if (s.jobs !== prev.jobs) tick();
  });
  setInterval(tick, 1500);
  tick();
}

export function stopQueueRunner() {
  unsub?.();
  unsub = null;
  started = false;
}

async function runJob(jobId: string) {
  const s = useAppStore.getState();
  const job = s.jobs.find((j) => j.id === jobId);
  if (!job) return;
  if (job.status === "cancelled") return;
  const video = s.videos.find((v) => v.id === job.videoId);
  const template = s.templates.find((t) => t.id === job.templateId);
  const file = s.videoFiles.get(job.videoId);
  if (!video || !template || !file) {
    s.updateJob(jobId, { status: "error", error: "Missing input" });
    return;
  }
  s.updateJob(jobId, { startedAt: Date.now() });
  try {
    const region = templateToRegion(template, video.meta);
    const blob = await removeWatermark(file, {
      region,
      meta: video.meta,
      filename: video.name,
      preset: s.settings.preset,
      crf: s.settings.crf,
      onProgress: (p) => useAppStore.getState().updateJob(jobId, { progress: p }),
      onLog: (m) => {
        const short = jobId.slice(0, 8);
        useAppStore.getState().pushLog(`[${short}] ${m}`);
        useAppStore.getState().pushJobLog(jobId, m);
      },
    });
    const exportId = crypto.randomUUID();
    const baseName = video.name.replace(/\.[^.]+$/, "");
    useAppStore.getState().addExport(
      {
        id: exportId,
        jobId,
        name: `${baseName}_clean.mp4`,
        size: blob.size,
        createdAt: Date.now(),
      },
      blob,
    );
    useAppStore.getState().updateJob(jobId, {
      status: "done",
      progress: 1,
      finishedAt: Date.now(),
    });
  } catch (e) {
    useAppStore.getState().updateJob(jobId, {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}