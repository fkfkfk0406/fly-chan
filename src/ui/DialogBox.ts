import type { Choice, Expr, Line, Scene } from "../story/scripts.ts";

export interface DialogHooks {
  onOpen(): void;
  onClose(): void;
  onExpr(expr: Expr | undefined): void;
  /** 글자가 찍히는 동안 true (입 모양·효과음) */
  onTyping(typing: boolean): void;
  onChoice(choice: Choice): void;
  onTick(): void;
}

const CHAR_MS = 32;

/** 미연시식 대화창: 타자기 효과, 탭으로 넘기기, 선택지 */
export class DialogBox {
  private readonly root: HTMLElement;
  private readonly text: HTMLElement;
  private readonly choices: HTMLElement;
  private readonly next: HTMLElement;
  private advance: (() => void) | null = null;
  private skipTyping: (() => void) | null = null;
  open = false;

  constructor(root: HTMLElement, private readonly hooks: DialogHooks) {
    this.root = root;
    this.text = root.querySelector(".dialog-text")!;
    this.choices = root.querySelector(".dialog-choices")!;
    this.next = root.querySelector(".dialog-next")!;
    root.addEventListener("click", () => this.tap());
    window.addEventListener("keydown", (e) => {
      if (this.open && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        this.tap();
      }
    });
  }

  private tap(): void {
    if (this.skipTyping) this.skipTyping();
    else this.advance?.();
  }

  async play(scene: Scene): Promise<void> {
    if (this.open) return;
    this.open = true;
    this.root.hidden = false;
    this.hooks.onOpen();
    try {
      for (const line of scene.lines) await this.say(line);
      if (scene.choices?.length) {
        const choice = await this.ask(scene.choices);
        this.hooks.onChoice(choice);
        for (const line of choice.reply) await this.say(line);
      }
    } finally {
      this.root.hidden = true;
      this.open = false;
      this.hooks.onExpr(undefined);
      this.hooks.onClose();
    }
  }

  private async say(line: Line): Promise<void> {
    this.hooks.onExpr(line.expr);
    this.choices.replaceChildren();
    this.next.hidden = true;
    await this.type(line.text);
    this.next.hidden = false;
    await new Promise<void>((resolve) => (this.advance = resolve));
    this.advance = null;
  }

  private type(text: string): Promise<void> {
    return new Promise((resolve) => {
      const chars = [...text];
      let i = 0;
      this.text.textContent = "";
      this.hooks.onTyping(true);
      const finish = () => {
        clearInterval(timer);
        this.text.textContent = text;
        this.skipTyping = null;
        this.hooks.onTyping(false);
        resolve();
      };
      const timer = setInterval(() => {
        this.text.textContent += chars[i++];
        if (i % 2 === 0) this.hooks.onTick();
        if (i >= chars.length) finish();
      }, CHAR_MS);
      this.skipTyping = finish;
    });
  }

  private ask(choices: Choice[]): Promise<Choice> {
    this.next.hidden = true;
    return new Promise((resolve) => {
      this.choices.replaceChildren(
        ...choices.map((choice) => {
          const btn = document.createElement("button");
          btn.textContent = choice.label;
          btn.onclick = (e) => {
            e.stopPropagation();
            this.choices.replaceChildren();
            resolve(choice);
          };
          return btn;
        }),
      );
      (this.choices.firstElementChild as HTMLElement | null)?.focus();
    });
  }
}
