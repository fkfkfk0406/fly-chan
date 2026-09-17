// 데스크톱(Tauri) 전용: 테두리 없는 작은 창의 제목 줄. 트레이·항상 위·자동 시작은 src-tauri 에서 처리한다.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { L } from "./i18n.ts";

/** beforeUpdate: 업데이트 설치 직전에 부른다 (저장) */
export async function setupDesktop(beforeUpdate: () => void): Promise<void> {
  const win = getCurrentWindow();
  document.body.classList.add("desktop");

  const bar = document.createElement("div");
  bar.className = "titlebar";
  bar.setAttribute("data-tauri-drag-region", "");
  const title = document.createElement("span");
  title.textContent = "FLY-CHAN";
  title.setAttribute("data-tauri-drag-region", "");

  const button = (label: string, text: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.setAttribute("aria-label", label);
    b.title = label;
    b.textContent = text;
    b.onclick = onClick;
    return b;
  };
  const pin = button(L("항상 위", "Always on top"), "📌", async () => {
    const on = !(await win.isAlwaysOnTop());
    await win.setAlwaysOnTop(on);
    pin.classList.toggle("on", on);
  });
  pin.classList.add("pin");
  pin.classList.toggle("on", await win.isAlwaysOnTop());

  bar.append(
    title,
    pin,
    button(L("작게", "Minimize"), "—", () => void win.minimize()),
    button(L("트레이로 숨기기", "Hide to tray"), "✕", () => void win.hide()),
  );
  document.body.prepend(bar);

  // 켜고 조금 뒤, 그리고 6시간마다 새 버전을 확인한다
  const checkLater = (ms: number): void => {
    setTimeout(() => void checkUpdate(beforeUpdate).finally(() => checkLater(6 * 3.6e6)), ms);
  };
  if (!import.meta.env.DEV) checkLater(8000);
}

let offered = "";

async function checkUpdate(beforeUpdate: () => void): Promise<void> {
  const update = await check().catch(() => null); // 오프라인이면 조용히 넘어간다
  if (!update || offered === update.version) return;
  offered = update.version;

  const box = document.createElement("div");
  box.className = "update-banner";
  const text = document.createElement("span");
  text.textContent = L(`새 버전 v${update.version}이 나왔어요`, `Version ${update.version} is available`);
  const later = document.createElement("button");
  later.textContent = L("나중에", "Later");
  later.onclick = () => box.remove();
  const now = document.createElement("button");
  now.className = "primary";
  now.textContent = L("업데이트", "Update");
  now.onclick = async () => {
    now.disabled = later.disabled = true;
    let total = 0;
    let got = 0;
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        if (e.event === "Progress") {
          got += e.data.chunkLength;
          text.textContent = (total ? L(`받는 중… ${Math.round((got / total) * 100)}%`, `Downloading… ${Math.round((got / total) * 100)}%`) : L("받는 중…", "Downloading…"));
        }
        if (e.event === "Finished") {
          text.textContent = L("설치하는 중…", "Installing…");
          beforeUpdate();
        }
      });
      await relaunch();
    } catch (err) {
      text.textContent = L("업데이트 실패: ", "Update failed: ") + (err instanceof Error ? err.message : String(err));
      later.disabled = false;
      later.textContent = L("닫기", "Close");
    }
  };
  box.append(text, later, now);
  document.body.append(box);
}
