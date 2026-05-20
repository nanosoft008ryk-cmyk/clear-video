import { Outlet } from "@tanstack/react-router";
import { Sparkles, Settings as SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { startQueueRunner } from "@/lib/queue-runner";
import { preloadFFmpeg } from "@/lib/ffmpeg-engine";
import { useAppStore } from "@/store/app-store";
import { SettingsDialog } from "@/components/SettingsDialog";

export function AppLayout() {
  const cache = useAppStore((s) => s.coreCache);
  const pct =
    cache.total > 0
      ? Math.min(100, Math.round((cache.loaded / cache.total) * 100))
      : 0;
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    startQueueRunner();
    preloadFFmpeg();
  }, []);

  const statusLabel =
    cache.status === "ready"
      ? "Engine ready · offline"
      : cache.status === "downloading"
        ? `Downloading core ${pct}%`
        : cache.status === "checking"
          ? "Checking cache…"
          : cache.status === "error"
            ? "Engine offline error"
            : "Engine idle";

  return (
    <div className="min-h-screen w-full">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[image:var(--gradient-primary)] glow">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="text-sm font-semibold tracking-tight">
              Watermark Remover
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  cache.status === "ready"
                    ? "bg-[color:var(--success)]"
                    : cache.status === "error"
                      ? "bg-destructive"
                      : "bg-accent animate-pulse"
                }`}
              />
              {statusLabel}
            </span>
            <button
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary"
            >
              <SettingsIcon className="h-3.5 w-3.5" /> Settings
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}