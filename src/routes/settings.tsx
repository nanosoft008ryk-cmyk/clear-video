import { createFileRoute } from "@tanstack/react-router";
import { useAppStore } from "@/store/app-store";
import { PageHeader } from "@/components/ui-bits";
import { clearCoreCache, getCoreBlobURLs } from "@/lib/ffmpeg-cache";
import { CheckCircle2, Download, AlertTriangle, Loader2 } from "lucide-react";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const clearVideos = useAppStore((s) => s.clearVideos);
  const cache = useAppStore((s) => s.coreCache);
  const pct =
    cache.total > 0 ? Math.min(100, Math.round((cache.loaded / cache.total) * 100)) : 0;

  const startDownload = () => {
    getCoreBlobURLs().catch(() => {
      /* state already reflects error */
    });
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Tune processing performance and output quality." />
      <div className="px-8 py-6 max-w-2xl space-y-6">
        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold">Processing</h2>
          <Field
            label="Concurrent workers"
            hint="FFmpeg WASM is single-threaded — jobs run serially regardless. Higher values only stage more jobs as in-flight in the UI."
          >
            <input
              type="range"
              min={1}
              max={2}
              value={settings.concurrency}
              onChange={(e) => setSettings({ concurrency: Number(e.target.value) })}
              className="w-full"
            />
            <div className="mt-1 text-xs font-mono">{settings.concurrency}</div>
          </Field>
          <Field label="FFmpeg preset" hint="Faster preset = larger files">
            <select
              value={settings.preset}
              onChange={(e) => setSettings({ preset: e.target.value as typeof settings.preset })}
              className="w-full rounded-lg border border-border bg-input px-2 py-2 text-sm"
            >
              <option value="ultrafast">ultrafast</option>
              <option value="veryfast">veryfast</option>
              <option value="fast">fast</option>
              <option value="medium">medium</option>
            </select>
          </Field>
          <Field label="Quality (CRF)" hint="Lower = better quality, larger files. 18–24 recommended.">
            <input
              type="range"
              min={14}
              max={32}
              value={settings.crf}
              onChange={(e) => setSettings({ crf: Number(e.target.value) })}
              className="w-full"
            />
            <div className="mt-1 text-xs font-mono">{settings.crf}</div>
          </Field>
          <Field
            label="Auto-retry failed jobs"
            hint="On failure, jobs are retried with progressively safer settings (slower preset, higher CRF, copy/skip audio)."
          >
            <input
              type="range"
              min={0}
              max={4}
              value={settings.maxRetries}
              onChange={(e) =>
                setSettings({ maxRetries: Number(e.target.value) })
              }
              className="w-full"
            />
            <div className="mt-1 text-xs font-mono">
              {settings.maxRetries} retries
            </div>
          </Field>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">FFmpeg core cache</h2>
            <CacheBadge status={cache.status} fromCache={cache.fromCache} />
          </div>
          <p className="text-xs text-muted-foreground">
            The FFmpeg WebAssembly core (~30 MB) is cached locally in
            IndexedDB. Once cached, processing works fully offline.
          </p>
          {(cache.status === "downloading" || cache.status === "checking") && (
            <div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-[image:var(--gradient-primary)] transition-[width]"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                {(cache.loaded / 1024 / 1024).toFixed(1)} MB
                {cache.total > 0 && (
                  <>
                    {" / "}
                    {(cache.total / 1024 / 1024).toFixed(1)} MB · {pct}%
                  </>
                )}
              </div>
            </div>
          )}
          {cache.status === "error" && (
            <div className="text-xs text-destructive">
              {cache.error ?? "Failed to download core files."}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={startDownload}
              disabled={
                cache.status === "downloading" || cache.status === "checking"
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs hover:bg-secondary disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              {cache.status === "ready"
                ? "Re-download core"
                : "Download for offline"}
            </button>
            {cache.status === "ready" && (
              <button
                onClick={() => clearCoreCache()}
                className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-destructive hover:text-destructive-foreground"
              >
                Clear cache
              </button>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold">Storage</h2>
          <Field label="Auto-delete originals after processing">
            <input
              type="checkbox"
              checked={settings.autoDelete}
              onChange={(e) => setSettings({ autoDelete: e.target.checked })}
            />
          </Field>
          <button
            onClick={clearVideos}
            className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-destructive hover:text-destructive-foreground"
          >
            Clear loaded videos
          </button>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          <h2 className="mb-2 text-sm font-semibold text-foreground">About</h2>
          All processing runs in-browser via FFmpeg WebAssembly. Your videos
          never leave your device. Templates are persisted to local storage.
        </section>
      </div>
    </div>
  );
}

function CacheBadge({
  status,
  fromCache,
}: {
  status: string;
  fromCache: boolean;
}) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--success)]/15 px-2 py-0.5 text-xs font-medium text-[color:var(--success)]">
        <CheckCircle2 className="h-3 w-3" />
        {fromCache ? "Ready · offline" : "Ready"}
      </span>
    );
  }
  if (status === "downloading" || status === "checking") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent">
        <Loader2 className="h-3 w-3 animate-spin" />
        {status === "checking" ? "Checking" : "Downloading"}
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
        <AlertTriangle className="h-3 w-3" /> Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      Not cached
    </span>
  );
}

function Field({
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
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}