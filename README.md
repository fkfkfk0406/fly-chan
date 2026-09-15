# ONNA: 초파리 뇌를 가진 소녀

초파리 전뇌 커넥톰(FlyWire v783, 뉴런 138,639개, 시냅스 5,449만 개)을 브라우저에서 LIF 모델로 실시간으로 돌리고, 그 출력으로 3D 캐릭터(VRM)를 움직이는 웹 앱입니다.

| 패널 | 내용 |
|---|---|
| 01 NEURAL FIELD | 전체 뉴런 점 구름과 실시간 발화, 하강·운동 뉴런 발화율, 현재 걸린 감각 입력 |
| 02 BODY CAM | 온나(VRM + 더듬이·날개)의 동작과 그 동작을 일으킨 뉴런 |
| 03 HABITAT MAP | 같은 공간의 상공 화면. 클릭하면 딸기, Shift+클릭하면 쓴 버섯을 놓습니다 |

하단에서 일시정지, 먹이 놓기, 위협(루밍), 더듬이 쓰다듬기, 빛 입력 켜기/끄기, 최근 200초 재시청을 할 수 있습니다.
단축키는 Space(재생/정지), F(딸기), T(위협), P(쓰다듬기)입니다.

## 실행

```bash
npm install
python -m venv pipeline/.venv
pipeline/.venv/Scripts/python -m pip install pandas pyarrow numpy   # macOS/Linux: pipeline/.venv/bin/python
npm run data      # 원본 약 140 MB 다운로드 → public/data/ 에 약 91 MB 바이너리 생성, VRM 모델 다운로드
npm run dev       # http://localhost:5173
```

- `?dt=0.25`처럼 적분 간격을 바꿀 수 있습니다. 기본값은 0.5 ms입니다.
- `?adapt=300:1`처럼 발화 빈도 적응을 켤 수 있습니다(τw 300 ms, 발화당 1 mV). 기본은 꺼져 있습니다(아래 "적응" 참고).
- `npm test`는 엔진 테스트입니다. 합성 네트워크 검증과, 실제 커넥톰에서 논문 결과를 재현하는지 확인합니다.
- `npm run probe -- sugar:150`은 감각 그룹을 자극하고 가장 많이 발화한 하강·운동 뉴런을 출력합니다.
- `node scripts/bench.ts`는 대표 상황에서 시뮬 속도를 잽니다.
- `node scripts/adapt.ts 300:1 500:2`는 적응 파라미터별로 감각 적응, 냄새 폭주, 속도를 한 번에 비교합니다.

## 동작 원리

```
감각 사건(먹이 접촉, 벽, 위협, 빛) ──Poisson 입력──▶ LIF 전뇌 (Web Worker)
                                                        │ 하강·운동 뉴런 발화율
                                                        ▼
       VRM 포즈·표정·날개 ◀── 행동 선택 + VNC 대역 ◀── Controller
```

**뇌 (`src/sim/lif-engine.ts`)**
Shiu et al. 2024 (Nature) Brian2 모델과 같은 방정식과 파라미터를 씁니다.
- 방정식: `dv/dt = (v0 − v + g)/τm`, `dg/dt = −g/τs`
- 파라미터: 시냅스당 0.275 mV, 지연 1.8 ms, 불응기 2.2 ms
- 적분: 정확해로 적분하고, 휴지에서 벗어난 뉴런만 갱신합니다.

**입출력 뉴런 (`pipeline/build_connectome.py`)**

| 입력 | 뉴런 | 출력 | 뉴런 |
|---|---|---|---|
| 먹이 접촉 | 당 GRN | 섭식 | MN9 |
| 쓴 먹이 | 쓴맛 GRN | 도약 | Giant Fiber (DNp01) |
| 벽·쓰다듬기 | JO-F | 그루밍 | DNg84·DNg29·DNg57 |
| 위협 | LPLC2 | 전진 / 후진 | DNp09 (P9) / MDN |
| 빛 | R7·R8 | 회전 | 좌우 DNa01·DNa02 |

**테스트로 확인한 재현 결과** (`tests/lif-engine.test.ts`)
- 당 GRN → MN9 발화
- 쓴맛 동시 자극 → MN9 억제
- JO-F → 그루밍 DN
- LPLC2 → Giant Fiber
- 자극이 없으면 전뇌가 조용함
- (합성 네트워크) 지연·불응기 타이밍, 적응을 켜면 지속 자극에서 발화율 감소

