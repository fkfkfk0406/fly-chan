// 대사 속 {name}(캐릭터 이름)·{me}(나를 부르는 호칭)을 채운다.
// 조사는 받침에 맞춰 고른다: {me:을/를} → "민준을" / "너를", {name:이/가} → "플라이쨩이"

export interface Names {
  name: string;
  me: string;
}

/** 마지막 글자에 받침이 있는지 (한글이 아니면 없다고 본다) */
export function hasBatchim(word: string): boolean {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
}

export function personalize(text: string, names: Names): string {
  return text.replace(/\{(name|me)(?::([^/}]*)\/([^}]*))?\}/g, (_, key: "name" | "me", withB?: string, withoutB?: string) => {
    const word = names[key];
    if (withB === undefined) return word;
    return word + (hasBatchim(word) ? withB : withoutB);
  });
}

export const DEFAULT_NAMES: Names = { name: "플라이쨩", me: "너" };

/** 입력값 정리: 앞뒤 공백·줄바꿈 제거, 8자 제한, 비면 기본값 */
export function cleanName(input: string, fallback: string): string {
  const trimmed = [...input.replace(/\s+/g, " ").trim()].slice(0, 8).join("");
  return trimmed || fallback;
}
