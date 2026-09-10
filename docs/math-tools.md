# 수식 작성 지원과 Markdown 비교

0.1.7의 신규 기능입니다. npm 0.1.6에는 포함되지 않습니다.

## TUI

- 기본 View / Enter → Split 편집 동작은 유지합니다.
- `Ctrl+O`, `M`: 수식 도구. 엔진(basic/KaTeX/MathJax), 구분자 정책,
  진단 목록, 문서·선택 영역·현재 수식의 구분자 변환을 제공합니다.
- 소스의 수식 명령과 본문을 구분해 강조합니다. 진단은 오류/경고/미검사로
  나누며 상태 표시줄과 lint 목록에서도 확인할 수 있습니다.
- 진단 목록에서 `f`로 심각도를 필터링하고 Enter로 원문 위치로 이동합니다.
- `$…$`, `$$…$$`, `\(…\)`, `\[…\]`를 인식합니다. 코드·HTML·URL·이미지·
  초기 YAML frontmatter는 수식 검사/변환 대상에서 제외합니다.
- 변환은 비교 미리보기 후 **y로만 적용**합니다. Enter는 적용하지 않습니다.
  원문이 바뀌었으면 거부하고, 적용은 Undo 한 번으로 되돌립니다. 자동 저장하지 않습니다.
- `Ctrl+O`, `D`: 비교. 다른 파일 경로, `:disk`(디스크↔현재 버퍼),
  `:staged`(HEAD↔index), `:unstaged`(index↔디스크), `:head`를 입력합니다.
  Git 비교에는 미저장 버퍼가 포함되지 않습니다.
- 비교 화면: ↑↓/PgUp/PgDn 세로 이동, ←→ 가로 이동, `r` 원문 비교,
  Tab 좌우 비교, `/` 검색(`:숫자`는 표시 행 이동), n/N 검색 결과,
  [/] 변경 구간 이동, Esc 닫기. 검색 중 Esc는 검색창만 닫습니다.
- 좌우 비교는 넓은 화면에서 제공하며 긴 행을 생략합니다. 전체 행은
  원문/통합 비교에서 가로 이동하여 확인합니다. 일반 비교는 읽기 전용입니다.

## CLI

```sh
mdok math-check paper.md --engine katex --json
mdok math-check paper.md --engine mathjax --profile commonmark
mdok math-check paper.md --delimiters bracket --macros macros.json
mdok math-convert paper.md --to bracket          # dry-run
mdok math-convert paper.md --to dollar --write   # 명시적 저장
mdok compare old.md new.md --json
mdok compare paper.md --git staged
mdok compare paper.md --git head --ref HEAD~1 --to-ref HEAD
```

매크로 파일은 `{"\\R":"\\mathbb{R}"}`처럼 명령→문자열 JSON입니다.
100개/8 KiB까지 허용하고 문서별 실행에 복사합니다. 문서 자체의 매크로 정의나
외부 자원 명령은 실행하지 않고 미검사로 표시합니다.
math-check 종료 코드는 0=오류/경고 없음(미검사는 별도 확인),
1=오류/경고/일부 검사, 2=실행 실패입니다.

## 지원 범위와 안전성

- Markdown 구조 분석: CommonMark/GFM. TUI는 GFM 고정, CLI는 선택 가능.
  Pandoc 전체 확장 문법을 검증하지 않습니다. 알 수 없는 구조도 원문 diff는 보존합니다.
- 수식 엔진: KaTeX 0.18.7, MathJax 4.1.3의 base/ams/configmacros 구성.
  실제 엔진으로 검사하지만 TUI에 수식을 조판해 표시하는 기능은 아닙니다.
  full LaTeX 컴파일러나 모든 MathJax 패키지를 지원한다는 의미도 아닙니다.
- basic은 구분자/중괄호 검사입니다. 모든 명령의 유효성을 보증하지 않습니다.
  엔진에서 거부한 수식은 해당 엔진의 호환성 경고이며 보편적인 LaTeX 오류로 단정하지 않습니다.
- 달러 기호와 통화는 휴리스틱으로 구분합니다. 모호하거나 미완성인 영역은
  자동 변환하지 않습니다. 변환 후 수식 본문과 inline/display 구분을 재검사합니다.
- diff는 블록/단어/표 셀/수식 토큰 변경을 설명하며 원문을 양쪽 모두 보존합니다.
  수학적 동치 판정, 자동 병합, Git rename 추적, 충돌 3-way UI는 제공하지 않습니다.
  충돌 파일은 명시적으로 거부합니다. 새 저장소의 첫 staged 파일도 비교할 수 있습니다.
- Git은 객체를 읽는 명령만 사용합니다. external diff/textconv를 실행하지 않으며
  symlink/submodule/바이너리/잘못된 UTF-8은 거부합니다.
- CLI/Git 입력은 1 MiB, 분석 입력은 1,048,576 UTF-16 code unit 제한입니다.
  수식 영역 32 KiB, 엔진 검사 최대 200개, 분석 worker 기본 3초,
  엔진 worker 기본 2초 제한을 둡니다. 초과는 실패/일부 검사로 표시합니다.
- TUI 분석은 250ms debounce 후 별도 worker에서 수행합니다. 문서/엔진 변경 시
  이전 작업을 취소하며 현재 스냅샷과 일치하는 결과만 표시합니다.
  증분 AST 캐시와 영구 설정 저장은 아직 구현하지 않았습니다.
- 새 엔진/구분자 설정은 TUI 세션 한정입니다. 사용자 매크로 설정은 CLI에서 제공합니다.
- 수식 검사·비교는 로컬에서 수행하며 문서를 원격 서비스로 전송하지 않습니다.
- Node 22+ npm과 macOS arm64 Bun 단일 실행 파일의 수식·변환·비교를 검증했습니다.
  릴리즈 CI는 각 OS의 native 바이너리도 검사합니다. Windows/Linux 실제 대화형
  터미널과 Pandoc/XeLaTeX 외부 실행은 로컬 검증에 포함되지 않았습니다.

## 재현 가능한 검증

```sh
npm run test:all
npm run test:tui
npm audit
```

수식 fixture/변환 보존/실제 양쪽 엔진/180종 구조 diff/격리된 Git 저장소/
worker 취소·시간 제한·대용량 응답성/컴파일된 CLI 검증을 포함합니다.
PTY 검증은 View↔Split, 저장·Undo, 다국어·Unicode, QR, 외부 도구 메뉴 등
기존 주요 흐름과 수식 진단·변환·비교 조작을 함께 확인합니다.
