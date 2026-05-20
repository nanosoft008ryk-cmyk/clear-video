import { createFileRoute, Link } from "@tanstack/react-router";
import { Film, Layers, CheckCircle2, Activity, Trash2 } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { UploadZone } from "@/components/UploadZone";
import {
  PageHeader,
  StatCard,
  formatBytes,
  formatDuration,
} from "@/components/ui-bits";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

function Dashboard() {
  const videos = useAppStore((s) => s.videos);
  const templates = useAppStore((s) => s.templates);
  const jobs = useAppStore((s) => s.jobs);
  const exports_ = useAppStore((s) => s.exports);
  const removeVideo = useAppStore((s) => s.removeVideo);
  const clearVideos = useAppStore((s) => s.clearVideos);

  const activeJobs = jobs.filter(
    (j) => j.status === "processing" || j.status === "queued",
  ).length;
  const completed = jobs.filter((j) => j.status === "done").length;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Drop videos, build a template, then process the batch."
        actions={
          videos.length > 0 ? (
            <button
              onClick={clearVideos}
              className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-secondary"
            >
              Clear queue
            </button>
          ) : null
        }
      />
      <div className="px-8 py-6 space-y-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Loaded videos"
            value={videos.length}
            icon={<Film className="h-4 w-4" />}
          />
          <StatCard
            label="Templates"
            value={templates.length}
            icon={<Layers className="h-4 w-4" />}
          />
          <StatCard
            label="Active jobs"
            value={activeJobs}
            icon={<Activity className="h-4 w-4" />}
          />
          <StatCard
            label="Completed"
            value={completed}
            hint={`${exports_.length} exports ready`}
            icon={<CheckCircle2 className="h-4 w-4" />}
          />
        </div>

        <UploadZone />

        {videos.length > 0 && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Loaded videos
              </h2>
              <Link
                to="/editor"
                className="rounded-lg bg-[image:var(--gradient-primary)] px-4 py-2 text-xs font-semibold text-primary-foreground"
              >
                Open editor →
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {videos.map((v) => (
                <div
                  key={v.id}
                  className="group relative overflow-hidden rounded-xl border border-border bg-card"
                >
                  <div className="aspect-video bg-muted">
                    {v.thumbnail ? (
                      <img
                        src={v.thumbnail}
                        alt={v.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-muted-foreground">
                        <Film className="h-6 w-6" />
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="truncate text-sm font-medium">{v.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {v.meta.width}×{v.meta.height} ·{" "}
                      {formatDuration(v.meta.duration)} · {formatBytes(v.size)}
                    </div>
                  </div>
                  <button
                    onClick={() => removeVideo(v.id)}
                    className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md bg-background/80 opacity-0 transition-opacity hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {exports_.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Recent exports
            </h2>
            <div className="rounded-xl border border-border bg-card divide-y divide-border">
              {exports_.slice(0, 5).map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between px-4 py-3 text-sm"
                >
                  <span className="truncate">{e.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(e.size)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
