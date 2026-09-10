# mdok — Markdown OK

0.1.7: KaTeX/MathJax 수식 진단, 안전한 구분자 변환, Markdown 구조·Git 비교를 추가했습니다. **Ctrl+O M** 수식 도구 / **Ctrl+O D** 비교. [사용법과 한계](docs/math-tools.md).

0.1.6부터 TUI는 **뷰어 모드로 시작**합니다. 본문에서 **Enter → 소스+미리보기 분할 편집**으로 전환하며, 편집 중 Enter는 줄바꿈입니다. 메뉴/입력창의 Enter 동작은 그대로 유지됩니다.

0.1.6에 VS Code/Pandoc 선택 연동과 [Markdown 호환 범위](docs/markdown-compatibility.md)를 추가했습니다. TUI는 LaTeX 수식을 조판하지 않으며, Pandoc 변환은 별도 도구 설치가 필요합니다. 실제 변환 품질은 아직 미검증입니다.

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

`.md` 파일용 터미널 TUI 에디터: 사이드바 탐색기 + 소스 + 실시간 미리보기,
테마, 탭, 찾기/바꾸기, 린트, 셸 실행, 그리고 BYOK LLM(질문 + 고쳐쓰기).

## 설치

```sh
npm install -g @daystar7777/mdok
```

> `mdok: command not found`? 셸이 npm 전역 bin을 못 보는 거예요.
> 설치기가 맞는 `export PATH=…` 한 줄을 알려줘요.
> 직접 확인: `npm prefix -g` 후 `<prefix>/bin`이 `PATH`에 있는지.

소스에서 (Node.js 22+ 필요):

```sh
npm install
npm run build
npm link  # 또는: node dist/index.js
```

## 사용법

QR 내보내기: 상단 `[QR]` 클릭 또는 `Ctrl+O` 다음 `r` (파일 메뉴 7번)로 현재 버퍼를
QR로 표시합니다. 방향키로 이동, Space로 자동 순환, Esc로 닫습니다.
압축만 적용되며 **암호화되지 않습니다**. MDOK1 수신기가 필요하며 수신 UI는
아직 포함되지 않았습니다. [전송 형식과 한도](docs/qr-transfer.md).

```sh
mdok README.md      # 지정한 파일만 열기
mdok                # 마지막 세션 이어하기
mdok view README.md # 비대화형 예쁘게 출력 (파이프, 스크립트용)
mdok README.md | less

# 열린 파일에 LLM 질문 (BYOK, 스트리밍)
export MDOK_API_KEY=sk-...
mdok ask README.md -q "이 문서 3줄 요약해줘"

# lint + export (TUI 안에서도 됨)
mdok lint README.md
mdok export README.md -o out.html

# 설정 (TUI에서 ^O c로도 다 됨)
mdok config --url https://api.openai.com/v1 --model gpt-4o-mini
mdok config --key sk-... --theme ocean --git on --lang ko
```

설정은 `~/.mdok.json`에 저장 (`MDOK_API_KEY`, `MDOK_BASE_URL`, `MDOK_MODEL`,
`MDOK_LANG` 환경변수가 우선). 세션(열린 탭, 커서, 미저장 버퍼)은 `~/.mdok-session.json`.

## 언어 & 테마

- UI 언어: 한국어 / English. 설정에서 전환 (`^O c` → language),
  `mdok config --lang ko`, 또는 `MDOK_LANG=ko`. TUI와 CLI 메시지에 적용.
- 테마: `forest · ocean · sunset · mono · rose`, `^O t`로 순환 (기억됨).
  `~/.mdok-themes.json`으로 직접 만들기:
  ```json
  { "themes": [{ "name": "mine", "focus": "cyan", "selBg": "blue",
    "selFg": "white", "findBg": "yellow", "findFg": "black",
    "findCurBg": "red", "findCurFg": "white", "accent": "cyan" }] }
  ```
- CJK 텍스트(한글/漢字/emoji)는 표시 너비로 재서 커서·선택·마우스 클릭이
  편집 중에도 어긋나지 않음.

## TUI 키

