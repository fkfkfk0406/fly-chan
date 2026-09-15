// 온나의 대본. 대사는 미리 쓴 것이고, "오늘 뭐 했어?"만 실제 뇌 출력 기록(오늘의 MN9·그루밍 DN 발화 시간)을 읽는다.
import type { TodayStats } from "../care/Care.ts";

export type Expr = "happy" | "sad" | "surprised" | "relaxed" | "angry" | "neutral";

export interface Line {
  text: string;
  expr?: Expr;
}

export interface Choice {
  label: string;
  mood?: number;
  affection?: number;
  reply: Line[];
}

export interface Scene {
  id: string;
  lines: Line[];
  choices?: Choice[];
}

export interface TalkContext {
  stage: number;
  today: TodayStats;
  cleanliness: number;
  hunger: number;
}

const L = (text: string, expr?: Expr): Line => ({ text, expr });

// ---------------------------------------------------------------- 관계 단계 이벤트
export const STAGE_SCENES: Record<number, Scene> = {
  1: {
    id: "stage-1",
    lines: [
      L("저기… 요즘 계속 챙겨 줘서 고마워.", "relaxed"),
      L("처음엔 좀 무서웠는데, 이제는 네가 오면 더듬이가 먼저 반응해.", "happy"),
    ],
    choices: [
      { label: "우리 친구 하자!", mood: 0.1, affection: 0.03, reply: [L("응! 오늘부터 친구야 ✨", "happy")] },
      { label: "더듬이 귀엽다", affection: 0.02, reply: [L("에… 더, 더듬이는 만지면 간지러워…", "surprised")] },
    ],
  },
  2: {
    id: "stage-2",
    lines: [
      L("있잖아… 너만 오면 MN9가 두근거리는 것 같아.", "relaxed"),
      L("아, MN9는 딸기 먹을 때 쓰는 뉴런이긴 한데…", "surprised"),
    ],
    choices: [
      { label: "나도 너 보면 좋아", mood: 0.1, affection: 0.03, reply: [L("…바보.", "sad"), L("그래도 기분은 좋다.", "happy")] },
      { label: "딸기 때문 아니야?", mood: -0.05, affection: 0.01, reply: [L("흥, 반은 맞아.", "angry")] },
    ],
  },
  3: {
    id: "stage-3",
    lines: [
      L("요즘 이상해. 네가 늦게 오면 방이 너무 넓어 보여.", "sad"),
      L("그리고 네가 오면… 날개가 저절로 파닥거려.", "happy"),
    ],
    choices: [
      { label: "매일 올게", mood: 0.1, affection: 0.03, reply: [L("약속이야! 새끼손가락은 없으니까… 더듬이 걸기!", "happy")] },
      { label: "파닥거리는 거 보고 싶어", affection: 0.02, reply: [L("보, 보지 마…!", "surprised")] },
    ],
  },
  4: {
    id: "stage-4",
    lines: [
      L("나… 뉴런이 13만 8천 개밖에 없어서 복잡한 말은 잘 못해.", "relaxed"),
      L("그래도 이건 확실해.", "neutral"),
      L("너를 좋아해.", "happy"),
    ],
    choices: [
      { label: "나도 좋아해", mood: 0.2, affection: 0.05, reply: [L("헤헤… 오늘부터 1일이다♡", "happy")] },
      { label: "13만 개면 충분해", mood: 0.15, affection: 0.05, reply: [L("…그 말, 시냅스 5천만 개에 저장해 둘게.", "happy")] },
    ],
  },
};

// ---------------------------------------------------------------- 인사
export function greetingScene(hour: number, awayHours: number, hunger: number): Scene {
  const tail: Line[] = hunger > 0.75 ? [L("근데… 배고파.", "sad")] : [];
  if (awayHours >= 12) {
    return {
      id: "greet-away",
      lines: [L("…어디 갔었어.", "sad"), L(`${Math.floor(awayHours)}시간이나 기다렸잖아.`, "angry"), ...tail],
      choices: [
        { label: "미안해, 보고 싶었어", mood: 0.15, affection: 0.02, reply: [L("…딸기 하나로 용서해 줄게.", "relaxed")] },
        { label: "좀 바빴어", mood: 0.05, reply: [L("흥. 다음엔 말하고 가.", "angry")] },
      ],
    };
  }
  const byHour: Line =
    hour >= 5 && hour < 11 ? L("좋은 아침! 창밖이 밝아졌어.", "happy")
    : hour >= 11 && hour < 17 ? L("왔구나! 오늘 점심은 뭐 먹었어?", "happy")
    : hour >= 17 && hour < 22 ? L("오늘 하루는 어땠어?", "relaxed")
    : L("이 시간까지 안 자고… 나 보러 온 거야?", "surprised");
  return {
    id: "greet",
    lines: [byHour, ...tail],
    choices: [
      { label: "응, 너 보러 왔어", mood: 0.1, affection: 0.01, reply: [L("헤헤, 그럼 오늘도 잘 부탁해!", "happy")] },
      { label: "그냥 들렀어", reply: [L("그냥이라도 좋아.", "relaxed")] },
    ],
  };
}

// ---------------------------------------------------------------- 대화 주제
interface Topic {
  id: string;
  minStage: number;
  build: (ctx: TalkContext) => Scene;
}

const fixed = (id: string, minStage: number, lines: Line[], choices: Choice[]): Topic => ({
  id, minStage, build: () => ({ id, lines, choices }),
});

