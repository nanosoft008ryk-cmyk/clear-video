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
  MoveHorizontal,
  MoveVertical,
  Wand,
  SquareDashed,
  Copy,
  Save,
  Bookmark,
} from "lucide-react";
import JSZip from "jszip";
import { useAppStore, type Template } from "@/store/app-store";
import type { FillMode } from "@/lib/ffmpeg-engine";
import { UploadZone } from "@/components/UploadZone";
import { Pill, Progress, formatDuration } from "@/components/ui-bits";

export const Route = createFileRoute("/")({
  component: HomePage,
});

const FILL_MODES: {
  value: FillMode;
  label: string;
  hint: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "auto",
    label: "Auto",
    hint: "Pick the best direction automatically",
    icon: <Wand className="h-3.5 w-3.5" />,
  },
  {
    value: "horizontal",
    label: "Horizontal",
    hint: "Stretch pixels from the sides",
    icon: <MoveHorizontal className="h-3.5 w-3.5" />,
  },
  {
    value: "vertical",
    label: "Vertical",
    hint: "Stretch pixels from top/bottom",
    icon: <MoveVertical className="h-3.5 w-3.5" />,
  },
  {
    value: "edge",
    label: "Edge",
    hint: "Expand the nearest edge strip",
    icon: <SquareDashed className="h-3.5 w-3.5" />,
  },
  {
    value: "clone",
    label: "Clone",
    hint: "Copy an adjacent block of pixels",
    icon: <Copy className="h-3.5 w-3.5" />,
  },
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
  const updateTemplate = useAppStore((s) => s.updateTemplate);
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

  const saveMask = () => {
    if (!active) return;
    const suggested = `Mask ${templates.length + 1}`;
    const name = (typeof window !== "undefined"
      ? window.prompt("Name this mask preset", suggested)
      : suggested) ?? "";
    const trimmed = name.trim();
    if (!trimmed) return;
    const t = buildTemplate(trimmed);
    if (!t) return;
    addTemplate(t);
  };

  const loadTemplate = (templateId: string) => {
    const t = templates.find((x) => x.id === templateId);
    if (!t || !active) return;
    setFillMode(t.fillMode);
    if (t.refWidth && t.refHeight) {
      const sx = dispW / t.refWidth;
      const sy = dispH / t.refHeight;
      setBox({
        x: Math.round(t.x * sx),
        y: Math.round(t.y * sy),
        width: Math.round(t.width * sx),
        height: Math.round(t.height * sy),
      });
    } else {
      const sx = dispW / active.meta.width;
      const sy = dispH / active.meta.height;
      setBox({
        x: Math.round(t.x * sx),
        y: Math.round(t.y * sy),
        width: Math.round(t.width * sx),
        height: Math.round(t.height * sy),
      });
    }
  };

  const renameTemplate = (templateId: string) => {
    const t = templates.find((x) => x.id === templateId);
    if (!t) return;
    const name = typeof window !== "undefined"
      ? window.prompt("Rename mask preset", t.name)
      : null;
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    updateTemplate(templateId, { name: trimmed });
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

  const allJobsSettled =
    jobs.length > 0 &&
    jobs.every((j) => j.status === "done" || j.status === "cancelled");
  const allJobsDone =
    jobs.length > 0 && jobs.every((j) => j.status === "done");

  const [zipState, setZipState] = useState<{
    busy: boolean;
    percent: number;
    file: string;
  }>({ busy: false, percent: 0, file: "" });

  const downloadAll = async () => {
    if (zipState.busy) return;
    setZipState({ busy: true, percent: 0, file: "" });
    try {
      const zip = new JSZip();
      // Track entry-name collisions to avoid silent overwrites.
      const used = new Set<string>();
      for (const e of finishedExports) {
        const b = exportBlobs.get(e.id);
        if (!b) continue;
        const job = jobs.find((j) => j.id === e.jobId);
        const vid = job ? videos.find((v) => v.id === job.videoId) : undefined;
        const sourceName = vid?.name ?? e.name;
        // Always emit MP4 (the engine re-encodes to H.264/AAC).
        const base = sourceName.replace(/\.[^.]+$/, "");
        const folder = vid?.relativePath
          ? vid.relativePath.split("/").slice(0, -1).join("/")
          : "";
        let entry = folder ? `${folder}/${base}.mp4` : `${base}.mp4`;
        let n = 1;
        while (used.has(entry)) {
          entry = folder
            ? `${folder}/${base} (${++n}).mp4`
            : `${base} (${++n}).mp4`;
        }
        used.add(entry);
        zip.file(entry, b);
      }
      const out = await zip.generateAsync(
        { type: "blob", compression: "STORE" },
        (m) =>
          setZipState({
            busy: true,
            percent: Math.round(m.percent),
            file: m.currentFile ?? "",
          }),
      );
      downloadBlob(out, `cleaned_videos_${Date.now()}.zip`);
      setZipState({ busy: false, percent: 100, file: "" });
    } catch (err) {
      console.error(err);
      setZipState({ busy: false, percent: 0, file: "" });
    }
  };

  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const quality: "basic" | "best" =
    settings.crf <= 19 && settings.preset !== "ultrafast" ? "best" : "basic";
  const setQuality = (q: "basic" | "best") => {
    if (q === "basic") setSettings({ preset: "veryfast", crf: 23 });
    else setSettings({ preset: "medium", crf: 18 });
  };

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-6 pt-16 pb-10 text-center">
          <h1 className="mx-auto max-w-4xl text-5xl md:text-6xl font-bold tracking-tight leading-[1.05]">
            <span className="gradient-text">Free</span>{" "}
            <span className="text-foreground">Video Watermark Remover Online</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Remove watermarks and logos from full videos online for free. No sign-up,
            no blur, custom masks, 100% private processing in your browser, and HD or
            4K export for TikTok, YouTube, Reels, UGC, and ads.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
            <FeatureBadge icon={<Zap className="h-3.5 w-3.5" />} label="No Sign-Up" />
            <FeatureBadge icon={<Film className="h-3.5 w-3.5" />} label="Long Video Support" />
            <FeatureBadge icon={<Gauge className="h-3.5 w-3.5" />} label="Fast Processing" />
            <FeatureBadge icon={<Lock className="h-3.5 w-3.5" />} label="100% Private" />
          </div>
        </div>
      </section>

      {/* Tool */}
      <section id="tool" className="mx-auto max-w-5xl px-6 pb-16">
        <p className="mb-4 text-center text-[12px] text-muted-foreground">
          We recommend a desktop browser for the smoothest experience.
        </p>

        {/* Quality toggle */}
        <div className="mb-6 flex justify-center">
          <div className="inline-flex items-center rounded-full border border-border bg-card p-1">
            <button
              onClick={() => setQuality("basic")}
              className={`rounded-full px-5 py-1.5 text-xs font-semibold transition ${
                quality === "basic"
                  ? "bg-[image:var(--gradient-primary)] text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Basic Quality
            </button>
            <button
              onClick={() => setQuality("best")}
              className={`inline-flex items-center gap-1.5 rounded-full px-5 py-1.5 text-xs font-semibold transition ${
                quality === "best"
                  ? "bg-[image:var(--gradient-primary)] text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Best Quality <Sparkles className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Step 1 — Upload */}
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

        {/* Step 2: Mark */}
        {active && (
        <div className="mt-10">
          <StepHeader
            n={2}
            title="Mark the watermark"
            sub="Drag and resize the box over the watermark, then choose how to fill it."
          />
          <div className="overflow-hidden rounded-2xl border border-border bg-[oklch(0.06_0.005_260)]">
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
            <div className="space-y-3 border-t border-border bg-card px-4 py-3">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Fill mode
                  </span>
                  <span
                    className="text-[11px] text-muted-foreground"
                    title={FILL_MODES.find((m) => m.value === fillMode)?.hint}
                  >
                    {FILL_MODES.find((m) => m.value === fillMode)?.hint}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 sm:grid-cols-5">
                  {FILL_MODES.map((m) => {
                    const selected = m.value === fillMode;
                    return (
                      <button
                        key={m.value}
                        onClick={() => setFillMode(m.value)}
                        title={m.hint}
                        className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition ${
                          selected
                            ? "border-primary bg-primary/15 text-foreground"
                            : "border-border bg-input text-muted-foreground hover:text-foreground hover:border-primary/40"
                        }`}
                      >
                        {m.icon}
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="font-mono text-[11px] text-muted-foreground">
                  {active.meta.width}×{active.meta.height} ·{" "}
                  {formatDuration(active.meta.duration)}
                </div>
                <div className="ml-auto flex flex-wrap gap-2">
                <button
                  onClick={saveMask}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary"
                  title="Save the current mask as a reusable preset"
                >
                  <Save className="h-3.5 w-3.5" /> Save mask
                </button>
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
          </div>

          {templates.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                Saved mask presets
              </div>
              <div className="flex flex-wrap gap-2">
                {templates.map((t) => (
                  <div
                    key={t.id}
                    className="group inline-flex items-center gap-1 rounded-full border border-border bg-card pl-3 pr-1 py-1 text-xs"
                  >
                    <Bookmark className="h-3 w-3 text-primary" />
                    <button
                      onClick={() => loadTemplate(t.id)}
                      onDoubleClick={() => renameTemplate(t.id)}
                      className="font-medium hover:text-primary"
                      title={`Load into editor · ${t.width}×${t.height} @ (${t.x},${t.y}) · ${t.fillMode} · double-click to rename`}
                    >
                      {t.name}
                    </button>
                    <span className="ml-1 hidden text-[10px] text-muted-foreground sm:inline">
                      {t.fillMode}
                    </span>
                    <button
                      onClick={() => applyTemplate(t.id)}
                      className="ml-1 inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/25"
                      title={`Apply to all ${videos.length} video(s)`}
                      disabled={videos.length === 0}
                    >
                      <Layers className="h-3 w-3" /> Apply
                    </button>
                    <button
                      onClick={() => removeTemplate(t.id)}
                      className="ml-0.5 grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                      title="Delete preset"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        )}

        {/* Step 3: Results */}
        {(jobs.length > 0 || finishedExports.length > 0) && (
        <div id="results" className="mt-10">
          <StepHeader
            n={3}
            title="Download cleaned videos"
            action={
              finishedExports.length > 1 && (
                <button
                  onClick={downloadAll}
                  disabled={zipState.busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[image:var(--gradient-primary)] px-3 py-2 text-xs font-semibold text-primary-foreground"
                >
                  <Archive className="h-3.5 w-3.5" />
                  {zipState.busy
                    ? `Packaging… ${zipState.percent}%`
                    : `ZIP all (${finishedExports.length})`}
                </button>
              )
            }
          />
          {allJobsDone && finishedExports.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[color:var(--success)]/40 bg-[color:var(--success)]/10 px-4 py-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-[color:var(--success)]/20 text-[color:var(--success)]">
                  ✓
                </span>
                <div>
                  <div className="font-semibold text-foreground">
                    All {finishedExports.length} video
                    {finishedExports.length > 1 ? "s" : ""} ready
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Processing complete — grab the entire batch in one click.
                  </div>
                </div>
              </div>
              <div className="flex min-w-[220px] flex-col items-end gap-1.5">
                <button
                  onClick={downloadAll}
                  disabled={zipState.busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[image:var(--gradient-primary)] px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg disabled:opacity-60"
                >
                  <Archive className="h-4 w-4" />
                  {zipState.busy
                    ? `Packaging… ${zipState.percent}%`
                    : "Download all (ZIP)"}
                </button>
                {zipState.busy && (
                  <>
                    <div className="w-full">
                      <Progress value={zipState.percent / 100} />
                    </div>
                    {zipState.file && (
                      <div className="max-w-[260px] truncate font-mono text-[10px] text-muted-foreground">
                        {zipState.file}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          {allJobsSettled && !allJobsDone && finishedExports.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
              <div className="text-xs text-muted-foreground">
                {finishedExports.length} of {jobs.length} finished — some jobs
                failed or were cancelled.
              </div>
              <div className="flex min-w-[200px] flex-col items-end gap-1.5">
                <button
                  onClick={downloadAll}
                  disabled={zipState.busy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-secondary disabled:opacity-60"
                >
                  <Archive className="h-3.5 w-3.5" />
                  {zipState.busy
                    ? `Packaging… ${zipState.percent}%`
                    : `Download finished (${finishedExports.length})`}
                </button>
                {zipState.busy && (
                  <div className="w-full">
                    <Progress value={zipState.percent / 100} />
                  </div>
                )}
              </div>
            </div>
          )}
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
        </div>
        )}

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          100% local · powered by FFmpeg WebAssembly · Your videos never leave your device.
        </p>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-border/60 bg-card/30">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="text-center">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              How to Remove Video Watermarks Online
            </h2>
            <p className="mt-3 text-muted-foreground">
              Three simple steps to get watermark-free videos in seconds
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <HowCard
              n={1}
              icon={<UploadIcon className="h-5 w-5" />}
              title="Upload Your Video"
              body="Upload any video from your device by clicking the upload button, dragging and dropping, or browsing. All major video formats are accepted."
            />
            <HowCard
              n={2}
              icon={<MousePointerClick className="h-5 w-5" />}
              title="Mark the Watermark"
              body="Drag a mask over the watermark and pick a fill mode. Save the mask as a preset to reuse it on every future upload."
            />
            <HowCard
              n={3}
              icon={<DownloadCloud className="h-5 w-5" />}
              title="Download Clean Video"
              body="Export in HD or 4K — it only takes a few seconds. Download single files or grab the entire batch as a ZIP. No watermark, no logo."
            />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="examples" className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Remove Watermarks from Any Video
          </h2>
          <p className="mt-3 text-muted-foreground">
            For logos, text overlays, TikTok marks, YouTube Shorts, Reels, AI videos, and more
          </p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Feature icon={<Gauge />} title="Fast Processing" body="WebAssembly FFmpeg pipeline runs entirely in your browser — no upload wait." />
          <Feature icon={<ShieldCheck />} title="No Quality Loss" body="Smart fill modes preserve the surrounding pixels, edges and motion." />
          <Feature icon={<Lock />} title="Private by Design" body="Your videos never leave your device. No accounts, no uploads, no tracking." />
          <Feature icon={<Layers />} title="Batch Mode" body="Apply one mask to dozens of videos at once. Download the whole batch as ZIP." />
          <Feature icon={<Cpu />} title="Offline Ready" body="The engine caches itself on first run. Use it on a plane, no internet needed." />
          <Feature icon={<Sparkles />} title="HD &amp; 4K Export" body="Output keeps your source resolution up to 4K. Pick Basic or Best quality." />
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-border/60 bg-card/30">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <h2 className="text-center text-3xl md:text-4xl font-bold tracking-tight">
            Frequently Asked Questions
          </h2>
          <div className="mt-10 space-y-3">
            <Faq q="Is it really free?">
              Yes. No sign-up, no credit card, no watermark on the output. The tool runs entirely in your browser.
            </Faq>
            <Faq q="Are my videos uploaded anywhere?">
              No. Processing happens locally with FFmpeg WebAssembly — your files never leave your device.
            </Faq>
            <Faq q="What formats are supported?">
              MP4, MOV and WEBM up to 500MB / 10 minutes. Output is always MP4 (H.264 + AAC) for maximum compatibility.
            </Faq>
            <Faq q="Does it work on mobile?">
              It works on modern mobile browsers, but processing is significantly faster on desktop. We recommend a laptop or desktop for long videos.
            </Faq>
            <Faq q="Will the watermark area look blurry?">
              No blur. The fill modes stretch or clone adjacent pixels across the mask, which usually leaves a clean, natural-looking patch.
            </Faq>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/60 py-8 text-center text-[12px] text-muted-foreground">
        © {new Date().getFullYear()} ClearVideo — Free Video Watermark Remover. Built with FFmpeg.
      </footer>
    </div>
  );
}

function FeatureBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[color:var(--success)]">{icon}</span>
      {label}
    </span>
  );
}

function HowCard({ n, icon, title, body }: { n: number; icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="relative rounded-2xl border border-border bg-card p-6">
      <div className="absolute -top-3 left-6 rounded-full bg-[image:var(--gradient-primary)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
        Step {n}
      </div>
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
        {icon}
      </div>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary [&>svg]:h-4 [&>svg]:w-4">
        {icon}
      </div>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left text-sm font-medium"
      >
        {q}
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">
          {children}
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
