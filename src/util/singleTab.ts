// 탭 하나만 돌린다. 두 탭이 같은 저장(localStorage)을 10초마다 번갈아 덮어써 하트·구매가 사라지는 것을 막는다.
// 먼저 연 탭이 닫히면 기다리던 탭이 이어서 시작한다.

const LOCK = "fly-chan-tab";

/** 이 탭이 주인이 될 때까지 기다린다. 다른 탭이 이미 열려 있으면 onWait 을 먼저 부른다 */
export function claimTab(onWait: () => void): Promise<void> {
  const locks = navigator.locks;
  if (!locks) return Promise.resolve(); // 지원 안 하는 브라우저는 막지 않는다
  return new Promise((resolve) => {
    // 잠금은 콜백이 돌려준 Promise 가 끝날 때까지 쥐고 있으니, 끝나지 않는 Promise 로 페이지가 닫힐 때까지 쥔다
    const hold = () => {
      resolve();
      return new Promise<never>(() => {});
    };
    void locks.request(LOCK, { ifAvailable: true }, (lock) => {
      if (lock) return hold();
      onWait();
      void locks.request(LOCK, hold);
      return undefined;
    });
  });
}
