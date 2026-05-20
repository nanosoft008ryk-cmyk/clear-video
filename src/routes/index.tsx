import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import {
  Wand2,
  Layers,
  Download,
  Archive,
  RefreshCcw,
  X,
  ChevronDown,
  Zap,
  Film,
  Gauge,
  ShieldCheck,
  Lock,
  Sparkles,
  Cpu,
  Upload as UploadIcon,
  MousePointerClick,
  DownloadCloud,
} from "lucide-react";
import JSZip from "jszip";
import { useAppStore, type Template } from "@/store/app-store";
import type { FillMode } from "@/lib/ffmpeg-engine";
import { UploadZone } from "@/components/UploadZone";
import { Pill, Progress, formatDuration } from "@/components/ui-bits";

export const Route = createFileRoute("/")({
  component: HomePage,
});

const FILL_MODES: { value: FillMode; label: string }[] = [
  { value: "horizontal", label: "Horizontal stretch" },
  { value: "vertical", label: "Vertical stretch" },
  { value: "auto", label: "Auto (best direction)" },
  { value: "edge", label: "Edge expand" },
  { value: "clone", label: "Clone adjacent" },
];

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function HomePage() {
  const videos = useAppStore((s) => s.videos);
  const videoFiles = useAppStore((s) => s.videoFiles);
  const templates = useAppStore((s) => s.templates);
  const jobs = useAppStore((s) => s.jobs);
  const exports_ = useAppStore((s) => s.exports);
  const exportBlobs = useAppStore((s) => s.exportBlobs);
  const removeVideo = useAppStore((s) => s.removeVideo);
  const addTemplate = useAppStore((s) => s.addTemplate);
  const removeTemplate = useAppStore((s) => s.removeTemplate);
  const enqueue = useAppStore((s) => s.enqueue);
  const retryJob = useAppStore((s) => s.retryJob);
  const cancelJob = useAppStore((s) => s.cancelJob);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [box, setBox] = useState({ x: 40, y: 40, width: 200, height: 80 });
  const [fillMode, setFillMode] = useState<FillMode>("horizontal");

  // Auto-select first uploaded video
  useEffect(() => {
    if (!activeId && videos[0]) setActiveId(videos[0].id);
    if (activeId && !videos.find((v) => v.id === activeId)) {
      setActiveId(videos[0]?.id ?? null);
    }
  }, [videos, activeId]);

  const active = videos.find((v) => v.id === activeId) ?? null;
  const fileURL = useMemo(() => {
    if (!active) return null;
    const f = videoFiles.get(active.id);
    return f ? URL.createObjectURL(f) : null;
  }, [active, videoFiles]);

  useEffect(
    () => () => {
      if (fileURL) URL.revokeObjectURL(fileURL);
    },
    [fileURL],
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const update = () => {
      if (stageRef.current)
        setStage({
          w: stageRef.current.clientWidth,
          h: stageRef.current.clientHeight,
        });
    };
    update();
    const ro = new ResizeObserver(update);
    if (stageRef.current) ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [active]);

  const scale = active
    ? Math.min(stage.w / active.meta.width, stage.h / active.meta.height) || 1
    : 1;
  const dispW = active ? active.meta.width * scale : 0;
  const dispH = active ? active.meta.height * scale : 0;

  const toRegion = () => {
    if (!active) return null;
    const sx = active.meta.width / Math.max(1, dispW);
    const sy = active.meta.height / Math.max(1, dispH);
    return {
      x: Math.round(box.x * sx),
      y: Math.round(box.y * sy),
      width: Math.round(box.width * sx),
      height: Math.round(box.height * sy),
    };
  };

  const buildTemplate = (name: string): Template | null => {
    if (!active) return null;
    const r = toRegion();
    if (!r) return null;
    return {
      id: crypto.randomUUID(),
      name,
      ...r,
      fillMode,
      createdAt: Date.now(),
      refWidth: active.meta.width,
      refHeight: active.meta.height,
    };
  };

  const removeCurrent = () => {
    if (!active) return;
    const t = buildTemplate(`mark-${Date.now().toString(36)}`);
    if (!t) return;
    addTemplate(t);
    enqueue([active.id], t.id);
    scrollToId("results");
  };

  const removeAll = () => {
    if (!active || videos.length === 0) return;
    const t = buildTemplate(`mark-${Date.now().toString(36)}`);
    if (!t) return;
    addTemplate(t);
    enqueue(
      videos.map((v) => v.id),
      t.id,
    );
    scrollToId("results");
  };

  const applyTemplate = (templateId: string) => {
    if (videos.length === 0) return;
    enqueue(
      videos.map((v) => v.id),
      templateId,
    );
    scrollToId("results");
  };

  const finishedExports = exports_.filter((e) =>
    jobs.some((j) => j.id === e.jobId && j.status === "done"),
  );

  const downloadAll = async () => {
    const zip = new JSZip();
    for (const e of finishedExports) {
      const b = exportBlobs.get(e.id);
      if (b) zip.file(e.name, b);
    }
    const out = await zip.generateAsync({ type: "blob" });
    downloadBlob(out, `cleaned_videos_${Date.now()}.zip`);
  };

  return (
    <div className="space-y-10">
      {/* Step 1: Upload */}
      <section>
        <StepHeader n={1} title="Upload your video" />
        <UploadZone compact={videos.length > 0} />
        {videos.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {videos.map((v) => (
              <button
                key={v.id}
                onClick={() => setActiveId(v.id)}
                className={`group relative overflow-hidden rounded-lg border text-left transition ${
                  v.id === activeId
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <div className="h-16 w-28 bg-muted">
                  {v.thumbnail && (
                    <img
                      src={v.thumbnail}
                      alt={v.name}
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="px-2 py-1 text-[10px] truncate w-28">
                  {v.name}
                </div>
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeVideo(v.id);
                  }}
                  className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded bg-background/80 opacity-0 group-hover:opacity-100 hover:bg-destructive hover:text-destructive-foreground"
                >
                  <X className="h-3 w-3" />
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Step 2: Mark */}
      {active && (
        <section>
          <StepHeader
            n={2}
            title="Mark the watermark"
            sub="Drag and resize the box over the watermark, then choose how to fill it."
          />
          <div className="overflow-hidden rounded-2xl border border-border bg-[oklch(0.12_0.018_270)]">
            <div
              ref={stageRef}
              className="relative flex h-[420px] items-center justify-center p-4"
            >
              <div
                className="relative shadow-2xl"
                style={{ width: dispW, height: dispH }}
              >
                {fileURL && (
                  <video
                    key={fileURL}
                    src={fileURL}
                    className="h-full w-full"
                    muted
                    loop
                    playsInline
                    autoPlay
                  />
                )}
                <Rnd
                  bounds="parent"
                  size={{ width: box.width, height: box.height }}
                  position={{ x: box.x, y: box.y }}
                  onDragStop={(_e, d) =>
                    setBox((b) => ({ ...b, x: d.x, y: d.y }))
                  }
                  onResizeStop={(_e, _dir, ref, _delta, pos) =>
                    setBox({
                      width: ref.offsetWidth,
                      height: ref.offsetHeight,
                      x: pos.x,
                      y: pos.y,
                    })
                  }
                  className="!border-2 !border-[color:var(--primary)] bg-[color:var(--primary)]/15"
                >
                  <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs font-semibold">
                    <span className="rounded bg-primary px-1.5 py-0.5 text-primary-foreground">
                      Mask
                    </span>
                  </div>
                </Rnd>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-border bg-card px-4 py-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Fill</span>
                <div className="relative">
                  <select
                    value={fillMode}
                    onChange={(e) => setFillMode(e.target.value as FillMode)}
                    className="appearance-none rounded-lg border border-border bg-input pl-3 pr-7 py-1.5 text-xs"
                  >
                    {FILL_MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                </div>
              </div>
              <div className="font-mono text-[11px] text-muted-foreground">
                {active.meta.width}×{active.meta.height} ·{" "}
                {formatDuration(active.meta.duration)}
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <button
                  onClick={removeCurrent}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary"
                >
                  <Wand2 className="h-3.5 w-3.5" /> Remove from this video
                </button>
                <button
                  onClick={removeAll}
                  disabled={videos.length < 2}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[image:var(--gradient-primary)] px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40"
                >
                  <Layers className="h-3.5 w-3.5" /> Apply to all {videos.length}
                </button>
              </div>
            </div>
          </div>

          {templates.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                Saved masks · click to reapply to all videos
              </div>
              <div className="flex flex-wrap gap-2">
                {templates.map((t) => (
                  <div
                    key={t.id}
                    className="group inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs"
                  >
                    <button
                      onClick={() => applyTemplate(t.id)}
                      className="font-medium hover:text-primary"
                      title={`${t.width}×${t.height} @ (${t.x},${t.y}) · ${t.fillMode}`}
                    >
                      {t.name}
                    </button>
                    <button
                      onClick={() => removeTemplate(t.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Step 3: Results */}
      {(jobs.length > 0 || finishedExports.length > 0) && (
        <section id="results">
          <StepHeader
            n={3}
            title="Download cleaned videos"
            action={
              finishedExports.length > 1 && (
                <button
                  onClick={downloadAll}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[image:var(--gradient-primary)] px-3 py-2 text-xs font-semibold text-primary-foreground"
                >
                  <Archive className="h-3.5 w-3.5" /> ZIP all (
                  {finishedExports.length})
                </button>
              )
            }
          />
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {jobs.map((j) => {
              const v = videos.find((x) => x.id === j.videoId);
              const ex = exports_.find((e) => e.jobId === j.id);
              const blob = ex ? exportBlobs.get(ex.id) : undefined;
              return (
                <div key={j.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {v?.name ?? "—"}
                      </div>
                      <div className="mt-1.5">
                        <Progress value={j.progress} />
                      </div>
                      {j.error && (
                        <div className="mt-1 text-xs text-destructive">
                          {j.error}
                        </div>
                      )}
                    </div>
                    <Pill tone={j.status}>{j.status}</Pill>
                    <div className="w-12 text-right font-mono text-xs text-muted-foreground">
                      {Math.round(j.progress * 100)}%
                    </div>
                    <div className="flex gap-1">
                      {j.status === "done" && blob && ex && (
                        <button
                          onClick={() => downloadBlob(blob, ex.name)}
                          className="inline-flex items-center gap-1 rounded-lg bg-[image:var(--gradient-primary)] px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                        >
                          <Download className="h-3.5 w-3.5" /> Download
                        </button>
                      )}
                      {j.status === "error" && (
                        <button
                          onClick={() => retryJob(j.id)}
                          className="rounded p-1.5 text-muted-foreground hover:bg-secondary"
                          title="Retry"
                        >
                          <RefreshCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {(j.status === "queued" ||
                        j.status === "processing") && (
                        <button
                          onClick={() => cancelJob(j.id)}
                          className="rounded p-1.5 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                          title="Cancel"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {videos.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          100% local · FFmpeg WebAssembly · No uploads, no AI APIs.{" "}
          {finishedExports.length > 0 &&
            `· ${formatBytes(finishedExports.reduce((a, e) => a + e.size, 0))} ready`}
        </div>
      )}
    </div>
  );
}

function StepHeader({
  n,
  title,
  sub,
  action,
}: {
  n: number;
  title: string;
  sub?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
            {n}
          </span>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        </div>
        {sub && (
          <p className="mt-1 ml-8 text-xs text-muted-foreground">{sub}</p>
        )}
      </div>
      {action}
    </div>
  );
}

function scrollToId(id: string) {
  setTimeout(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }, 100);
}
