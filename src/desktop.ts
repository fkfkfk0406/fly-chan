// 데스크톱(Tauri) 전용: 테두리 없는 작은 창의 제목 줄. 트레이·항상 위·자동 시작은 src-tauri 에서 처리한다.
import { getCurrentWindow } from "@tauri-apps/api/window";

export async function setupDesktop(): Promise<void> {
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
  const pin = button("항상 위", "📌", async () => {
    const on = !(await win.isAlwaysOnTop());
    await win.setAlwaysOnTop(on);
    pin.classList.toggle("on", on);
  });
  pin.classList.toggle("on", await win.isAlwaysOnTop());

  bar.append(
    title,
    pin,
    button("작게", "—", () => void win.minimize()),
    button("트레이로 숨기기", "✕", () => void win.hide()),
  );
  document.body.prepend(bar);
}
