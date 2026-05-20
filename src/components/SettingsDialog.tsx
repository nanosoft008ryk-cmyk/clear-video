import { X, Download, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { clearCoreCache, getCoreURLs } from "@/lib/ffmpeg-cache";

export function SettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const cache = useAppStore((s) => s.coreCache);
  const pct =
    cache.total > 0
      ? Math.min(100, Math.round((cache.loaded / cache.total) * 100))
      : 0;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="text-sm font-semibold">Settings</div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 space-y-5">
          <Field label="Quality (CRF)" hint={`${settings.crf} · lower = better quality`}>
            <input
              type="range"
              min={14}
              max={32}
              value={settings.crf}
              onChange={(e) => setSettings({ crf: Number(e.target.value) })}
              className="w-full"
            />
          </Field>
          <Field label="Encoder speed" hint="Faster = larger files">
            <select
              value={settings.preset}
              onChange={(e) =>
                setSettings({ preset: e.target.value as typeof settings.preset })
              }
              className="w-full rounded-lg border border-border bg-input px-2 py-2 text-sm"
            >
              <option value="ultrafast">ultrafast</option>
              <option value="veryfast">veryfast</option>
              <option value="fast">fast</option>
              <option value="medium">medium</option>
            </select>
          </Field>
          <Field
            label="Auto-retry failed jobs"
            hint={`${settings.maxRetries} retries with progressively safer settings`}
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
          </Field>

          <div className="rounded-xl border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">FFmpeg core cache</div>
              <CacheBadge status={cache.status} fromCache={cache.fromCache} />
            </div>
            <p className="text-xs text-muted-foreground">
              The ~30 MB engine is cached locally so processing works fully offline.
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
                  {cache.total > 0 &&
                    ` / ${(cache.total / 1024 / 1024).toFixed(1)} MB · ${pct}%`}
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
                onClick={() => getCoreURLs().catch(() => {})}
                disabled={
                  cache.status === "downloading" || cache.status === "checking"
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs hover:bg-secondary disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                {cache.status === "ready"
                  ? "Re-download"
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
          </div>

          <p className="text-[11px] text-muted-foreground">
            All processing runs in your browser via FFmpeg WebAssembly. Your videos never leave your device.
          </p>
        </div>
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
  if (status === "ready")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--success)]/15 px-2 py-0.5 text-xs font-medium text-[color:var(--success)]">
        <CheckCircle2 className="h-3 w-3" />
        {fromCache ? "Ready · offline" : "Ready"}
      </span>
    );
  if (status === "downloading" || status === "checking")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent">
        <Loader2 className="h-3 w-3 animate-spin" />
        {status === "checking" ? "Checking" : "Downloading"}
      </span>
    );
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
        <AlertTriangle className="h-3 w-3" /> Error
      </span>
    );
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