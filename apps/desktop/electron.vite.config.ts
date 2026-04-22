import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const remoteControlAppMode = normalizeAppMode(process.env.REMOTE_CONTROL_APP_MODE);
const buildDefines = {
  __REMOTE_CONTROL_APP_MODE__: JSON.stringify(remoteControlAppMode)
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: buildDefines,
    build: {
      rollupOptions: {
        input: {
          index: resolve(root, "src/main/index.ts")
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    define: buildDefines,
    build: {
      rollupOptions: {
        input: {
          index: resolve(root, "src/preload/index.ts")
        }
      }
    }
  },
  renderer: {
    root: resolve(root, "src/renderer"),
    plugins: [react()],
    resolve: {
      alias: {
        "@renderer": resolve(root, "src/renderer/src")
      }
    }
  }
});

function normalizeAppMode(value: string | undefined): "combined" | "host" | "viewer" {
  if (value === "host" || value === "viewer") {
    return value;
  }

  return "combined";
}
