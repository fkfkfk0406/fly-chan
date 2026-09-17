/// <reference types="vitest/config" />
import { rmSync } from "node:fs";
import { defineConfig } from "vite";

// tauri CLI 로 빌드하면 TAURI_ENV_PLATFORM 이 들어온다.
// 데스크톱 설치 파일에는 뇌 데이터·VRM 을 넣지 않는다 (첫 실행 때 GitHub Releases 에서 받음, src/util/assets.ts)
const desktop = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  clearScreen: false,
  server: { strictPort: true },
  worker: { format: "es" },
  plugins: desktop
    ? [
        {
          name: "fly-chan-desktop-strip-assets",
          apply: "build",
          closeBundle() {
            rmSync("dist/data", { recursive: true, force: true });
            rmSync("dist/models", { recursive: true, force: true });
          },
        },
      ]
    : [],
  test: { testTimeout: 120_000 },
});