export const TOPICS: Topic[] = [
  {
    id: "today",
    minStage: 0,
    build: ({ today }) => {
      const lines: Line[] = [];
      lines.push(today.meals
        ? L(`오늘 딸기 ${today.meals}개 먹었어! 내 MN9가 ${Math.round(today.feedSec)}초나 일했대.`, "happy")
        : L("오늘은 아직 아무것도 못 먹었어… MN9가 심심해해.", "sad"));
      lines.push(today.pets
        ? L(`쓰다듬어 준 건 ${today.pets}번, 그루밍 DN은 ${Math.round(today.groomSec)}초 반짝였어.`, "relaxed")
        : L("오늘은 한 번도 안 쓰다듬어 줬지?", "angry"));
      if (today.scares) lines.push(L(`근데 ${today.scares}번이나 놀래켰잖아! Giant Fiber 지쳤어.`, "angry"));
      return {
        id: "today",
        lines,
        choices: [
          { label: "뇌가 열일했네", mood: 0.1, affection: 0.01, reply: [L("헤헤, 그치? 뉴런들한테 전해 줄게.", "happy")] },
          { label: "내일도 챙겨 줄게", mood: 0.05, affection: 0.02, reply: [L("응! 약속!", "happy")] },
        ],
      };
    },
  },
  fixed("strawberry", 0, [L("나 딸기 제일 좋아해! 먹으면 머릿속에서 MN9가 반짝반짝해.", "happy")], [
    { label: "나도 딸기 좋아해", affection: 0.02, reply: [L("우리 취향 통하네!", "happy")] },
    { label: "싫어하는 음식은?", reply: [L("쓴 버섯…", "sad"), L("그건 맛보자마자 발이 뒤로 걸어가.", "angry")] },
  ]),
  fixed("antenna", 0, [L("이 더듬이 말이야, JO라는 감각 뉴런이 있어서 바람이나 소리를 느껴.", "relaxed")], [
    { label: "만져 봐도 돼?", affection: 0.01, reply: [L("살짝만…! 손질하고 싶어질지도 몰라.", "surprised")] },
    { label: "신기하다", affection: 0.01, reply: [L("헤헤, 그치?", "happy")] },
  ]),
  fixed("dream", 1, [L("자는 동안에도 뇌가 가끔 반짝여. 그게 꿈일까?", "relaxed")], [
    { label: "무슨 꿈 꿨어?", reply: [L("딸기 산에서 데굴데굴 굴러떨어지는 꿈…", "surprised")] },
    { label: "좋은 꿈 꿔", affection: 0.02, reply: [L("응, 너 나오는 꿈으로!", "happy")] },
  ]),
  fixed("jump", 1, [L("누가 갑자기 다가오면 Giant Fiber라는 뉴런이 켜져서, 나도 모르게 뛰어올라.", "surprised")], [
    { label: "그래서 놀래키면 뛰는구나", mood: -0.02, reply: [L("알면서 하지 마!", "angry")] },
    { label: "안 놀래킬게", affection: 0.02, reply: [L("약속했다?", "happy")] },
  ]),
  fixed("window", 2, [L("창밖 세상은 어떤 곳이야?", "relaxed")], [
    { label: "넓고 시끄러워", affection: 0.02, reply: [L("무섭다… 그래도 너랑이면 가 보고 싶어.", "relaxed")] },
    { label: "여기가 더 좋아", affection: 0.02, reply: [L("그치? 딸기도 있고, 너도 있고.", "happy")] },
  ]),
  {
    id: "room",
    minStage: 2,
    build: ({ cleanliness }) => cleanliness < 0.6
      ? {
          id: "room",
          lines: [L("방이… 조금 지저분하지?", "sad")],
          choices: [
            { label: "같이 치우자", affection: 0.02, reply: [L("응! 🧹 청소 버튼 눌러 줘~", "happy")] },
            { label: "나중에", mood: -0.05, reply: [L("먼지 뭉치가 친구 될 것 같아…", "sad")] },
          ],
        }
      : {
          id: "room",
          lines: [L("방이 깨끗하니까 기분까지 반짝반짝해!", "happy")],
          choices: [{ label: "네가 좋아하니까", affection: 0.02, reply: [L("…그런 말 하면 날개 파닥거린다고.", "surprised")] }],
        },
  },
  fixed("hand", 3, [L("나, 손잡는 법을 뉴런이 모르는 것 같아. 초파리는 손이 없거든.", "sad")], [
    { label: "내가 알려 줄게", affection: 0.03, reply: [L("…응. 천천히 알려 줘.", "relaxed")] },
    { label: "더듬이로 대신하자", affection: 0.02, reply: [L("그럼 더듬이 걸기다!", "happy")] },
  ]),
  fixed("future", 4, [L("나중에 뉴런이 더 생기면, 너한테 하고 싶은 말도 늘어날까?", "relaxed")], [
    { label: "지금도 충분해", mood: 0.1, affection: 0.02, reply: [L("헤헤… 그럼 지금 말할래. 좋아해♡", "happy")] },
    { label: "기대할게", affection: 0.02, reply: [L("시냅스 열심히 키워 볼게!", "happy")] },
  ]),
];

/** 최근에 안 한 주제 중에서 고른다. "오늘" 이야기는 오늘 기록이 있을 때 우선 */
export function pickTalk(ctx: TalkContext, recent: string[], rand = Math.random): Scene {
  const open = TOPICS.filter((t) => t.minStage <= ctx.stage);
  const fresh = open.filter((t) => !recent.includes(t.id));
  const pool = fresh.length ? fresh : open;
  const hasToday = ctx.today.meals + ctx.today.pets + ctx.today.scares > 0;
  const today = pool.find((t) => t.id === "today");
  const topic = today && hasToday && rand() < 0.4 ? today : pool[Math.floor(rand() * pool.length)];
  return topic.build(ctx);
}
