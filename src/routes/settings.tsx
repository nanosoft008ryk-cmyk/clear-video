import { createFileRoute } from "@tanstack/react-router";
import { useAppStore } from "@/store/app-store";
import { PageHeader } from "@/components/ui-bits";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const clearVideos = useAppStore((s) => s.clearVideos);

  return (
    <div>
      <PageHeader title="Settings" subtitle="Tune processing performance and output quality." />
      <div className="px-8 py-6 max-w-2xl space-y-6">
        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold">Processing</h2>
          <Field label="Concurrent workers" hint="More workers = faster batches, higher CPU/RAM">
            <input
              type="range"
              min={1}
              max={4}
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