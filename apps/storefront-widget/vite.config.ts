import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: __dirname,
  server: { port: 4174, strictPort: true },
  build: {
    lib: {
      entry: resolve(__dirname, "src/widget.ts"),
      name: "MuditamChatWidget",
      formats: ["iife"],
      fileName: () => "muditam-chat.js",
    },
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    sourcemap: true,
  },
});
