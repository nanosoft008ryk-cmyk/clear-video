import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { X, RefreshCcw, Film } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { PageHeader, Pill, Progress, StatCard } from "@/components/ui-bits";

export const Route = createFileRoute("/processing")({
  component: ProcessingPage,
});

function ProcessingPage() {
  const jobs = useAppStore((s) => s.jobs);
  const videos = useAppStore((s) => s.videos);
  const templates = useAppStore((s) => s.templates);
  const logs = useAppStore((s) => s.logs);
  const cancelJob = useAppStore((s) => s.cancelJob);
  const retryJob = useAppStore((s) => s.retryJob);
  const clearJobs = useAppStore((s) => s.clearJobs);
  const concurrency = useAppStore((s) => s.settings.concurrency);

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

  return (
    <div>
      <PageHeader
        title="Processing Center"
        subtitle="Live queue, FFmpeg worker activity and logs."
        actions={
          <button
            onClick={clearJobs}
            className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-secondary"
          >
            Clear finished
          </button>
        }
      />
      <div className="space-y-6 px-8 py-6">
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
                return (
                  <div key={j.id} className="grid grid-cols-[1fr_120px_120px_80px] gap-4 px-4 py-3 items-center">
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
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">
            FFmpeg logs
          </div>
          <div className="max-h-72 overflow-y-auto bg-[oklch(0.12_0.018_270)] p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {logs.length === 0 ? (
              <div className="opacity-60">— no activity —</div>
            ) : (
              logs.slice(-200).map((l, i) => <div key={i}>{l}</div>)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}