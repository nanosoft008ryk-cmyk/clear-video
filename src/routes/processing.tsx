import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  X,
  RefreshCcw,
  Film,
  ChevronDown,
  ChevronRight,
  Archive,
  Sliders,
} from "lucide-react";
import JSZip from "jszip";
import { useAppStore } from "@/store/app-store";
import { PageHeader, Pill, Progress, StatCard } from "@/components/ui-bits";

export const Route = createFileRoute("/processing")({
  component: ProcessingPage,
});

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

function ProcessingPage() {
  const jobs = useAppStore((s) => s.jobs);
  const videos = useAppStore((s) => s.videos);
  const templates = useAppStore((s) => s.templates);
  const logs = useAppStore((s) => s.logs);
  const jobLogs = useAppStore((s) => s.jobLogs);
  const cancelJob = useAppStore((s) => s.cancelJob);
  const retryJob = useAppStore((s) => s.retryJob);
  const clearJobs = useAppStore((s) => s.clearJobs);
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const exports_ = useAppStore((s) => s.exports);
  const blobs = useAppStore((s) => s.exportBlobs);
  const concurrency = settings.concurrency;

  const [logsOpen, setLogsOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openJob, setOpenJob] = useState<string | null>(null);

  const stats = useMemo(() => {
    return {
      queued: jobs.filter((j) => j.status === "queued").length,
      processing: jobs.filter((j) => j.status === "processing").length,
      done: jobs.filter((j) => j.status === "done").length,
      error: jobs.filter((j) => j.status === "error").length,
    };
  }, [jobs]);

  const eta = useMemo(() => {
    const active = jobs.filter((j) => j.status === "processing");
    const remaining = jobs.filter((j) => j.status === "queued").length;
    if (active.length === 0) return remaining > 0 ? "—" : "0s";
    const avg =
      active.reduce((acc, j) => {
        const elapsed = (Date.now() - (j.startedAt ?? Date.now())) / 1000;
        const total = j.progress > 0.02 ? elapsed / j.progress : 60;
        return acc + (total - elapsed);
      }, 0) / active.length;
    const totalRem = avg + (remaining * avg) / Math.max(1, concurrency);
    return `${Math.max(1, Math.round(totalRem))}s`;
  }, [jobs, concurrency]);

  const finishedExports = useMemo(
    () =>
      exports_.filter((e) =>
        jobs.some((j) => j.id === e.jobId && j.status === "done"),
      ),
    [exports_, jobs],
  );

  const downloadAllZip = async () => {
    const zip = new JSZip();
    for (const e of finishedExports) {
      const b = blobs.get(e.id);
      if (b) zip.file(e.name, b);
    }
    const out = await zip.generateAsync({ type: "blob" });
    downloadBlob(out, `queue_exports_${Date.now()}.zip`);
  };

  return (
    <div>
      <PageHeader
        title="Processing Center"
        subtitle="Live queue, FFmpeg worker activity and logs."
        actions={
          <>
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs hover:bg-secondary"
            >
              <Sliders className="h-3.5 w-3.5" /> Advanced
            </button>
            <button
              onClick={downloadAllZip}
              disabled={finishedExports.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[image:var(--gradient-primary)] px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40"
            >
              <Archive className="h-3.5 w-3.5" /> ZIP all ({finishedExports.length})
            </button>
            <button
              onClick={clearJobs}
              className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-secondary"
            >
              Clear finished
            </button>
          </>
        }
      />
      <div className="space-y-6 px-8 py-6">
        {settingsOpen && (
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 text-sm font-semibold">Advanced processing</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <InlineField
                label="Concurrent workers"
                hint={`${settings.concurrency} parallel`}
              >
                <input
                  type="range"
                  min={1}
                  max={4}
                  value={settings.concurrency}
                  onChange={(e) =>
                    setSettings({ concurrency: Number(e.target.value) })
                  }
                  className="w-full"
                />
              </InlineField>
              <InlineField label="Encoder preset" hint="Faster = larger files">
                <select
                  value={settings.preset}
                  onChange={(e) =>
                    setSettings({
                      preset: e.target.value as typeof settings.preset,
                    })
                  }
                  className="w-full rounded-lg border border-border bg-input px-2 py-2 text-sm"
                >
                  <option value="ultrafast">ultrafast</option>
                  <option value="veryfast">veryfast</option>
                  <option value="fast">fast</option>
                  <option value="medium">medium</option>
                </select>
              </InlineField>
              <InlineField
                label="Quality (CRF)"
                hint={`${settings.crf} · lower = better`}
              >
                <input
                  type="range"
                  min={14}
                  max={32}
                  value={settings.crf}
                  onChange={(e) => setSettings({ crf: Number(e.target.value) })}
                  className="w-full"
                />
              </InlineField>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard label="Queued" value={stats.queued} />
          <StatCard label="Processing" value={stats.processing} hint={`${concurrency} workers`} />
          <StatCard label="Completed" value={stats.done} />
          <StatCard label="Failed" value={stats.error} />
          <StatCard label="ETA" value={eta} />
        </div>

        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">
            Jobs
          </div>
          {jobs.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              No jobs yet. Build a template and apply it from the Editor.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {jobs.map((j) => {
                const v = videos.find((x) => x.id === j.videoId);
                const t = templates.find((x) => x.id === j.templateId);
                const isOpen = openJob === j.id;
                const perJob = jobLogs[j.id] ?? [];
                return (
                  <div key={j.id} className="px-4 py-3">
                  <div className="grid grid-cols-[1fr_120px_120px_80px] gap-4 items-center">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 truncate text-sm">
                        <Film className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium">{v?.name ?? "—"}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Template: {t?.name ?? "—"}
                      </div>
                      <div className="mt-2">
                        <Progress value={j.progress} />
                      </div>
                      {j.error && (
                        <div className="mt-1 text-xs text-destructive">{j.error}</div>
                      )}
                    </div>
                    <Pill tone={j.status}>{j.status}</Pill>
                    <div className="text-right text-xs font-mono text-muted-foreground">
                      {Math.round(j.progress * 100)}%
                    </div>
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setOpenJob(isOpen ? null : j.id)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-secondary"
                        title="Toggle logs"
                      >
                        {isOpen ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                      {j.status === "error" && (
                        <button
                          onClick={() => retryJob(j.id)}
                          className="rounded p-1.5 text-muted-foreground hover:bg-secondary"
                          title="Retry"
                        >
                          <RefreshCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {(j.status === "queued" || j.status === "processing") && (
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
                  {isOpen && (
                    <div className="mt-3 max-h-48 overflow-y-auto rounded-lg bg-[oklch(0.12_0.018_270)] p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {perJob.length === 0 ? (
                        <div className="opacity-60">— no logs yet for this job —</div>
                      ) : (
                        perJob.slice(-100).map((l, i) => <div key={i}>{l}</div>)
                      )}
                    </div>
                  )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card">
          <button
            onClick={() => setLogsOpen((v) => !v)}
            className="flex w-full items-center justify-between border-b border-border px-4 py-3 text-sm font-semibold"
          >
            <span className="inline-flex items-center gap-2">
              {logsOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              FFmpeg logs
              <span className="text-xs font-normal text-muted-foreground">
                ({logs.length})
              </span>
            </span>
          </button>
          {logsOpen && (
            <div className="max-h-72 overflow-y-auto bg-[oklch(0.12_0.018_270)] p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {logs.length === 0 ? (
                <div className="opacity-60">— no activity —</div>
              ) : (
                logs.slice(-200).map((l, i) => <div key={i}>{l}</div>)
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InlineField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint && (
        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
          {hint}
        </div>
      )}
    </div>
  );
}