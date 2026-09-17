// 실제 시각에 맞춘 생체시계.
// 뇌: 시계 뉴런(LNv·LNd·DN1)을 시간대에 맞춰 켠다. 실제 시계 뉴런은 신경펩타이드(PDF)로 작동해
//   시냅스만 있는 이 모델에서는 하강·운동 뉴런에 영향이 없다 (scripts/clock-probe.ts) → "뇌가 지금 몇 시인지" 보여 주는 표시.
// 게임: 같은 시계로 졸림이 쌓이는 속도를 바꾼다 (게임 규칙).

/** 시계 뉴런 최대 자극 (Hz). 다른 입력과 겹쳐도 폭주 없음 */
export const CLOCK_MAX_HZ = 30;

/** 0-24 시간 사이의 원형 거리 */
const hourDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
};
const bump = (h: number, center: number, width: number) => Math.exp(-(hourDist(h, center) ** 2) / (2 * width * width));

/** 시각(0-24, 소수) → 시계 뉴런 무리별 활동 0-1 */
export function clockActivity(hour: number): { lnv: number; lnd: number; dn1: number } {
  const day = hour >= 6 && hour < 18;
  return {
    lnv: Math.max(bump(hour, 7.5, 2), day ? 0.3 : 0), // 아침·낮 각성
    lnd: bump(hour, 19, 2), // 저녁 활동
    dn1: Math.max(bump(hour, 6, 1.2), bump(hour, 20.5, 1.2)), // 새벽·해질녘
  };
}

/** 깨어 있을 때 졸림이 쌓이는 배수: 밤에는 빨리, 아침에는 천천히 */
export function sleepinessFactor(hour: number): number {
  if (hour >= 22 || hour < 6) return 1.8;
  if (hour >= 6 && hour < 10) return 0.6;
  return 1;
}

export const hourOf = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() + d.getMinutes() / 60;
};
