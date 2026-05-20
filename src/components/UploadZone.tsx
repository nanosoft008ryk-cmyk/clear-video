import { useCallback, useState } from "react";
import { Upload, Film, AlertCircle } from "lucide-react";
import { extractThumbnail, probeVideo } from "@/lib/ffmpeg-engine";
import { useAppStore } from "@/store/app-store";

const MAX_SIZE = 100 * 1024 * 1024;
const MAX_DURATION = 60;
const MAX_BATCH = 100;
const ALLOWED = /\.(mp4|mov|avi|mkv|webm)$/i;

export function UploadZone({ compact = false }: { compact?: boolean }) {
  const [hover, setHover] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const addVideo = useAppStore((s) => s.addVideo);
  const existing = useAppStore((s) => s.videos.length);

  const handle = useCallback(
    async (files: FileList | File[]) => {
      setErr(null);
      setBusy(true);
      try {
        const arr = Array.from(files);
        if (existing + arr.length > MAX_BATCH) {
          setErr(`Batch limit is ${MAX_BATCH} videos`);
          return;
        }
        for (const file of arr) {
          if (!ALLOWED.test(file.name)) {
            setErr(`Unsupported format: ${file.name}`);
            continue;
          }
          if (file.size > MAX_SIZE) {
            setErr(`${file.name} exceeds 100MB`);
            continue;
          }
          try {
            const meta = await probeVideo(file);
            if (meta.duration > MAX_DURATION + 0.5) {
              setErr(`${file.name} exceeds 60s`);
              continue;
            }
            const thumbnail = await extractThumbnail(file).catch(
              () => undefined,
            );
            addVideo(
              {
                id: crypto.randomUUID(),
                name: file.name,
                size: file.size,
                meta,
                thumbnail,
              },
              file,
            );
          } catch {
            setErr(`Could not read ${file.name}`);
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [addVideo, existing],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        if (e.dataTransfer.files) handle(e.dataTransfer.files);
      }}
      className={`relative rounded-2xl border-2 border-dashed transition-all ${
        hover
          ? "border-primary bg-primary/5 glow"
          : "border-border bg-card/40 hover:border-primary/40"
      } ${compact ? "p-6" : "p-12"}`}
    >
      <div className="flex flex-col items-center text-center">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[image:var(--gradient-primary)] glow">
          {busy ? (
            <Film className="h-7 w-7 animate-pulse text-primary-foreground" />
          ) : (
            <Upload className="h-7 w-7 text-primary-foreground" />
          )}
        </div>
        <h3 className="mt-4 text-lg font-semibold">
          {busy ? "Reading videos…" : "Drop videos here"}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          MP4, MOV, AVI, MKV, WEBM · up to 100MB · 60s max · 100 files
        </p>
        <label className="mt-5 inline-flex cursor-pointer items-center justify-center rounded-lg bg-[image:var(--gradient-primary)] px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.02]">
          Browse files
          <input
            type="file"
            multiple
            accept=".mp4,.mov,.avi,.mkv,.webm,video/*"
            className="hidden"
            onChange={(e) => e.target.files && handle(e.target.files)}
          />
        </label>
        {err && (
          <div className="mt-4 flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" /> {err}
          </div>
        )}
      </div>
    </div>
  );
}