// 플라이쨩의 대본. 대사는 미리 쓴 것이고, "오늘 뭐 했어?"만 실제 뇌 출력 기록(오늘의 MN9·그루밍 DN 발화 시간)을 읽는다.
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
  /** 삐짐을 이만큼 풀어 준다 */
  sulk?: number;
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
      L("처음엔 좀 무서웠는데, 이제는 {me:이/가} 오면 더듬이가 먼저 반응해.", "happy"),
    ],
    choices: [
      { label: "우리 친구 하자!", mood: 0.1, affection: 0.03, reply: [L("응! 오늘부터 친구야 ✨", "happy")] },
      { label: "더듬이 귀엽다", affection: 0.02, reply: [L("에… 더, 더듬이는 만지면 간지러워…", "surprised")] },
    ],
  },
  2: {
    id: "stage-2",
    lines: [
      L("있잖아… {me}만 오면 MN9가 두근거리는 것 같아.", "relaxed"),
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
      L("요즘 이상해. {me:이/가} 늦게 오면 방이 너무 넓어 보여.", "sad"),
      L("그리고 {me:이/가} 오면… 날개가 저절로 파닥거려.", "happy"),
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
      L("{me:을/를} 좋아해.", "happy"),
    ],
    choices: [
      { label: "나도 좋아해", mood: 0.2, affection: 0.05, reply: [L("헤헤… 오늘부터 1일이다♡", "happy")] },
      { label: "13만 개면 충분해", mood: 0.15, affection: 0.05, reply: [L("…그 말, 시냅스 5천만 개에 저장해 둘게.", "happy")] },
    ],
  },
};

