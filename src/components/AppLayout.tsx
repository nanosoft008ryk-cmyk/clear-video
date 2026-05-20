import { Outlet } from "@tanstack/react-router";
import { Scissors, Settings as SettingsIcon, Play } from "lucide-react";
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
    void useAppStore
      .getState()
      .rehydrateFromIDB()
      .finally(() => {
        startQueueRunner();
        preloadFFmpeg();
      });
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
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <a href="/" className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[image:var(--gradient-primary)] glow">
              <Scissors className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="text-[15px] font-semibold tracking-tight">
              ClearVideo
            </div>
          </a>
          <nav className="hidden md:flex items-center gap-1 text-[13px] text-muted-foreground">
            <a href="#tool" className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 hover:bg-secondary hover:text-foreground">
              <Scissors className="h-3.5 w-3.5" /> Watermark Remover
              <span className="ml-1 rounded-full bg-[color:var(--success)]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--success)]">FREE</span>
            </a>
            <a href="#how" className="rounded-md px-3 py-1.5 hover:bg-secondary hover:text-foreground">How it works</a>
            <a href="#examples" className="rounded-md px-3 py-1.5 hover:bg-secondary hover:text-foreground">Examples</a>
            <a href="#faq" className="rounded-md px-3 py-1.5 hover:bg-secondary hover:text-foreground">FAQ</a>
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-2 text-[11px] text-muted-foreground">
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-secondary"
              aria-label="Settings"
            >
              <SettingsIcon className="h-3.5 w-3.5" />
            </button>
            <a
              href="#tool"
              className="inline-flex items-center gap-1.5 rounded-full bg-[image:var(--gradient-primary)] px-4 py-1.5 text-xs font-semibold text-primary-foreground glow"
            >
              <Play className="h-3.5 w-3.5 fill-current" /> Get Started
            </a>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}