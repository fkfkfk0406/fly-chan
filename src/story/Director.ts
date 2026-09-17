import { type Care, localDay } from "../care/Care.ts";
import type { DialogBox } from "../ui/DialogBox.ts";
import { sulkScene } from "./away.ts";
import { memoryOf, replayable } from "./memories.ts";
import { DEFAULT_NAMES, personalize } from "./personalize.ts";
import { INTRO_SCENE, STAGE_SCENES, greetingScene, pickTalk, type Scene } from "./scripts.ts";

/** 어떤 장면을 언제 틀지 정한다: 관계 단계 이벤트 > 대기 중인 인사 > (사용자가 부른) 대화 */
export class Director {
  private queue: Scene[] = [];
  onStageUp: (stage: number) => void = () => {};

  constructor(
    private readonly care: Care,
    private readonly dialog: DialogBox,
  ) {
    // 앨범이 생기기 전에 본 장면도 추억으로 남긴다
    const seen = care.s.memories;
    if (care.s.introDone && !seen.includes("intro")) seen.push("intro");
    for (let i = 1; i <= care.s.stageSeen; i++) if (!seen.includes(`stage-${i}`)) seen.push(`stage-${i}`);
  }

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
    this.queue.push(
      this.care.s.sulk > 0
        ? sulkScene(this.care.s.sulkWhy === "jealous")
        : greetingScene(new Date(now).getHours(), this.care.awayHours, this.care.s.hunger),
    );
    this.care.awayHours = 0;
  }

  /** 이스터에그 같은 특별 장면을 대기열에 넣는다 */
  queueScene(scene: Scene): void {
    this.queue.push(scene);
  }

  /** 말 걸기 */
  talk(now: number): void {
    if (this.dialog.open) return;
    const care = this.care;
    const today = care.todayStats(now);
    if (care.s.sulk > 0) {
      today.talks++;
      this.play(sulkScene(care.s.sulkWhy === "jealous"));
      return;
    }
    const scene = pickTalk({ stage: care.s.stageSeen, today, cleanliness: care.cleanliness, hunger: care.s.hunger }, care.s.recentTalks);
    care.s.recentTalks = [scene.id, ...care.s.recentTalks.filter((id) => id !== scene.id)].slice(0, 8);
    today.talks++;
    this.play(scene);
  }

  /** 추억 앨범에서 다시 보기 */
  replay(id: string): boolean {
    const memory = memoryOf(id);
    if (this.dialog.open || !memory || !this.care.s.memories.includes(id)) return false;
    this.play(replayable(memory.scene));
    return true;
  }

  /** 대사 속 {name}·{me} 를 채워서 튼다 */
  private play(scene: Scene): void {
    if (memoryOf(scene.id) && !this.care.s.memories.includes(scene.id)) this.care.s.memories.push(scene.id);
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
