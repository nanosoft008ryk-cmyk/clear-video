import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Scissors,
  Activity,
  Download,
  Settings as SettingsIcon,
  Sparkles,
} from "lucide-react";
import { useEffect } from "react";
import { startQueueRunner } from "@/lib/queue-runner";
import { preloadFFmpeg } from "@/lib/ffmpeg-engine";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/editor", label: "Editor", icon: Scissors },
  { to: "/processing", label: "Processing", icon: Activity },
  { to: "/exports", label: "Exports", icon: Download },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

export function AppLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    startQueueRunner();
    preloadFFmpeg();
  }, []);

  return (
    <div className="flex min-h-screen w-full">
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="flex items-center gap-2 px-6 py-6">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-[image:var(--gradient-primary)] glow">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Bulk Video</div>
            <div className="text-xs text-muted-foreground">Watermark Remover</div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-2 space-y-1">
          {nav.map((n) => {
            const active =
              n.to === "/" ? pathname === "/" : pathname.startsWith(n.to);
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                  active
                    ? "bg-sidebar-accent text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 text-xs text-muted-foreground">
          <div className="rounded-lg glass p-3">
            <div className="font-medium text-foreground">100% Local</div>
            <div className="mt-1">
              FFmpeg WASM processes videos in your browser. Nothing is uploaded.
            </div>
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}