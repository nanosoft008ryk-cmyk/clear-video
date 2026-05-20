// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Some browsers (and the @ffmpeg/ffmpeg module worker) request the core
// js/wasm files as ESM modules, which makes Vite's transform middleware
// try to compile them and crash with "Failed to load url ... in /public".
// This plugin short-circuits those requests and serves the raw files.
function serveFfmpegCore() {
  return {
    name: "serve-ffmpeg-core",
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url = (req.url || "").split("?")[0];
        if (!url.startsWith("/ffmpeg-core/")) return next();
        const file = resolve(process.cwd(), "public" + url);
        if (!existsSync(file)) return next();
        const isWasm = file.endsWith(".wasm");
        try {
          const data = await readFile(file);
          res.setHeader(
            "Content-Type",
            isWasm ? "application/wasm" : "text/javascript",
          );
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
          res.end(data);
        } catch {
          next();
        }
      });
    },
  };
}

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [serveFfmpegCore()],
    optimizeDeps: {
      exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
    },
  },
});
