// 이스터에그: 판정은 여기(순수 함수), 연출은 main.ts
import { L as tr } from "../i18n.ts";
import type { Scene } from "./scripts.ts";

export const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

/** 키 입력을 받아 코나미 커맨드 완성 여부를 돌려준다 */
export class KonamiDetector {
  private recent: string[] = [];

  push(key: string): boolean {
    this.recent.push(key.length === 1 ? key.toLowerCase() : key);
    if (this.recent.length > KONAMI.length) this.recent.shift();
    if (this.recent.join() !== KONAMI.join()) return false;
    this.recent = [];
    return true;
  }
}

/** 이름이 초파리 학명이면 */
export function isScientificName(name: string): boolean {
  return /^(초파리|노랑초파리|drosophila( melanogaster)?|드로소필라|fruit ?fly)$/i.test(name.trim());
}

/** 새벽 4시 4분 */
export const is404 = (d: Date) => d.getHours() === 4 && d.getMinutes() === 4;

export interface SpecialDay {
  id: string;
  reward: number;
  scene: Scene;
}

const L = (text: string, expr?: Scene["lines"][number]["expr"]) => ({ text, expr });

/** 오늘이 특별한 날이면 (한 번만 보여 줄 id 포함) */
export function specialDay(d: Date, daysTogether: number): SpecialDay | null {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (daysTogether === 100 || daysTogether === 365) {
    const label = daysTogether === 100 ? tr("100일", "100 days") : tr("1년", "one year");
    return {
      id: `together-${daysTogether}`,
      reward: daysTogether === 100 ? 100 : 365,
      scene: {
        id: `together-${daysTogether}`,
        lines: [L(tr(`오늘… 우리 함께한 지 ${label}이야!`, `Today… we've been together for ${label}!`), "happy"), L(tr("초파리한테 이건 거의 영원이라고.", "For a fruit fly, that's basically forever."), "relaxed")],
        choices: [{ label: tr("앞으로도 계속 함께하자", "Let's stay together from now on too"), mood: 0.2, affection: 0.02, reply: [L(tr("응. 시냅스 다 걸고 약속♡", "Okay. I promise on all my synapses♡"), "happy")] }],
      },
    };
  }
  if (m === 12 && day === 25) {
    return {
      id: `xmas-${y}`,
      reward: 50,
      scene: {
        id: "xmas",
        lines: [L(tr("메리 크리스마스! 🎄", "Merry Christmas! 🎄"), "happy"), L(tr("산타가 초파리한테도 선물 줄까? 딸기면 좋겠다.", "Does Santa give presents to fruit flies too? I hope it's strawberries."), "relaxed")],
        choices: [{ label: tr("내가 산타 해 줄게", "I'll be your Santa"), mood: 0.2, affection: 0.02, reply: [L(tr("헤헤, 그럼 딸기 트리 기대할게!", "Hehe, then I'm expecting a strawberry tree!"), "happy")] }],
      },
    };
  }
  if (m === 3 && day === 14) {
    return {
      id: `pi-${y}`,
      reward: 31,
      scene: {
        id: "pi",
        lines: [L(tr("오늘 3월 14일, 파이데이래!", "It's March 14th, Pi Day!"), "surprised"), L(tr("3.14159… 내 뉴런 13만 8천 개로도 끝까지는 못 외워.", "3.14159… even 138,000 neurons can't memorize all of it."), "sad")],
        choices: [{ label: tr("파이 대신 딸기 파이 먹자", "Let's eat strawberry pie instead"), mood: 0.15, reply: [L(tr("그건 뉴런 전부로 찬성!", "Every neuron votes yes!"), "happy")] }],
      },
    };
  }
  return null;
}

export const SCIENTIFIC_NAME_SCENE: Scene = {
  id: "egg-name",
  lines: [L(tr("잠깐… 그건 내 학명이잖아…!", "Wait… that's my scientific name…!"), "surprised"), L(tr("사람한테 '호모 사피엔스야~' 하고 부르는 거랑 똑같다고.", "That's like calling a person 'Hey, Homo sapiens~'."), "angry")],
  choices: [{ label: tr("그래도 잘 어울리는걸", "It still suits you"), mood: 0.05, reply: [L(tr("…뭐, 틀린 말은 아니네.", "…Well, you're not wrong."), "relaxed")] }],
};
