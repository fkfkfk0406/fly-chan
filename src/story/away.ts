// 자리를 비웠을 때: 남겨 둔 편지, 삐짐·질투 장면
import type { FoodKind } from "../world/Habitat.ts";
import type { Line, Scene } from "./scripts.ts";

export interface Letter {
  t: number;
  lines: string[];
  gift: FoodKind | null;
}

export interface LetterContext {
  stage: number;
  hours: number;
  hungry: boolean;
  dirty: boolean;
  slept: boolean;
}

const pick = <T>(list: T[], rand: () => number) => list[Math.floor(rand() * list.length)];

/** 오래 비운 동안 캐릭터가 남긴 편지. {name}·{me} 는 보여 줄 때 채운다 */
export function writeLetter(ctx: LetterContext, now: number, rand: () => number = Math.random): Letter {
  const open = ctx.stage >= 3 ? `보고 싶은 {me}에게 💌` : ctx.stage >= 1 ? `{me}에게` : `…저기, {me}.`;
  const body: string[] = [];
  body.push(
    ctx.hours >= 24
      ? pick(["하루가 넘도록 안 오길래 창문만 봤어.", "초파리한테 하루는 엄청 긴 시간이라고. 알아?"], rand)
      : pick(["{me}가 없는 동안 방을 몇 바퀴나 돌았는지 몰라.", "조용해서 더듬이만 만지작거렸어."], rand),
  );
  if (ctx.slept) body.push("낮잠도 잤어. 꿈에서 뉴런이 반짝반짝했어.");
  if (ctx.hungry) body.push("그리고… 배고파. 딸기 생각뿐이야.");
  if (ctx.dirty) body.push("방에 먼지가 쌓였어. 같이 치우자?");
  const gift: FoodKind | null = rand() < 0.6 ? pick<FoodKind>(["sweet", "sweet", "water", "honey"], rand) : null;
  if (gift) body.push(pick(["창틀에서 주운 거 하나 남겨 둘게. 먹어도 돼!", "숨겨 둔 간식 하나 나눠 줄게."], rand));
  body.push(ctx.stage >= 3 ? "빨리 와. — {name}♡" : "— {name}");
  return { t: now, lines: [open, ...body], gift };
}

const L = (text: string, expr?: Line["expr"]): Line => ({ text, expr });

export function sulkScene(jealous: boolean): Scene {
  if (jealous) {
    return {
      id: "sulk-jealous",
      lines: [L("…", "angry"), L("다른 창에서 누구 만나고 왔어?", "angry")],
      choices: [
        { label: "너만 보고 싶었어", sulk: 0.6, mood: 0.1, reply: [L("…진짜지? 뉴런 13만 8천 개가 다 듣고 있거든.", "relaxed")] },
        { label: "그냥 일 좀 했어", sulk: 0.25, reply: [L("흥. 일이 나보다 중요해?", "angry")] },
      ],
    };
  }
  return {
    id: "sulk",
    lines: [L("흥.", "angry"), L("{me}, 나 혼자 두고 어디 갔었어?", "sad")],
    choices: [
      { label: "미안해, 보고 싶었어", sulk: 0.5, mood: 0.1, reply: [L("…나도 조금은 보고 싶었어.", "relaxed")] },
      { label: "딸기 사 왔어", sulk: 0.25, reply: [L("딸기로 넘어갈 줄 알고? …일단 받을게.", "angry")] },
    ],
  };
}
