// 언어: 페이지를 열 때 한 번 정한다. 바꾸면 저장하고 새로고침한다.
// 문구는 쓰는 자리에서 L("한국어", "English") 로 고른다.

export type Lang = "ko" | "en";

const KEY = "fly-chan-lang";

function detect(): Lang {
  // Node(테스트)·워커에는 document 가 없다. 워커는 init 메시지로 언어를 받는다
  if (typeof document === "undefined") return "ko";
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "ko" || saved === "en") return saved;
  } catch {
    // 저장소를 못 쓰면 브라우저 언어로
  }
  return navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
}

export let LANG: Lang = detect();

/** 워커처럼 document 가 없는 곳에서 언어를 맞춘다 */
export function useLang(lang: Lang): void {
  LANG = lang;
}

export const L = <T>(ko: T, en: T): T => (LANG === "en" ? en : ko);

export function setLang(lang: Lang): void {
  if (lang === LANG) return;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // 저장이 안 되면 이번 방문에만 적용된다
  }
  location.reload();
}

/**
 * index.html 의 고정 문구. 한국어가 기본이고, 영어일 때
 * data-en(글자) · data-en-aria(aria-label) · data-en-title(title) · data-en-placeholder 를 덮어쓴다.
 */
export function applyStaticText(): void {
  document.documentElement.lang = LANG;
  if (LANG === "ko") return;
  for (const el of document.querySelectorAll<HTMLElement>("[data-en]")) el.textContent = el.dataset.en!;
  for (const el of document.querySelectorAll<HTMLElement>("[data-en-aria]")) el.setAttribute("aria-label", el.dataset.enAria!);
  for (const el of document.querySelectorAll<HTMLElement>("[data-en-title]")) el.title = el.dataset.enTitle!;
  for (const el of document.querySelectorAll<HTMLInputElement>("[data-en-placeholder]")) el.placeholder = el.dataset.enPlaceholder!;
}