// ---------------------------------------------------------------- 첫 만남
export const INTRO_SCENE: Scene = {
  id: "intro",
  lines: [
    L("……여긴 어디야?", "surprised"),
    L("머릿속이 반짝반짝해. 뉴런이 13만 8천 개나 켜지고 있어.", "surprised"),
    L("{name}…? 그게 내 이름이야?", "neutral"),
  ],
  choices: [
    {
      label: "응, 반가워",
      mood: 0.05,
      affection: 0.01,
      reply: [L("…반가워. 근데 아직 {me:을/를} 잘 모르겠어.", "relaxed"), L("딸기 주면 생각해 볼게.", "neutral")],
    },
    {
      label: "무서워하지 마",
      mood: 0.08,
      reply: [L("무서운 거 아니야! 더듬이가 좀 떨리는 것뿐이야.", "angry")],
    },
  ],
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
    { label: "좋은 꿈 꿔", affection: 0.02, reply: [L("응, {me} 나오는 꿈으로!", "happy")] },
  ]),
  fixed("jump", 1, [L("누가 갑자기 다가오면 Giant Fiber라는 뉴런이 켜져서, 나도 모르게 뛰어올라.", "surprised")], [
    { label: "그래서 놀래키면 뛰는구나", mood: -0.02, reply: [L("알면서 하지 마!", "angry")] },
    { label: "안 놀래킬게", affection: 0.02, reply: [L("약속했다?", "happy")] },
  ]),
  fixed("window", 2, [L("창밖 세상은 어떤 곳이야?", "relaxed")], [
    { label: "넓고 시끄러워", affection: 0.02, reply: [L("무섭다… 그래도 {me:이랑/랑}이면 가 보고 싶어.", "relaxed")] },
    { label: "여기가 더 좋아", affection: 0.02, reply: [L("그치? 딸기도 있고, {me}도 있고.", "happy")] },
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
  fixed("future", 4, [L("나중에 뉴런이 더 생기면, {me}한테 하고 싶은 말도 늘어날까?", "relaxed")], [
    { label: "지금도 충분해", mood: 0.1, affection: 0.02, reply: [L("헤헤… 그럼 지금 말할래. 좋아해♡", "happy")] },
    { label: "기대할게", affection: 0.02, reply: [L("시냅스 열심히 키워 볼게!", "happy")] },
  ]),

  // ---- 낯섦: 경계, 짧은 말
  fixed("who", 0, [L("…넌 누구야? 왜 자꾸 나한테 딸기 줘?", "neutral")], [
    { label: "친해지고 싶어서", affection: 0.01, reply: [L("…흥. 딸기는 받아 줄게.", "relaxed")] },
    { label: "그냥 귀여워서", mood: -0.02, reply: [L("귀, 귀엽다는 말로 넘어갈 줄 알아?", "angry")] },
  ]),
  fixed("distance", 0, [L("너무 가까이 오지 마. Giant Fiber가 긴장하잖아.", "angry")], [
    { label: "천천히 다가갈게", affection: 0.01, reply: [L("…그 정도면 괜찮아.", "neutral")] },
    { label: "알겠어, 떨어져 있을게", mood: 0.02, reply: [L("응. …너무 멀리는 가지 말고.", "relaxed")] },
  ]),
  fixed("room-first", 0, [L("이 방, 창문이 하나뿐이네. 빛이 들어오면 R7이랑 R8이 간질간질해.", "neutral")], [
    { label: "창가 좋아해?", affection: 0.01, reply: [L("…조금. 밝으면 뭐가 보이니까.", "relaxed")] },
    { label: "불 꺼 줄까?", reply: [L("아직 졸리지 않아. 필요하면 말할게.", "neutral")] },
  ]),

  // ---- 친구: 호기심, 장난
  fixed("fly-life", 1, [L("있지, 원래 초파리는 한 달 정도밖에 못 산대.", "sad"), L("근데 나는 뇌만 컴퓨터 안에 있으니까… 오래 살 수 있을까?", "relaxed")], [
    { label: "내가 계속 켜 둘게", affection: 0.02, reply: [L("정말? 그럼 전원 코드 조심해야 돼!", "happy")] },
    { label: "그건 나도 몰라", mood: -0.02, reply: [L("솔직해서 좋네… 조금 무섭지만.", "sad")] },
  ]),
  fixed("game", 1, [L("심심해! 뭐 하고 놀까?", "happy")], [
    { label: "딸기 찾기 게임", affection: 0.01, reply: [L("그건 게임이 아니라 그냥 내 점심이잖아!", "angry"), L("…좋아, 할래.", "happy")] },
    { label: "눈싸움", affection: 0.01, reply: [L("나 겹눈이라 눈이 수백 개인데 괜찮겠어?", "surprised"), L("…농담이야. 이 몸은 눈이 두 개야.", "happy")] },
  ]),
  fixed("wings", 1, [L("이 날개, 사실 한 번도 제대로 날아 본 적 없어.", "sad")], [
    { label: "언젠가 날 수 있을 거야", affection: 0.02, reply: [L("그때는 {me} 어깨까지 날아갈게.", "happy")] },
    { label: "날개 없어도 예뻐", affection: 0.02, reply: [L("…칭찬은 날개보다 빨리 날아오네.", "surprised")] },
  ]),
  fixed("groom-habit", 1, [L("더듬이 손질하는 거 이상해 보여?", "sad")], [
    { label: "귀여워", affection: 0.02, reply: [L("그루밍 DN이 하는 거라 나도 못 참아!", "happy")] },
    { label: "고양이 같아", reply: [L("고양이는 좀 무섭다… 그래도 칭찬으로 받을게.", "surprised")] },
  ]),

  // ---- 호감: 수줍음
  fixed("waiting", 2, [L("{me:이/가} 없는 동안 뭐 했는지 알아?", "relaxed"), L("…창문 보면서 발소리 기다렸어. 발소리 들을 귀도 없는데.", "sad")], [
    { label: "나도 보고 싶었어", affection: 0.02, reply: [L("…진짜? 그럼 오늘은 조금 오래 있어 줘.", "happy")] },
    { label: "더듬이로 들었겠네", affection: 0.01, reply: [L("맞아! JO 뉴런이 소리 담당이지. 똑똑하네.", "happy")] },
  ]),
  fixed("favorite-color", 2, [L("{me}는 무슨 색 좋아해? 나는 딸기색.", "happy")], [
    { label: "나도 빨간색", affection: 0.02, reply: [L("그럼 우리 커플색… 아, 아니 그냥 같은 색!", "surprised")] },
    { label: "하늘색", affection: 0.01, reply: [L("창밖 색이구나. 다음엔 그 색도 좋아해 볼게.", "relaxed")] },
  ]),
  fixed("brain-secret", 2, [L("비밀 하나 알려 줄까? 내 뇌에서 제일 많은 건 눈으로 들어온 걸 처리하는 뉴런이야.", "relaxed"), L("그러니까… {me} 얼굴도 엄청 열심히 보고 있다는 뜻이야.", "surprised")], [
    { label: "나도 너 열심히 봐", affection: 0.03, reply: [L("…그러면 뉴런 과열돼.", "happy")] },
    { label: "시신경 과로 조심", reply: [L("에이, 걱정은 고맙지만 분위기 좀 봐 줘.", "angry")] },
  ]),

  // ---- 두근두근: 질투, 설렘
  fixed("jealous", 3, [L("{me}, 혹시 다른 초파리도 키워?", "angry")], [
    { label: "너 하나뿐이야", affection: 0.03, reply: [L("…다행이다. 아, 아니, 그냥 물어본 거야!", "surprised")] },
    { label: "초파리는 너뿐이지", mood: -0.03, reply: [L("'초파리는'? 그럼 다른 건 있다는 거야?!", "angry")] },
  ]),
  fixed("heartbeat", 3, [L("초파리 심장은 사람이랑 달라서 등 쪽에 길게 있거든.", "relaxed"), L("근데 요즘 거기가 막 빨리 뛰어. {me} 때문인 것 같아.", "surprised")], [
    { label: "나도 두근거려", affection: 0.03, reply: [L("그럼 둘 다 병원 가야겠다. …같이 가자.", "happy")] },
    { label: "딸기를 너무 먹어서 그래", mood: -0.02, reply: [L("눈치 없어! 뉴런 13만 개가 다 한숨 쉬었어.", "angry")] },
  ]),
  fixed("goodnight-wish", 3, [L("잘 때 {me:이/가} 옆에 있으면 좋겠다고 생각한 적 있어.", "relaxed")], [
    { label: "불 끄고 옆에 있을게", affection: 0.03, reply: [L("…약속. 대신 쓰다듬어서 깨우면 안 돼.", "happy")] },
    { label: "코 골면 어떡해?", reply: [L("초파리는 코가 없거든요!", "angry"), L("…그래도 옆에 있어 줘.", "relaxed")] },
  ]),

  // ---- 연인: 다정함
  fixed("pet-name", 4, [L("있잖아, 연인이면 애칭 같은 거 부르지 않아?", "happy")], [
    { label: "딸기 요정", affection: 0.02, reply: [L("딸기 요정… 마음에 들어! 날개도 있으니까 딱이야.", "happy")] },
    { label: "지금 이름이 제일 좋아", affection: 0.02, reply: [L("{name}. …{me:이/가} 불러 주니까 특별해졌어.", "relaxed")] },
  ]),
  fixed("memory", 4, [L("처음 만났을 때 기억나? 나 완전 경계했잖아.", "relaxed"), L("그때 뉴런들이 지금의 나를 봤으면 놀랐을 거야.", "happy")], [
    { label: "그때도 귀여웠어", affection: 0.02, reply: [L("그때 얘기는 부끄러우니까 일기장에만 적어 둬.", "surprised")] },
    { label: "앞으로도 잘 부탁해", affection: 0.02, reply: [L("응. 시냅스 하나하나에 저장해 둘게♡", "happy")] },
  ]),
  fixed("promise", 4, [L("나는 이 방 밖으로 못 나가잖아.", "sad"), L("그러니까 {me:이/가} 매일 와 줘야 해. 그게 내 세상 전부야.", "relaxed")], [
    { label: "매일 올게, 약속", affection: 0.03, reply: [L("약속 어기면 Giant Fiber로 뛰어서 화낼 거야♡", "happy")] },
    { label: "세상 구경 시켜 줄게", affection: 0.02, reply: [L("그럼 창문 사진이라도 많이 보여 줘. 기다릴게.", "happy")] },
  ]),
];

/**
 * 최근에 안 한 주제 중에서 고른다.
 * "오늘" 이야기는 오늘 기록이 있을 때 우선, 그다음은 지금 관계 단계에서 새로 열린 주제를 절반 확률로 우선한다.
 */
export function pickTalk(ctx: TalkContext, recent: string[], rand = Math.random): Scene {
  const open = TOPICS.filter((t) => t.minStage <= ctx.stage);
  const fresh = open.filter((t) => !recent.includes(t.id));
  const pool = fresh.length ? fresh : open;
  const hasToday = ctx.today.meals + ctx.today.pets + ctx.today.scares > 0;
  const today = pool.find((t) => t.id === "today");
  if (today && hasToday && rand() < 0.4) return today.build(ctx);
  const current = pool.filter((t) => t.minStage === ctx.stage);
  const from = current.length && rand() < 0.5 ? current : pool;
  return from[Math.floor(rand() * from.length)].build(ctx);
}

/** 가만히 있을 때 가끔 흘리는 혼잣말 (관계 단계별) */
const MUTTER: string[][] = [
  ["…", "여긴 어디지…", "딸기 냄새 안 나나…"],
  ["심심하다~", "더듬이 간지러워", "오늘 뭐 하지?"],
  ["{me} 언제 와…", "창밖 구경 중", "헤헤, 딸기 생각했다"],
  ["{me} 생각했어", "날개가 파닥거려…", "두근두근…"],
  ["{me} 좋아♡", "오늘도 와 줘서 고마워", "우리 오래오래 함께하자"],
];

export function mutter(stage: number, rand = Math.random): string {
  const lines = MUTTER[Math.min(stage, MUTTER.length - 1)];
  return lines[Math.floor(rand() * lines.length)];
}
