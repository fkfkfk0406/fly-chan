import { type Care, localDay } from "../care/Care.ts";
import type { DialogBox } from "../ui/DialogBox.ts";
import { DEFAULT_NAMES, personalize } from "./personalize.ts";
import { INTRO_SCENE, STAGE_SCENES, greetingScene, pickTalk, type Scene } from "./scripts.ts";

/** 어떤 장면을 언제 틀지 정한다: 관계 단계 이벤트 > 대기 중인 인사 > (사용자가 부른) 대화 */
export class Director {
  private queue: Scene[] = [];
  onStageUp: (stage: number) => void = () => {};

  constructor(
    private readonly care: Care,
    private readonly dialog: DialogBox,
  ) {}

  /** 오늘 처음이거나 오래 비웠다 왔으면 인사를 대기열에 넣는다 */
  greetIfNeeded(now: number): void {
    const day = localDay(now);
    if (!this.care.s.introDone) {
      this.care.s.introDone = true;
      this.care.s.greetedDay = day;
      this.care.awayHours = 0;
      this.queue.push(INTRO_SCENE);
      return;
    }
    if (this.care.s.greetedDay === day && this.care.awayHours < 12) return;
    this.care.s.greetedDay = day;
    this.queue.push(greetingScene(new Date(now).getHours(), this.care.awayHours, this.care.s.hunger));
    this.care.awayHours = 0;
  }

  /** 말 걸기 */
  talk(now: number): void {
    if (this.dialog.open) return;
    const care = this.care;
    const today = care.todayStats(now);
    const scene = pickTalk({ stage: care.s.stageSeen, today, cleanliness: care.cleanliness, hunger: care.s.hunger }, care.s.recentTalks);
    care.s.recentTalks = [scene.id, ...care.s.recentTalks.filter((id) => id !== scene.id)].slice(0, 8);
    today.talks++;
    this.play(scene);
  }

  /** 대사 속 {name}·{me} 를 채워서 튼다 */
  private play(scene: Scene): void {
    const names = { name: this.care.s.name || DEFAULT_NAMES.name, me: this.care.s.callMe || DEFAULT_NAMES.me };
    const fill = (lines: Scene["lines"]) => lines.map((l) => ({ ...l, text: personalize(l.text, names) }));
    this.dialog.setSpeaker(names.name);
    void this.dialog.play({
      ...scene,
      lines: fill(scene.lines),
      choices: scene.choices?.map((c) => ({ ...c, label: personalize(c.label, names), reply: fill(c.reply) })),
    });
  }

  /** 매 프레임. canPlay 가 아니면(자는 중, 도약 중 등) 기다린다 */
  update(now: number, canPlay: boolean): void {
    if (this.dialog.open || !canPlay) return;
    const stage = this.care.pendingStage();
    if (stage !== null) {
      this.care.markStageSeen(stage, now);
      this.onStageUp(stage);
      this.play(STAGE_SCENES[stage]);
      return;
    }
    const next = this.queue.shift();
    if (next) this.play(next);
  }
}
