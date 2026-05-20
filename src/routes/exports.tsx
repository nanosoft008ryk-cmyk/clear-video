import { createFileRoute } from "@tanstack/react-router";
import { Download, Trash2, Archive } from "lucide-react";
import JSZip from "jszip";
import { useAppStore } from "@/store/app-store";
import { PageHeader, formatBytes } from "@/components/ui-bits";

export const Route = createFileRoute("/exports")({
  component: ExportsPage,
});

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportsPage() {
  const exports_ = useAppStore((s) => s.exports);
  const blobs = useAppStore((s) => s.exportBlobs);
  const remove = useAppStore((s) => s.removeExport);

  const downloadOne = (id: string, name: string) => {
    const b = blobs.get(id);
    if (b) downloadBlob(b, name);
  };

  const downloadAllZip = async () => {
    const zip = new JSZip();
    for (const e of exports_) {
      const b = blobs.get(e.id);
      if (b) zip.file(e.name, b);
    }
    const out = await zip.generateAsync({ type: "blob" });
    downloadBlob(out, `exports_${Date.now()}.zip`);
  };

  const totalSize = exports_.reduce((a, e) => a + e.size, 0);

  return (
    <div>
      <PageHeader
        title="Export Center"
        subtitle="Download processed videos individually or as a single ZIP."
        actions={
          exports_.length > 0 ? (
            <button
              onClick={downloadAllZip}
              className="inline-flex items-center gap-2 rounded-lg bg-[image:var(--gradient-primary)] px-4 py-2 text-xs font-semibold text-primary-foreground"
            >
              <Archive className="h-4 w-4" /> Download all (
              {formatBytes(totalSize)})
            </button>
          ) : null
        }
      />
      <div className="px-8 py-6">
        {exports_.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-16 text-center text-sm text-muted-foreground">
            No exports yet. Process a video to see it here.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {exports_.map((e) => {
              const blob = blobs.get(e.id);
              const available = !!blob;
              return (
                <div
                  key={e.id}
                  className="overflow-hidden rounded-xl border border-border bg-card"
                >
                  {blob ? (
                    <video
                      src={URL.createObjectURL(blob)}
                      className="aspect-video w-full bg-black"
                      controls
                    />
                  ) : (
                    <div className="grid aspect-video place-items-center bg-muted text-xs text-muted-foreground">
                      Reload session to regenerate
                    </div>
                  )}
                  <div className="p-3">
                    <div className="truncate text-sm font-medium">{e.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {formatBytes(e.size)} ·{" "}
                      {new Date(e.createdAt).toLocaleString()}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        disabled={!available}
                        onClick={() => downloadOne(e.id, e.name)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[image:var(--gradient-primary)] px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40"
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </button>
                      <button
                        onClick={() => remove(e.id)}
                        className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-destructive hover:text-destructive-foreground"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}