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
  const attempt = (job.attempts ?? 0) + 1;
  const profile = resolveProfile(attempt, s.settings);
  s.updateJob(jobId, {
    startedAt: Date.now(),
    attempts: attempt,
    stderr: [],
    command: undefined,
    appliedPreset: profile.preset,
    appliedCrf: profile.crf,
    appliedAudio: profile.audio,
  });
  useAppStore
    .getState()
    .pushJobLog(
      jobId,
      `▶ attempt ${attempt} · preset=${profile.preset} crf=${profile.crf} audio=${profile.audio}`,
    );
  try {
    const region = templateToRegion(template, video.meta);
    const blob = await removeWatermark(file, {
      region,
      meta: video.meta,
      filename: video.name,
      preset: profile.preset,
      crf: profile.crf,
      audioMode: profile.audio,
      blurStrength: s.settings.blurStrength ?? 0,
      onProgress: (p) => useAppStore.getState().updateJob(jobId, { progress: p }),
      onLog: (m) => {
        const short = jobId.slice(0, 8);
        useAppStore.getState().pushLog(`[${short}] ${m}`);
        useAppStore.getState().pushJobLog(jobId, m);
        useAppStore.getState().pushJobStderr(jobId, m);
      },
      onCommand: (cmd) => {
        useAppStore.getState().updateJob(jobId, { command: cmd });
        useAppStore.getState().pushJobLog(jobId, `$ ${cmd}`);
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
    const msg = e instanceof Error ? e.message : String(e);
    const maxRetries = useAppStore.getState().settings.maxRetries ?? 0;
    const canRetry = attempt <= maxRetries; // attempts already incremented
    useAppStore.getState().pushJobLog(jobId, `✗ attempt ${attempt} failed: ${msg}`);
    if (canRetry) {
      useAppStore.getState().pushJobLog(
        jobId,
        `↻ retrying with safer fallback (attempt ${attempt + 1}/${maxRetries + 1})`,
      );
      useAppStore.getState().updateJob(jobId, {
        status: "queued",
        progress: 0,
        error: undefined,
      });
    } else {
      useAppStore.getState().updateJob(jobId, {
        status: "error",
        error: msg,
        finishedAt: Date.now(),
      });
    }
  }
}

interface AttemptProfile {
  preset: "ultrafast" | "veryfast" | "fast" | "medium";
  crf: number;
  audio: "aac" | "copy" | "none";
}

/**
 * Each successive attempt picks safer, more compatible settings:
 *  1. user's chosen settings + audio stream-copy (fastest path)
 *  2. user's chosen settings + AAC re-encode (handles incompatible source audio)
 *  3. fast preset, slightly higher CRF, AAC re-encode (more robust output)
 *  4. medium preset, CRF 28, copy audio (skip re-encode entirely)
 *  5+. medium preset, CRF 30, drop audio (last resort)
 */
function resolveProfile(
  attempt: number,
  settings: { preset: AttemptProfile["preset"]; crf: number },
): AttemptProfile {
  if (attempt <= 1) {
    return { preset: settings.preset, crf: settings.crf, audio: "copy" };
  }
  if (attempt === 2) {
    return { preset: settings.preset, crf: settings.crf, audio: "aac" };
  }
  if (attempt === 3) {
    return {
      preset: "fast",
      crf: Math.min(28, settings.crf + 4),
      audio: "aac",
    };
  }
  if (attempt === 4) {
    return { preset: "medium", crf: 28, audio: "copy" };
  }
  return { preset: "medium", crf: 30, audio: "none" };
}