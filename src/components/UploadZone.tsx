import { useCallback, useState } from "react";
import { Upload, Film, AlertCircle } from "lucide-react";
import { extractThumbnail, probeVideo } from "@/lib/ffmpeg-engine";
import { useAppStore } from "@/store/app-store";

const MAX_SIZE = 500 * 1024 * 1024; // 500MB — "Long Video Support"
const MAX_DURATION = 600; // 10 min
const MAX_BATCH = 100;
// Accept anything that looks like a video — we'll let the engine deal with
// it. Filtering too aggressively here was silently dropping valid uploads.
const ALLOWED = /\.(mp4|mov|m4v|webm|mkv|avi|m2ts|ts|flv|wmv|3gp)$/i;

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
          const looksVideo =
            ALLOWED.test(file.name) || file.type.startsWith("video/");
          if (!looksVideo) {
            setErr(`Unsupported format: ${file.name}`);
            continue;
          }
          if (file.size > MAX_SIZE) {
            setErr(`${file.name} exceeds 500MB`);
            continue;
          }
          // Best-effort probe. If metadata reading fails (some codecs/wrappers
          // aren't supported by HTMLVideoElement even though FFmpeg handles
          // them fine) we still add the file with a placeholder so the user
          // sees it in the list and can mark/process it.
          const meta = await probeVideo(file).catch(() => ({
            width: 1280,
            height: 720,
            duration: 0,
          }));
          if (meta.duration && meta.duration > MAX_DURATION + 0.5) {
            setErr(`${file.name} exceeds 10 minutes`);
            continue;
          }
          const thumbnail = await extractThumbnail(file).catch(
            () => undefined,
          );
          const rel = (file as File & { webkitRelativePath?: string })
            .webkitRelativePath;
          addVideo(
            {
              id: crypto.randomUUID(),
              name: file.name,
              size: file.size,
              meta,
              thumbnail,
              relativePath: rel && rel !== file.name ? rel : undefined,
            },
            file,
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [addVideo, existing],
  );

  // Walks a dropped entry tree (folders) and yields all video files
  // with their full relative path attached.
  const walkEntries = useCallback(
    async (items: DataTransferItemList): Promise<File[]> => {
      const out: File[] = [];
      const visit = async (entry: FileSystemEntry, prefix: string) => {
        if (entry.isFile) {
          await new Promise<void>((res) => {
            (entry as FileSystemFileEntry).file((f) => {
              const path = prefix ? `${prefix}/${f.name}` : f.name;
              try {
                Object.defineProperty(f, "webkitRelativePath", {
                  value: path,
                  configurable: true,
                });
              } catch {
                /* noop */
              }
              out.push(f);
              res();
            }, () => res());
          });
        } else if (entry.isDirectory) {
          const reader = (entry as FileSystemDirectoryEntry).createReader();
          const readAll = (): Promise<FileSystemEntry[]> =>
            new Promise((res) => reader.readEntries((e) => res(e), () => res([])));
          let batch = await readAll();
          while (batch.length) {
            for (const child of batch) {
              await visit(child, prefix ? `${prefix}/${entry.name}` : entry.name);
            }
            batch = await readAll();
          }
        }
      };
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      for (const e of entries) await visit(e, "");
      return out;
    },
    [],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setHover(false);
        const hasItems = e.dataTransfer.items && e.dataTransfer.items.length > 0;
        if (hasItems) {
          const fromTree = await walkEntries(e.dataTransfer.items);
          if (fromTree.length) {
            handle(fromTree);
            return;
          }
        }
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
          MP4, MOV, WEBM supported · up to 500MB · 10 min max
        </p>
        <label className="mt-5 inline-flex cursor-pointer items-center justify-center rounded-lg bg-[image:var(--gradient-primary)] px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.02]">
          Browse files
          <input
            type="file"
            multiple
            accept=".mp4,.mov,.m4v,.webm,video/mp4,video/quicktime,video/webm"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handle(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <label className="mt-2 inline-flex cursor-pointer items-center text-[11px] text-muted-foreground hover:text-foreground">
          or upload an entire folder
          <input
            type="file"
            multiple
            // @ts-expect-error — non-standard but widely supported
            webkitdirectory=""
            directory=""
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handle(e.target.files);
              e.target.value = "";
            }}
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