## 한계와 설계상 선택

- **VNC가 없습니다.** FlyWire는 뇌만 포함하므로 보행 리듬 생성기, 벽 회피, 탐색·배고픔·피로 드라이브는 `src/behavior/Controller.ts`에서 절차적으로 만듭니다. 섭식·그루밍·도약은 뇌 출력이 결정하고, P9·MDN·DNa01/02 발화는 속도와 회전에 더해집니다. UI의 "원인" 줄에 행동마다 뇌 출력인지 VNC 드라이브인지 표시합니다.
- **후각 입력은 뺐습니다.** 식초 계열 ORN(DM1·VA2·DM4)을 10 Hz로만 자극해도, 자극을 끊은 뒤 약 1만 개 뉴런이 계속 발화하는 폭주 상태에 빠집니다(`scripts/persist.ts`). 그래서 먹이를 찾아가는 것은 VNC 드라이브가 맡습니다. 원인을 추적한 결과는 이렇습니다.
  - 폭주 발화의 40%는 Kenyon cell이지만, KC 출력을 모두 끊어도 폭주는 계속됩니다. KC는 원인이 아니라 결과입니다.
  - 더듬이엽 국소 뉴런(ALLN, 429개) 출력을 끊으면 폭주가 사라집니다. 이 뉴런들은 신경전달물질 예측 신뢰도가 평균 0.46으로 낮고, 실제로는 대부분 억제성인데 아세틸콜린·세로토닌·도파민으로 예측돼 흥분성으로 들어간 경우가 많습니다.
  - 다만 부호를 보정해도 실험으로 확인된 흥분성 LN을 살리면 폭주가 일부 남고, 폭주를 잡아도 좌우 냄새가 회전 DN의 좌우 차이로 이어지지 않아 냄새 추적에는 쓸 수 없었습니다.
- **적응은 옵션입니다.** 발화할 때마다 커지고 천천히 사라지는 적응 전류를 엔진에 넣었습니다(`Adaptation`, 원 모델에 없음). 모든 뉴런에 같은 적응을 걸면 절충이 생깁니다(dt 0.5 ms, `scripts/adapt.ts`).

  | 설정 | 당 150 Hz 3초 동안 MN9 (0.5초 단위) | 냄새를 끊은 뒤 300-600 ms 발화 |
  |---|---|---|
  | 적응 없음 | 112 → 92 Hz | 262,413 |
  | τw 300 ms, b 1 mV | 44 → 30 Hz | 85,090 |
  | τw 500 ms, b 2 mV | 16 → 4 Hz | 0 |

  폭주를 멈출 만큼 세게 걸면 섭식 반응이 거의 사라져서, 기본값은 끔으로 두었습니다.
- **그루밍 DN은 데이터로 골랐습니다.** JO-F 자극에 선택적으로 반응하는 하강뉴런을 `scripts/probe.ts`로 찾았습니다.
- **dt 0.5 ms**는 Brian2 기본값(0.1 ms)보다 거칠지만, 위 재현 테스트는 dt 0.25와 0.5에서 모두 통과합니다. 루밍 자극 직후처럼 수만 개 뉴런이 활성화되면 시뮬이 실시간보다 느려지고, 세계도 같은 비율로 느려집니다(시뮬 속도 표시).

## 데이터·모델 출처

- FlyWire 커넥톰 v783: Dorkenwald et al. 2024, Schlegel et al. 2024 (Nature). 연결 행렬은 [philshiu/Drosophila_brain_model](https://github.com/philshiu/Drosophila_brain_model), 주석·좌표는 [flyconnectome/flywire_annotations](https://github.com/flyconnectome/flywire_annotations)에서 받습니다.
- LIF 모델: Shiu et al. 2024, *A Drosophila computational brain model reveals sensorimotor processing*, Nature.
- 캐릭터: pixiv `VRM1_Constraint_Twist_Sample` (VRM Public License 1.0. 누구나 사용, 상업 이용, 수정·재배포 허용, 표기 불필요). `public/models/onna.vrm`을 다른 VRM으로 바꿔도 동작하며, 불러오지 못하면 도형 인형으로 대체합니다.
