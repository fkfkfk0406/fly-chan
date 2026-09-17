# 다른 PC에서 이어서 하기 + 검증 체크리스트

2026-09-17 회사 노트북에서 작업을 멈추고 집 PC에서 검증·테스트하려고 남긴 메모입니다.
Claude Code의 기억은 PC마다 따로라서, 새 PC에서는 "`docs/NEW-PC.md`랑 `docs/PROGRESS.md` 읽고 이어서 하자"로 시작하세요.

## 0. 떠나기 전에 (회사 노트북)

- [ ] **서명 개인 키 복사:** `C:\Users\ehdus\.tauri\fly-chan.key`(와 `.pub`)을 비밀번호 관리자나 개인 저장소에 옮겨 두기.
  - GitHub Secret에도 들어 있지만 Secret은 다시 읽을 수 없습니다.
  - 이 키가 없으면 **집에서 `npm run desktop:build`(로컬 설치 파일 빌드)가 서명 단계에서 실패**합니다. Actions 빌드는 Secret으로 되니 괜찮아요.
  - git에 올리면 안 됩니다.

## 1. 준비

| 필요한 것 | 확인 / 설치 |
|---|---|
| Git, GitHub CLI | `gh auth login` 후 **`gh auth refresh -h github.com -s workflow`**, 그다음 `gh auth setup-git` (워크플로 파일 푸시에 필요) |
| Node.js 24 | `node --version` (회사 노트북은 v24.18.0) |
| Rust (데스크톱만) | `winget install --id Rustlang.Rustup -e --interactive`. 조용히 설치(`--silent`)는 실패했으니 창 띄워서. 안 되면 [rustup-init.exe](https://rustup.rs) 받아서 `rustup-init.exe -y` |
| VS 2022 C++ 빌드 도구 (데스크톱만) | Visual Studio Installer → "C++를 사용한 데스크톱 개발" |
| WebView2 | Windows 11이면 이미 있음 |

## 2. 코드와 데이터 받기

```powershell
git clone https://github.com/fkfkfk0406/fly-chan.git
cd fly-chan
npm ci

# 뇌 데이터·VRM: Releases에서 바로 받기 (파이썬 파이프라인보다 빠름, 약 104 MB)
gh release download data-v783 -R fkfkfk0406/fly-chan -D public/data -p "*.json" -p "*.u32" -p "*.i16" -p "*.f32" -p "*.u8"
gh release download data-v783 -R fkfkfk0406/fly-chan -D public/models -p "fly-chan.vrm"

npx tsc --noEmit -p .   # 타입 검사
npm test                # 69개 통과해야 정상 (커넥톰 테스트는 public/data 필요)
```

`public/data/`에 8개, `public/models/fly-chan.vrm`이 있어야 합니다. 없으면 `npm run data`(파이썬 venv 필요, README 참고)로 만들 수도 있어요.

**육성 저장은 옮겨지지 않습니다.** 브라우저·앱마다 따로 저장돼요(내보내기 기능은 아직 없음).

## 3. 검증 체크리스트

### 웹 (`npm run dev` → http://localhost:5173)

- [ ] 이름 짓기 → 첫 만남 → 방에서 돌아다님, 🧠 뇌 패널 발화
- [ ] 🎞️ 추억과 오늘: 출석 1일, 오늘의 부탁 3개, 추억 "첫 만남" 다시 보기
- [ ] 🎲 놀이 → 🤚 손 뻗기(꾹 누르면 다가감, 너무 빠르면 Giant Fiber로 도망), 🧺 딸기 받기
- [ ] 📷 사진 → 앨범에 들어가는지
- [ ] 탭을 1분 넘게 숨겼다 돌아오면 배부름 등이 줄어드는지 (숨긴 동안 시간 반영)
- [ ] 편지·삐짐 빨리 보기: 개발자 도구 콘솔에서 아래를 실행하고 **바로 새로고침**
  ```js
  flychan.care.save = () => {};  // 새로고침 때 lastSeen 덮어쓰기 막기
  const k = "fly-chan-care-v2", s = JSON.parse(localStorage[k]);
  s.lastSeen -= 30 * 3600e3; s.stageSeen = Math.max(1, s.stageSeen);
  localStorage[k] = JSON.stringify(s);
  ```
  → 편지 카드, 💢삐짐(등 돌림), 쓰다듬기로 풀리는지
- [ ] 휴대폰: `npx vite --host` → 같은 와이파이에서 `http://<PC IP>:5173` (방화벽 허용 필요할 수 있음)
- [ ] 시간 빨리: `?time=60`, 하트: `?hearts=999`

### 데스크톱 개발 실행 (`npm run desktop`)

첫 실행은 Rust 컴파일로 몇 분 걸립니다. 개발 실행은 `public/data`를 그대로 쓰고, 업데이트 확인은 하지 않습니다.

- [ ] 화면 오른쪽 아래에 테두리 없는 작은 창, 맨 위 제목 줄로 드래그 이동
- [ ] 제목 줄 📌 항상 위 / — 작게 / ✕ 트레이로 숨기기
- [ ] 트레이 아이콘: 왼쪽 클릭으로 보이기/숨기기, 오른쪽 클릭 메뉴(항상 위, 컴퓨터 켜면 같이 시작, 종료)
- [ ] 앱을 한 번 더 실행하면 새 창 대신 기존 창이 뜨는지
- [ ] 트레이에 1분 넘게 숨겼다 열면 시간이 반영되는지, 숨긴 동안 CPU가 내려가는지(작업 관리자)
- [ ] 질투 이벤트가 안 뜨는지 (데스크톱에서는 꺼 둠)
- [ ] 개발자 도구: 창에서 우클릭 → 검사 (디버그 빌드에서만)

### 배포와 자동 업데이트 (저장소를 **공개**로 바꾼 뒤)

- [ ] 첫 릴리스: `git tag v0.1.0 && git push origin v0.1.0` → GitHub Actions 탭에서 `release` 성공 확인 (첫 빌드 15분 안팎)
- [ ] Releases에 `Fly-chan_0.1.0_x64-setup.exe`, `.sig`, `latest.json`이 올라왔는지
- [ ] 설치 → 첫 실행에 "처음 한 번만 뇌 데이터를 받는 중… / 104 MB" → 캐릭터 등장
- [ ] 다시 켜면 다운로드 없이 바로 뜨는지
- [ ] 업데이트: 코드 조금 바꾸고 커밋 → `npm run release`(0.1.1 태그) → Actions 성공 → 설치된 0.1.0을 켜고 8초 뒤 "새 버전 v0.1.1" 알림 → 업데이트 → 재실행 후 육성 저장 유지 확인

**실패하면 볼 곳**
- Actions 서명 오류 → Secret `TAURI_SIGNING_PRIVATE_KEY` 확인 (키 파일 내용 전체)
- 앱에서 데이터 못 받음 → 저장소가 공개인지, `https://github.com/fkfkfk0406/fly-chan/releases/download/data-v783/meta.json`이 브라우저에서 받아지는지
- 업데이트 알림 안 뜸 → `https://github.com/fkfkfk0406/fly-chan/releases/latest/download/latest.json`이 열리는지. 데이터 릴리스(`data-v783`)는 사전 릴리스여야 함
- 로컬 `npm run desktop:build`가 서명에서 실패 → PowerShell에서 키를 넣고 빌드:
  ```powershell
  $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $HOME\.tauri\fly-chan.key -Raw
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
  npm run desktop:build
  ```

## 4. 알아 두면 좋은 것

- 이름: 플라이쨩 / fly-chan (예전 ONNA). 저장소 `fkfkfk0406/fly-chan`. 예전 저장 키 `onna-*`는 자동으로 이어받음.
- 앱 식별자 `io.github.fkfkfk0406.flychan`은 **바꾸면 안 됨** (바꾸면 설치된 앱의 저장·업데이트가 끊김).
- 버전은 `package.json` 하나로 관리 (`tauri.conf.json`은 거기를 읽음).
- 뇌 데이터를 바꿀 때: 새 태그(예: `data-v784`)를 **사전 릴리스**로 올리고 `src/util/assets.ts`의 `RELEASE_TAG` 변경.