| 키 | 동작 |
|---|---|
| `Ctrl+O`, `Tab` / `e` / `p` | 판 전환 · 소스/프리뷰로 이동 |
| `Ctrl+O`, `1`–`9` / `w` | 탭 전환 / 탭 닫기 |
| `Ctrl+O`, `v` | 분할 / 소스 / 보기 순환 |
| `Ctrl+O`, `b` | 사이드바 토글 (최근 · 목차 · 작업폴더 파일) |
| `Ctrl+O`, `f` | 파일 메뉴 (저장 · 새 파일 · 열기… · 실행… · HTML 내보내기 · 탭 닫기) |
| `Ctrl+O`, `a` | 열린 파일에 LLM 질문, 프리뷰에 스트리밍 (`Esc` 취소) |
| `Ctrl+O`, `R` | 선택영역 AI 고쳐쓰기, diff 보고 적용/버리기 |
| `Ctrl+O`, `/` | 찾기; `Tab` = 바꾸기 칸, `Enter` = 찾기/바꾸기, `n`/`N` 다음/이전 |
| `Ctrl+O`, `!` | 셸 명령 실행, 결과는 에디터 안에 |
| `Ctrl+O`, `L` / `F` | 문제 목록 / 버퍼 정리 |
| `Ctrl+O`, `\|` | 커서 위치 파이프 표 정리 |
| `Ctrl+O`, `t` / `l` | 테마 순환 (기억됨) / 줄번호 |
| `Ctrl+O`, `V` | vim 모드 (hjkl/i/a/A/o/x/0/$/G, `Esc` = normal) |
| `Ctrl+O`, `m` 또는 `F10` (Alt+M도 됨) | 메뉴바 포커스 |
| `←`/`→`, `Enter`, `Esc` (메뉴바) | 이동 · 실행 · 취소 |
| `Ctrl+O`, `g` | git 동기화 패널 (push / pull --rebase / commit / 자동 토글) |
| `Ctrl+O`, `c` / `?` | 설정 / 도움말 |
| `Ctrl+O`, `s` 또는 `Ctrl+S` | 저장 |
| `Ctrl+O`, `q` 또는 `Ctrl+Q` | 종료 (수정됐으면 두 번) |
| `Shift`+방향키 | 텍스트 선택 |
| `Tab` (소스에서) | 스페이스 2개 삽입 |

상단 버튼 (`[>]` `[Split]` `[Ask]` `[Find]` `[File]` `[Shell]` `[Set]` `[?]` `[X]`,
파일 이름 탭바)은 클릭 가능하고 위 키와 1:1 대응. 선택한 파일 하나만 표시하며,
분할 모드는 그 파일의 소스와 뷰를 함께 표시합니다. 이름이 많으면 `[<]` / `[>]`로
넘겨 선택할 수 있고, 미저장 내용은 전환해도 유지됩니다. 사이드바와 셸 출력은
기본 닫힘 (`^O b`, `[Shell]` 버튼).

(참고: `Ctrl+M`은 못 씀 — 터미널이 Enter로 보고함. `F10`/`^O m` 사용.)

## 마우스

클릭으로 커서 두기 / 탭 전환 / 버튼 누르기, 드래그 선택 (타이핑하면 대체),
휠은 포인터 아래 판 스크롤. SGR 터미널(iTerm2, WezTerm, Ghostty, VSCode, …)과
레거시 X10 터미널(macOS 기본 터미널: 클릭 됨, 휠 안 됨 — Apple 한계) 지원.

tmux: `~/.tmux.conf`에 `set -g mouse on` 필요. 대안: 드래그할 때 `Shift`를
누르고 있으면 터미널 네이티브 선택.

## 동기화 (파일 + git)

- mdok는 원자적으로 저장(임시파일 + rename)해서 iCloud / Dropbox / Syncthing이
  반만 써진 파일을 올릴 일이 없음. 노트를 동기화 폴더에 두면 됨.
- git 저장소 안에서는 (끄려면 `mdok config --git off` 또는 `^O c`):
  저장하면 3초 후 자동커밋 (`mdok: <파일>`), `^O g`로 push, pull
  (`--rebase --autostash`), 수동 커밋, 상태바에 `git:<브랜치>⇡⇣` + 충돌 경고.
  첫 push 때 upstream 자동 설정. 충돌은 보여주기만 하고 해결은 git에서.

## 로드맵

- [x] TUI — 사이드바 + 소스 + 실시간 미리보기, 탭, 테마, 세션 복원
- [x] `view` — 터미널 예쁘게 렌더
- [x] `ask` — 스트리밍 단일/멀티파일 Q&A (BYOK, OpenAI 호환)
- [x] 찾기/바꾸기, 린트, 정리, 표 정리, HTML 내보내기, git 뱃지, 감시
- [x] 인라인 AI 고쳐쓰기 + diff, vim 모드, 셸 실행, 최근 파일
- [ ] `mdok ask` 다른 제공자 (Anthropic 네이티브 API)
- [ ] 로컬 Ollama 프리셋 (`--url http://localhost:11434/v1`)
