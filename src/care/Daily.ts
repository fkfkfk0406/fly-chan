// 매일 돌아오게 만드는 것: 연속 출석 보상과 오늘의 부탁 3개
import { type Care, type Totals, localDay } from "./Care.ts";

/** 연속 출석 n일째 보상 (7일마다 반복) */
export const ATTEND_REWARDS = [5, 5, 10, 10, 15, 20, 50];

export interface Quest {
  id: keyof Totals;
  goal: number;
  label: string;
  reward: number;
}

export const QUEST_POOL: Quest[] = [
  { id: "pets", goal: 5, label: "5번 쓰다듬어 주기", reward: 10 },
  { id: "meals", goal: 3, label: "간식 3번 먹이기", reward: 10 },
  { id: "talks", goal: 3, label: "3번 대화하기", reward: 10 },
  { id: "cleans", goal: 3, label: "얼룩 3개 치우기", reward: 10 },
  { id: "photos", goal: 1, label: "사진 한 장 찍기", reward: 8 },
  { id: "grooms", goal: 2, label: "더듬이 손질 2번 보기", reward: 12 },
  { id: "sleeps", goal: 1, label: "불 끄고 재우기", reward: 10 },
];
export const QUESTS_PER_DAY = 3;
export const ALL_QUESTS_BONUS = 20;

/** 오늘 처음이면 출석 도장을 찍고 보상을 준다 */
export function checkIn(care: Care, now: number): { streak: number; reward: number } | null {
  const a = care.s.attend;
  const today = localDay(now);
  if (a.last === today) return null;
  a.streak = a.last === localDay(now - 86_400_000) ? a.streak + 1 : 1;
  a.last = today;
  const reward = ATTEND_REWARDS[(a.streak - 1) % ATTEND_REWARDS.length];
  care.s.hearts += reward;
  care.log(now, `📅 출석 ${a.streak}일째 (+${reward} 하트)`);
  return { streak: a.streak, reward };
}

/** 날짜가 바뀌었으면 그날의 부탁을 새로 고른다 (날짜로 정해지므로 다시 열어도 같다) */
export function refreshQuests(care: Care, now: number): void {
  const day = localDay(now);
  if (care.s.quests.day === day) return;
  const pool = [...QUEST_POOL];
  let h = [...day].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const ids: string[] = [];
  while (ids.length < QUESTS_PER_DAY) {
    h = (h * 1103515245 + 12345) >>> 0;
    ids.push(pool.splice((h >>> 8) % pool.length, 1)[0].id);
  }
  care.s.quests = { day, ids, base: { ...care.s.totals }, claimed: [] };
}

export interface QuestStatus {
  quest: Quest;
  progress: number;
  done: boolean;
  claimed: boolean;
}

export function questStatus(care: Care, now: number): QuestStatus[] {
  refreshQuests(care, now);
  const q = care.s.quests;
  return q.ids.map((id) => {
    const quest = QUEST_POOL.find((x) => x.id === id)!;
    const progress = Math.min(quest.goal, Math.max(0, care.s.totals[quest.id] - (q.base[quest.id] ?? 0)));
    return { quest, progress, done: progress >= quest.goal, claimed: q.claimed.includes(id) };
  });
}

/** 새로 끝낸 부탁의 하트를 준다. 셋 다 끝냈으면 보너스까지 */
export function claimQuests(care: Care, now: number): { done: Quest[]; bonus: number } {
  const done: Quest[] = [];
  for (const st of questStatus(care, now)) {
    if (!st.done || st.claimed) continue;
    care.s.quests.claimed.push(st.quest.id);
    care.s.hearts += st.quest.reward;
    care.log(now, `📋 오늘의 부탁 '${st.quest.label}' 완료 (+${st.quest.reward} 하트)`);
    done.push(st.quest);
  }
  const q = care.s.quests;
  const bonus = done.length > 0 && q.claimed.length === q.ids.length ? ALL_QUESTS_BONUS : 0;
  if (bonus) {
    care.s.hearts += bonus;
    care.bump(0.1);
    care.log(now, `📋 오늘의 부탁을 전부 들어줬어요 (+${bonus} 하트)`);
  }
  return { done, bonus };
}
