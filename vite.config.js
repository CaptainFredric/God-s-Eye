import { defineConfig } from "vite";
import cesium from "vite-plugin-cesium";

export default defineConfig({
  plugins: [cesium()],
  server: {
    port: 5173,
    strictPort: true,
    open: false
  },
  preview: {
    port: 4175,
    strictPort: true
  },
  build: {
    sourcemap: false,
    target: "esnext"
  }
});
