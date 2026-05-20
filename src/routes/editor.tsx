import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import {
  Play,
  Pause,
  Save,
  Trash2,
  Copy,
  Wand2,
  ListPlus,
  Pencil,
  Check,
} from "lucide-react";
import { useAppStore, type Template } from "@/store/app-store";
import type { FillMode } from "@/lib/ffmpeg-engine";
import { PageHeader, formatDuration } from "@/components/ui-bits";

export const Route = createFileRoute("/editor")({
  component: EditorPage,
});

const FILL_MODES: { value: FillMode; label: string; hint: string }[] = [
  { value: "horizontal", label: "Horizontal", hint: "Stretch from left/right" },
  { value: "vertical", label: "Vertical", hint: "Stretch from top/bottom" },
  { value: "auto", label: "Auto", hint: "Pick best direction" },
  { value: "edge", label: "Edge expand", hint: "Border pixels" },
  { value: "clone", label: "Clone", hint: "Duplicate adjacent block" },
];

function EditorPage() {
  const videos = useAppStore((s) => s.videos);
  const videoFiles = useAppStore((s) => s.videoFiles);
  const templates = useAppStore((s) => s.templates);
  const addTemplate = useAppStore((s) => s.addTemplate);
  const updateTemplate = useAppStore((s) => s.updateTemplate);
  const removeTemplate = useAppStore((s) => s.removeTemplate);
  const duplicateTemplate = useAppStore((s) => s.duplicateTemplate);
  const enqueue = useAppStore((s) => s.enqueue);

  const [activeVideoId, setActiveVideoId] = useState<string | null>(
    videos[0]?.id ?? null,
  );
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [box, setBox] = useState({ x: 40, y: 40, width: 200, height: 80 });
  const [fillMode, setFillMode] = useState<FillMode>("horizontal");
  const [tplName, setTplName] = useState("New template");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

  const activeVideo = videos.find((v) => v.id === activeVideoId) ?? null;
  const fileURL = useMemo(() => {
    if (!activeVideo) return null;
    const f = videoFiles.get(activeVideo.id);
    return f ? URL.createObjectURL(f) : null;
  }, [activeVideo, videoFiles]);

  useEffect(() => () => {
    if (fileURL) URL.revokeObjectURL(fileURL);
  }, [fileURL]);

  // Track stage size for coordinate scaling
  useEffect(() => {
    const update = () => {
      if (stageRef.current) {
        setStageSize({
          w: stageRef.current.clientWidth,
          h: stageRef.current.clientHeight,
        });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    if (stageRef.current) ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [activeVideo]);

  const scale = activeVideo
    ? Math.min(
        stageSize.w / activeVideo.meta.width,
        stageSize.h / activeVideo.meta.height,
      ) || 1
    : 1;

  const displayW = activeVideo ? activeVideo.meta.width * scale : 0;
  const displayH = activeVideo ? activeVideo.meta.height * scale : 0;

  // When template is selected, hydrate box (scaled to display)
  useEffect(() => {
    if (!activeTemplateId || !activeVideo) return;
    const t = templates.find((x) => x.id === activeTemplateId);
    if (!t) return;
    const ref = {
      w: t.refWidth ?? activeVideo.meta.width,
      h: t.refHeight ?? activeVideo.meta.height,
    };
    const sx = displayW / ref.w;
    const sy = displayH / ref.h;
    setBox({
      x: t.x * sx,
      y: t.y * sy,
      width: t.width * sx,
      height: t.height * sy,
    });
    setFillMode(t.fillMode);
    setTplName(t.name);
  }, [activeTemplateId, activeVideo, displayW, displayH, templates]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  // Convert display box → video pixel region
  const toRegion = () => {
    if (!activeVideo) return null;
    const sx = activeVideo.meta.width / Math.max(1, displayW);
    const sy = activeVideo.meta.height / Math.max(1, displayH);
    return {
      x: Math.round(box.x * sx),
      y: Math.round(box.y * sy),
      width: Math.round(box.width * sx),
      height: Math.round(box.height * sy),
    };
  };

  const saveAsNew = () => {
    const r = toRegion();
    if (!r || !activeVideo) return;
    const t: Template = {
      id: crypto.randomUUID(),
      name: tplName || "Template",
      ...r,
      fillMode,
      createdAt: Date.now(),
      refWidth: activeVideo.meta.width,
      refHeight: activeVideo.meta.height,
    };
    addTemplate(t);
    setActiveTemplateId(t.id);
  };

  const saveUpdate = () => {
    if (!activeTemplateId || !activeVideo) return;
    const r = toRegion();
    if (!r) return;
    updateTemplate(activeTemplateId, {
      ...r,
      fillMode,
      name: tplName,
      refWidth: activeVideo.meta.width,
      refHeight: activeVideo.meta.height,
    });
  };

  const applyToAll = () => {
    if (!activeTemplateId) return;
    enqueue(
      videos.map((v) => v.id),
      activeTemplateId,
    );
  };

  const applyToCurrent = () => {
    if (!activeTemplateId || !activeVideoId) return;
    enqueue([activeVideoId], activeTemplateId);
  };

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="Video Editor"
        subtitle="Drag the box over the watermark, pick a fill mode, save as template."
      />
      <div className="grid flex-1 min-h-0 grid-cols-[1fr_320px]">
        {/* Stage */}
        <div className="flex min-h-0 flex-col bg-[oklch(0.12_0.018_270)]">
          {!activeVideo ? (
            <div className="grid flex-1 place-items-center text-center text-muted-foreground">
              <div>
                <div className="text-lg">No video loaded</div>
                <div className="text-sm">
                  Upload videos from the Dashboard to begin.
                </div>
              </div>
            </div>
          ) : (
            <>
              <div
                ref={stageRef}
                className="relative flex flex-1 items-center justify-center overflow-hidden p-6"
              >
                <div
                  className="relative shadow-2xl"
                  style={{ width: displayW, height: displayH }}
                >
                  {fileURL && (
                    <video
                      key={fileURL}
                      ref={videoRef}
                      src={fileURL}
                      className="h-full w-full"
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                      controls={false}
                      muted
                      loop
                      playsInline
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
                    <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs font-semibold text-primary-foreground/90">
                      <span className="rounded bg-primary px-1.5 py-0.5">
                        Watermark
                      </span>
                    </div>
                  </Rnd>
                </div>
              </div>
              <div className="flex items-center gap-3 border-t border-border bg-card px-6 py-3">
                <button
                  onClick={togglePlay}
                  className="grid h-10 w-10 place-items-center rounded-full bg-[image:var(--gradient-primary)] text-primary-foreground"
                >
                  {playing ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </button>
                <div className="font-mono text-xs text-muted-foreground">
                  {activeVideo.meta.width}×{activeVideo.meta.height} ·{" "}
                  {formatDuration(activeVideo.meta.duration)}
                </div>
                <div className="ml-auto font-mono text-xs text-muted-foreground">
                  {(() => {
                    const r = toRegion();
                    return r
                      ? `x:${r.x} y:${r.y} w:${r.width} h:${r.height}`
                      : "";
                  })()}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Sidebar */}
        <aside className="flex min-h-0 flex-col border-l border-border bg-card">
          <div className="border-b border-border p-4">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Source video
            </label>
            <select
              value={activeVideoId ?? ""}
              onChange={(e) => setActiveVideoId(e.target.value || null)}
              className="mt-1 w-full rounded-lg border border-border bg-input px-2 py-2 text-sm"
            >
              {videos.length === 0 && <option value="">None</option>}
              {videos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>

          <div className="border-b border-border p-4 space-y-3">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Template name
            </label>
            <input
              value={tplName}
              onChange={(e) => setTplName(e.target.value)}
              className="w-full rounded-lg border border-border bg-input px-2 py-2 text-sm"
            />
            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Fill mode
            </label>
            <div className="grid grid-cols-2 gap-2">
              {FILL_MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setFillMode(m.value)}
                  className={`rounded-lg border px-2 py-2 text-left text-xs transition ${
                    fillMode === m.value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                  title={m.hint}
                >
                  <div className="font-medium">{m.label}</div>
                  <div className="text-[10px] opacity-70">{m.hint}</div>
                </button>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={saveAsNew}
                disabled={!activeVideo}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[image:var(--gradient-primary)] px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" /> Save new
              </button>
              <button
                onClick={saveUpdate}
                disabled={!activeTemplateId}
                className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50"
              >
                Update
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={applyToCurrent}
                disabled={!activeTemplateId || !activeVideoId}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50"
              >
                <Wand2 className="h-3.5 w-3.5" /> Process this
              </button>
              <button
                onClick={applyToAll}
                disabled={!activeTemplateId || videos.length === 0}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-50"
              >
                <ListPlus className="h-3.5 w-3.5" /> Batch all
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Saved templates ({templates.length})
            </div>
            {templates.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                No templates yet.
              </div>
            )}
            <div className="space-y-2">
              {templates.map((t) => (
                <div
                  key={t.id}
                  onClick={() => setActiveTemplateId(t.id)}
                  className={`cursor-pointer rounded-lg border p-3 transition ${
                    activeTemplateId === t.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    {renameId === t.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            updateTemplate(t.id, {
                              name: renameValue.trim() || t.name,
                            });
                            setRenameId(null);
                          } else if (e.key === "Escape") {
                            setRenameId(null);
                          }
                        }}
                        className="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 text-sm"
                      />
                    ) : (
                      <div className="min-w-0 truncate text-sm font-medium">
                        {t.name}
                      </div>
                    )}
                    <div className="flex shrink-0 gap-1">
                      {renameId === t.id ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            updateTemplate(t.id, {
                              name: renameValue.trim() || t.name,
                            });
                            setRenameId(null);
                          }}
                          className="rounded p-1 text-muted-foreground hover:bg-secondary"
                          title="Save name"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenameId(t.id);
                            setRenameValue(t.name);
                          }}
                          className="rounded p-1 text-muted-foreground hover:bg-secondary"
                          title="Rename"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicateTemplate(t.id);
                        }}
                        className="rounded p-1 text-muted-foreground hover:bg-secondary"
                        title="Duplicate"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTemplate(t.id);
                          if (activeTemplateId === t.id)
                            setActiveTemplateId(null);
                        }}
                        className="rounded p-1 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {t.width}×{t.height} @ ({t.x},{t.y}) · {t.fillMode}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}