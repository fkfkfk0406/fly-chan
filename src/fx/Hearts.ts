/** 화면 좌표에서 하트·반짝이가 떠오르는 파티클 (DOM + CSS 애니메이션) */
export function burst(x: number, y: number, count: number, symbols = ["♥"]): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) count = Math.min(count, 1);
  for (let k = 0; k < count; k++) {
    const el = document.createElement("span");
    el.className = "particle";
    el.textContent = symbols[k % symbols.length];
    const dx = (Math.random() - 0.5) * (40 + count * 8);
    el.style.left = `${x + dx * 0.3}px`;
    el.style.top = `${y}px`;
    el.style.setProperty("--dx", `${dx}px`);
    el.style.setProperty("--rise", `${70 + Math.random() * 60}px`);
    el.style.setProperty("--size", `${14 + Math.random() * 12}px`);
    el.style.animationDelay = `${k * 45}ms`;
    el.addEventListener("animationend", () => el.remove());
    document.body.appendChild(el);
  }
}
