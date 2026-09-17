// 자리를 비웠을 때: 남겨 둔 편지, 삐짐·질투 장면
import { L as tr } from "../i18n.ts";
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
  const open = ctx.stage >= 3 ? tr(`보고 싶은 {me}에게 💌`, `To {me}, whom I miss 💌`) : ctx.stage >= 1 ? tr(`{me}에게`, `To {me}`) : tr(`…저기, {me}.`, `…Um, {me}.`);
  const body: string[] = [];
  body.push(
    ctx.hours >= 24
      ? pick(tr(["하루가 넘도록 안 오길래 창문만 봤어.", "초파리한테 하루는 엄청 긴 시간이라고. 알아?"], ["You didn't come for over a day, so I just stared at the window.", "For a fruit fly, a day is a really long time. Did you know that?"]), rand)
      : pick(tr(["{me}가 없는 동안 방을 몇 바퀴나 돌았는지 몰라.", "조용해서 더듬이만 만지작거렸어."], ["I lost count of how many laps I walked around the room.", "It was so quiet I just fiddled with my antennae."]), rand),
  );
  if (ctx.slept) body.push(tr("낮잠도 잤어. 꿈에서 뉴런이 반짝반짝했어.", "I took a nap too. My neurons sparkled in my dream."));
  if (ctx.hungry) body.push(tr("그리고… 배고파. 딸기 생각뿐이야.", "And… I'm hungry. All I can think about is strawberries."));
  if (ctx.dirty) body.push(tr("방에 먼지가 쌓였어. 같이 치우자?", "Dust piled up in the room. Clean it with me?"));
  const gift: FoodKind | null = rand() < 0.6 ? pick<FoodKind>(["sweet", "sweet", "water", "honey"], rand) : null;
  if (gift) body.push(pick(tr(["창틀에서 주운 거 하나 남겨 둘게. 먹어도 돼!", "숨겨 둔 간식 하나 나눠 줄게."], ["I'm leaving you something I found on the windowsill. You can eat it!", "I'll share a snack I hid."]), rand));
  body.push(ctx.stage >= 3 ? tr("빨리 와. — {name}♡", "Come back soon. — {name}♡") : "— {name}");
  return { t: now, lines: [open, ...body], gift };
}

const L = (text: string, expr?: Line["expr"]): Line => ({ text, expr });

export function sulkScene(jealous: boolean): Scene {
  if (jealous) {
    return {
      id: "sulk-jealous",
      lines: [L("…", "angry"), L(tr("다른 창에서 누구 만나고 왔어?", "Who were you seeing in that other window?"), "angry")],
      choices: [
        { label: tr("너만 보고 싶었어", "I only wanted to see you"), sulk: 0.6, mood: 0.1, reply: [L(tr("…진짜지? 뉴런 13만 8천 개가 다 듣고 있거든.", "…Really? All 138,000 of my neurons are listening."), "relaxed")] },
        { label: tr("그냥 일 좀 했어", "I was just working"), sulk: 0.25, reply: [L(tr("흥. 일이 나보다 중요해?", "Hmph. Is work more important than me?"), "angry")] },
      ],
    };
  }
  return {
    id: "sulk",
    lines: [L(tr("흥.", "Hmph."), "angry"), L(tr("{me}, 나 혼자 두고 어디 갔었어?", "Where did you go, leaving me all alone?"), "sad")],
    choices: [
      { label: tr("미안해, 보고 싶었어", "Sorry, I missed you"), sulk: 0.5, mood: 0.1, reply: [L(tr("…나도 조금은 보고 싶었어.", "…I missed you a little too."), "relaxed")] },
      { label: tr("딸기 사 왔어", "I brought strawberries"), sulk: 0.25, reply: [L(tr("딸기로 넘어갈 줄 알고? …일단 받을게.", "You think strawberries will fix this? …I'll take them for now."), "angry")] },
    ],
  };
}
