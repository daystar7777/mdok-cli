# LaTeX 작성 지원 · Markdown 구조 비교 설계

작성: 2026-09-11. 기준 코드: npm 0.1.6. 아래는 원 설계이며,
현재 작업 트리에 핵심 기능을 구현했습니다. 실제 구현 범위·사용법·미구현 사항은
[수식 도구와 비교](math-tools.md)를 기준으로 확인하세요. 0.1.7 릴리즈에 포함됩니다.

## 1. 목표와 지원 약속

TUI에서 수식을 조판하지 않더라도 **어디가 수식인지, 무엇이 잘못되거나 호환되지 않는지, 두 문서에서 무엇이 바뀌었는지**를 알려준다. 분석은 로컬에서 실행하며 LLM이나 서버가 필요하지 않다. 향후 GUI는 같은 분석 결과를 재사용한다.

포함:

1. 수식 구분자·명령·괄호·연산자 구문 강조.
2. 구조 오류, 선택 엔진의 호환성 문제, 판단 불가를 구분한 진단.
3. `$$…$$` ↔ `\[…\]`, `$…$` ↔ `\(…\)`의 안전한 선택 변환.
4. Markdown 블록·문단·표 셀·수식 토큰을 고려하는 두 파일 및 Git 비교.
5. 원문 diff로 언제든 확인하고 빠진 변경 없이 탐색.

제외: TUI 그래픽 수식 조판, 완전한 TeX 컴파일러/IDE, 모든 LaTeX 패키지 지원, 수식의 수학적 동치 판정, 자동 merge/stage/commit, 불신 문서의 TeX 엔진 자동 실행. ‘KaTeX 통과’를 ‘LaTeX 전반 정상’으로 표시하지 않는다.

## 2. 기존 코드와 변경 경계

| 현재 구현 | 활용 / 보완 |
| --- | --- |
| `src/lint.ts`의 `LintProblem` | 단일 위치·문자열 메시지만 있음. 범위/심각도/엔진/진단 코드가 있는 공통 모델로 확장하고 기존 lint adapter 유지 |
| `diffLines()` | 작은 입력용 LCS, 큰 입력은 전부 삭제/추가. 원문 fallback으로 보존하되 새 구조 비교 엔진과 분리 |
| TUI diff overlay | AI 재작성 승인용이고 60줄 제한. 일반 비교에 적용 버튼을 재사용하지 않음 |
| TUI editor renderer | grapheme/화면 폭 계산 유지. 구문 색상과 선택/커서/검색 표시를 합성 |
| `src/integrations.ts` | Pandoc export profile은 이미 존재. 편집 문법·수식 엔진 profile과는 별개로 유지 |
| `src/git.ts` | argv 실행 방식 재사용. diff 원본 snapshot 조회는 별도 읽기 전용 adapter |

기존 뷰어 기본 → Enter 분할 편집은 유지한다. 이번 설계는 데스크톱→앱→웹의 제품 순서를 바꾸는 것이 아니라 TUI와 공통 문서 엔진의 기능 확장안이다.

## 3. 공통 분석 모델

문서 snapshot은 `{ documentId, revision, text, contentHash }`로 고정한다. 분석 중 사용자가 편집하면 이전 revision 결과는 폐기한다. 표시 문자열은 i18n 계층에서 생성하고 분석 엔진은 코드와 매개변수를 반환한다.

```ts
type Range = { start: number; end: number }; // UTF-16, [start,end)
type Diagnostic = {
  code: string;
  category: 'syntax' | 'compatibility' | 'unknown' | 'resource';
  severity: 'error' | 'warning' | 'info';
  range: Range;
  messageKey: string;
  params: Record<string, string | number>;
  related?: Range[];
  profileId: string;
  revision: number;
};
type MathRegion = {
  range: Range; bodyRange: Range;
  kind: 'inline' | 'display';
  delimiter: 'dollar' | 'double-dollar' | 'paren' | 'bracket';
  confidence: 'certain' | 'ambiguous' | 'incomplete';
};
```

원문과 source range를 보존한다. CRLF/NFD/Unicode를 분석 편의 때문에 저장 시 정규화하지 않는다. 줄·열은 line index를 통해 계산하고, TUI 출력 직전에만 `width.ts`로 화면 열로 바꾼다. 엔진이 반환하는 오류 offset의 기준(UTF-16/문자/바이트)은 adapter에서 검증·변환한다. 정확한 위치를 모르면 명령 위치를 지어내지 않고 해당 수식 전체를 가리킨다.

공통 흐름: **snapshot → Markdown 문맥 및 수식 영역 인식 → source-mapped 블록/토큰 → 진단·변환·구조 diff → TUI/향후 GUI**.

### 분석기 선택 게이트

기존 Marked 렌더러는 당장 교체하지 않는다. 원문 범위를 신뢰성 있게 제공하는 parser 후보를 spike로 평가하며, 전체 정규식만으로 Markdown과 TeX를 구현하지 않는다. 필요한 확장/GFM 규칙/source offset·CRLF 보존을 만족하지 못하면 채택하지 않는다. parser 버전·옵션을 고정하고 renderer와 해석이 다르면 ‘분석/미리보기 차이’를 문서화한다. 현재 문법 profile을 Pandoc 실행 결과와 동일하다고 추정하지 않는다.

## 4. 수식 인식과 profile

세 설정을 분리한다.

| 설정 | 예시 | 의미 |
| --- | --- | --- |
| Markdown 문법 | GFM 중심 / CommonMark / 제한된 Pandoc | 블록·표·코드 및 확장 규칙 |
| 수식 인식 | off / dollar / bracket / both | 문서에서 수식 경계를 찾는 규칙 |
| 수식 검사 엔진 | basic / KaTeX / MathJax | 인식된 수식 본문을 해석하는 검증기 |

profile에는 engine의 실제 version, extensions, delimiter policy, macro 설정의 hash를 포함한다. 앱 이름을 profile로 사용하지 않는다. ‘VS Code와 동일’이라는 preset은 특정 확장/version/options까지 명시적으로 검증하기 전 제공하지 않는다.

첫 기본값 제안: GFM 중심 + dollar/bracket 인식 + basic 구조 검사. 이 단계에서는 엔진별 명령 지원을 ‘검사 안 함’으로 표시한다. 이후 KaTeX adapter를 먼저 추가하고 MathJax는 별도 검증 후 노출한다. 최종 검사 엔진 기본값은 사용자 샘플 검증 결과로 결정한다.

인식 규칙:

- 코드 fence, inline code, 들여쓰기 코드, 지원하는 metadata 구간은 제외. 링크 목적지/HTML 속성 안의 기호도 본문 수식처럼 취급하지 않는다.
- 백슬래시의 홀짝 escape, TeX `%` 주석, 중첩 중괄호를 구분한다. `\{`는 그룹 시작 `{`와 다름.
- `$$`를 `$`보다 먼저 판별하고 inline/display 수식 유형을 보존한다.
- 통화 `$5`, 이스케이프된 달러, 짝 없는 `$`는 문맥상 모호할 수 있다. 모든 달러를 오류 처리하지 않음.
- bracket/display처럼 명확한 시작 뒤 닫힘이 없으면 incomplete 진단. inline 수식은 첫 버전에서 줄 경계를 넘기지 않는 정책을 문서화.
- 불완전 수식이 문서 전체를 수식으로 삼키지 않도록 블록 경계/상한에서 회복. 경계가 불확실한 영역은 자동 변환 금지.
- 지원하지 않는 `equation` 같은 환경 블록의 수식 영역 탐지는 후속 확장으로 분리. 모든 TeX 환경을 인식한다고 약속하지 않음.

## 5. 진단과 구문 강조

| 사례 | 판정 | 표시 |
| --- | --- | --- |
| 닫히지 않은 명확한 수식 구분자/그룹 | syntax error | 빨간 밑줄·`E`, 시작/관련 위치 |
| 선택한 엔진이 특정 명령을 거부 | compatibility warning 또는 엔진 내 parse error | 노란색·`W`, 엔진/version 함께 표시 |
| 선언되지 않은 사용자 macro, 불명확한 확장 의존 | unknown/info | 회색·`?`, 검사 범위 한계 안내 |
| 엔진 제한 시간/크기 초과 | resource warning | ‘검사 일부 생략’, 정상 판정 금지 |
| 명령 token을 인식했지만 engine 미선택 | 구문 강조만 | 지원 명령이라고 인증하지 않음 |

KaTeX parse 실패는 invalid/unsupported가 섞일 수 있으므로 예외 이름만 보고 모두 문법 오류로 분류하지 않는다. 구조 검사에서 확실한 오류가 아니고 adapter가 원인을 안정적으로 분류할 수 없으면 ‘선택 엔진에서 해석 실패’로 표시한다. 명령 목록 조회만으로 인자 개수/환경·확장 조건을 검증했다고 주장하지 않는다.

KaTeX adapter 제안: 공개 API 사용, `trust: false`, 유한한 macro 확장/크기 제한, 제한 시간 내 별도 worker 실행. 출력은 진단용으로만 사용하고 TUI에서 HTML을 실행하지 않는다. MathJax adapter는 로컬 패키지와 허용 extension 목록만 로드하며 네트워크 autoload를 막는다. 구체 API/패키지 버전은 구현 spike에서 잠근다.

사용자 macro는 초기에는 설정의 제한된 문자열 치환만 지원하며 JavaScript 함수 설정은 허용하지 않는다. 문서 내부 `\newcommand` 등의 범위 해석이 미지원이면 unknown 표시. macro 상태가 문서 간 새지 않도록 검사별 격리하고, 문서 내 순서 의존을 지원할 때는 앞선 선언 변경 이후 cache를 무효화한다. 자동 TeX 컴파일로 진단을 보완하지 않는다.

TUI:

- 소스 pane: 명령/구분자/그룹/연산자 색상. 선택 배경·커서·검색 표시는 구문 색상보다 우선하고 오류 마커는 gutter/상태줄에도 제공.
- 뷰어: 해당 원문 수식 구간을 색상/진단 수로 표시하되 조판된 수식처럼 보인다고 약속하지 않음. 렌더 위치 매핑이 없으면 본문을 잘못 칠하는 대신 진단 목록 제공.
- 상태줄 예: `수식 E1 W2 ?1 · KaTeX <version> · L12 닫는 구분자 없음`. 오류가 없더라도 `basic 검사 완료`처럼 범위를 명시.
- 기존 `Ctrl+O, L` 문제 목록에 Markdown/수식 filter, 스크롤·다음/이전 문제·위치 이동 추가. 원문 위치 이동은 현재 viewer 상태를 유지하고 Enter 편집 정책과 충돌하지 않게 함.
- 입력 때마다 경고 팝업을 띄우지 않음. debounce 제안 250ms, 검사 중/낡은 결과 표시. 언어 변경은 재파싱 없이 메시지만 교체.

## 6. 구분자 변환

동작: `수식 도구 → 구분자 변환 → 현재 수식/선택/문서 → 대상 형식 → 변경 미리보기 → 적용`.

변환은 확실히 인식된 양쪽 구분자만 편집한다. 본문, 공백, 줄바꿈, 들여쓰기, 코드/링크는 그대로 둔다. 표시 수식을 inline으로 바꾸지 않는다. 대상 profile에서 변환 결과를 다시 분석해 수식 개수·body·종류·주변 블록 경계가 보존되는지 검사한다. escape/통화 모호성이 새로 생기면 그 변환은 거부한다. 여러 수식 중 일부를 건너뛰면 개수와 이유를 표시한다.

`TextEdit { range, expectedText, replacement }[]`와 source revision으로 계획을 만든다. 적용 직전 revision/hash/expectedText를 확인하고 오래된 제안이면 재생성한다. 겹치는 edit 금지, 뒤쪽부터 적용, 한 번의 Undo transaction으로 묶는다. 실패하면 전체 미적용, 자동 저장 없음. 변환 미리보기에서 전체 변경을 스크롤할 수 있어야 하며 현재 60줄 잘림을 재사용하지 않는다.

## 7. Markdown 구조 diff

### 입력과 화면

첫 입력: 두 로컬 파일, 현재 버퍼↔디스크. 두 snapshot은 읽기 전용으로 고정하고 비교 도중 변경되면 ‘다시 비교’ 안내만 한다. 화면 제목에 양쪽 경로/버전과 버퍼 여부 표시.

비교 화면은 문서 편집과 별도 모드: 좁은 창은 통합 diff, 넓은 창은 좌우 보기 선택. 블록 종류·원본 줄 번호·`+/-/~`·변경 개수, 다음/이전 변경, 줄 이동·검색·스크롤을 제공한다. `구조 / 원문` 전환은 같은 변경 위치를 추적한다. Esc는 원래 문서·읽기 위치로 복귀하고 Enter가 편집/수정 적용으로 새지 않게 한다. 첫 버전은 변경 적용 버튼이 없는 비교 전용 기능.

### 알고리즘

1. 동일한 명시 profile로 양쪽을 파싱해 source-mapped 블록 트리를 생성. unsupported/raw 노드는 원문으로 보존.
2. 공통 고유 블록 hash와 부모 문맥으로 anchor를 잡고 anchor 사이를 bounded sequence diff. 같은 제목/문단 반복 때문에 잘못 대응하지 않도록 원문 일치와 순서를 우선.
3. 변경 블록 내부의 상세 비교:
   - 문단/제목/목록: 텍스트 토큰 차이. CJK는 언어-aware 분절과 grapheme fallback. 공백도 보존.
   - 링크: 표시 텍스트와 목적지를 따로 비교. 목적지가 바뀌었는데 같다고 숨기지 않음.
   - GFM 표: header/body/alignment와 셀 범위 분리. 행 삽입·삭제를 먼저 정렬한 뒤 대응 행의 셀 비교. 확신 없는 행/열 이동은 삭제+추가로 표시.
   - 수식: 구분자 변경과 본문 변경을 분리. 본문은 명령·괄호·숫자·기호·공백·주석 token 비교. macro expansion/수학적 정규화 금지.
   - 코드: fence 언어 변경과 내부 줄 변경 비교. fenced code 안 수식은 수식으로 해석하지 않음.
4. 구조 해석이 불완전하면 해당 범위를 원문 diff로 fallback하고 그 이유 표시.
5. 전체 원문 변경 범위를 대조하여 구조 결과에서 누락된 바이트/문자 변경은 별도 raw hunk로 노출. 원문 재구성이 가능한 source slice를 유지.

단순 줄바꿈 재배치나 표 정렬 공백을 숨기는 것은 선택 옵션이다. 기본은 모든 변경 표시. Markdown 두 칸 hard break·코드 들여쓰기·링크 목적지·수식 공백을 ‘서식뿐’이라고 자동 무시하지 않는다. 구분자만 바뀌어도 변환 호환성이 달라질 수 있으므로 차이를 표시한다. 수식 `x+x`와 `2x`는 그대로 변경으로 표시한다.

첫 표 범위는 GFM pipe table. escape된 pipe, inline code 내부 pipe도 선택 문법의 실제 규칙대로 처리한다. 불균일/손상 표와 Pandoc grid/multiline table은 안전한 원문 fallback. 기존 `splitPipeRow`를 모든 Markdown 표 parser로 확대 사용하지 않는다.

Diff 결과 모델: 양쪽 snapshot ID, parser/profile 버전, old/new range, 블록 유형, change kind, 세부 token range, confidence/fallback 사유. 표시용 색상 문자열만 반환하지 않는다. 블록 이동 탐지는 1차 비목표이며 삭제+추가로 정확하게 보이는 것이 우선이다.

### Git adapter (후속 단계)

소스 조합을 명확히 나눈다: HEAD↔index(staged), index↔worktree(unstaged), 지정 commit↔commit, 버퍼↔선택 Git snapshot. untracked는 ‘새 파일’, 삭제는 빈 쪽, conflict는 base/ours/theirs를 명시하고 일반 두 파일 비교인 척하지 않는다.

repository/path를 확인하고 사용자가 고른 ref를 commit/object ID로 검증한 뒤 읽는다. 경로는 NUL 구분 출력과 literal path 처리, 인자는 shell 문자열로 결합하지 않음. Git binary snapshot을 얻어 UTF-8 텍스트 판별 뒤 같은 diff 엔진에 전달한다. 외부 diff/textconv·pager·임의 helper 실행은 비활성화하고 checkout/reset/stage/commit/fetch는 수행하지 않는다. repository root 밖 경로·symlink·submodule·binary는 명시적으로 거절하거나 미지원 표시. EOL/attribute 변환 차이는 숨기지 않는다.

`git diff --word-diff`는 텍스트 비교 참고 수단이지 Markdown 표/수식 구조 분석기가 아니다. Git에서 텍스트 snapshot을 가져오는 부분과 mdok의 구조 비교를 분리한다.

## 8. 모듈 제안과 운영 제약

```text
src/document-analysis/   snapshot, line map, profile, source-mapped blocks
src/math/                region scanner, tokens, diagnostics, engine adapters
src/transform/           delimiter edits, revision guard
src/compare/             block alignment, text/table/math diff, raw fallback
src/git-snapshots.ts     read-only Git snapshot loading
src/tui-compare.tsx      comparison-only viewport (AI apply UI와 분리)
```

실제 디렉터리 추출은 단계별 진행. 순수 분석 모델은 Node/Ink에 의존하지 않게 하고 worker 실행·파일/Git 접근·UI는 adapter로 둔다. TUI에 신규 큰 상태 덩어리를 계속 추가하기보다 analysis controller와 비교 화면을 분리한다.

제안 리소스 상한: 자동 분석 문서 1MiB, 개별 수식 32KiB, engine timeout 500ms/수식, 문서 분석 총 2초, 비교 worker 총 3초. 성능 보장이 아니라 초기 튜닝값이다. 10KB/100KB/1MiB 표본으로 조정한다. 초과 시 partial/raw fallback과 이유 표시, 입력은 계속 받아야 한다. 취소된 worker를 실제 종료하고 단순 Promise timeout으로 CPU 작업을 방치하지 않는다. 캐시는 snapshot hash+profile+macro 상태 기준으로 bounded LRU.

자동 분석은 파일·네트워크 접근 금지. 문서의 TeX 명령·Git 출력·ANSI 제어문자를 실행하지 않는다. 설정은 JSON schema/크기 제한을 적용하고 암호문 문서는 클라이언트 복호화 이후만 분석한다. 검증 로그에 문서 본문을 남기지 않는다.

## 9. 단계별 개발 계획

| 단계 | 결과물 | 완료 게이트 |
| --- | --- | --- |
| S0 공통 분석 spike | source range, profile, fixtures, parser ADR | 코드/수식/표/CRLF/Unicode에서 원문 범위와 재구성 검증 |
| S1 수식 작성 보조 MVP | basic 인식·구문 강조·구조 진단·문제 목록·상태줄 | 모호한 달러 오탐 통제, 오래된 결과 미표시, 편집/선택 회귀 없음 |
| S2 엔진 진단+변환 | KaTeX adapter, profile 표시, 변환 미리보기/Undo | 실제 엔진 검증, 자원 제한, code 제외, stale edit 미적용 |
| S3 두 파일 구조 diff | 문단/표/수식 상세 비교, 전체 raw 전환 | 변경 누락 없음, 긴 문서 탐색, 읽기 전용 |
| S4 Git diff | staged/unstaged/commit adapter | 저장소 무변경, 특수 경로/미추적/삭제/conflict 검증 |
| S5 호환 확장 | MathJax, 추가 문법 profile | 엔진별 실제 fixture, 지원/미지원 표, 버전 pin |

추천 첫 구현은 **S0+S1**. 핵심 수식 사용 사례를 먼저 받아 검증하고 S2·S3에서 같은 인식 결과를 사용한다. MathJax를 KaTeX 검사 결과로 대체해 먼저 출시하지 않는다. 단계 번호는 구현 묶음이며 일정/출시 버전은 아직 확정하지 않는다.

## 10. 검증 계획

| 축 | 필수 사례 |
| --- | --- |
| 경계 | 4종 구분자, 미종결/중첩/혼합, escape 홀짝, 통화, `%`, brace, fence/backtick 길이 |
| 엔진 | 실제 지원/미지원 명령, 인자 오류, extension 미설치, 사용자 macro, 문서 간 macro 격리 |
| 원문 보존 | CRLF/LF, NFD 한글, emoji/ZWJ, 탭, 끝 개행, 수식 주변 inline code·링크·표 |
| 변환 | 선택/문서, ambiguous 건너뛰기, 겹침 금지, profile 재검사, stale revision, 1회 Undo/Redo |
| 표 diff | 셀 1개 변경, 행 삽입/삭제, 빈 셀, 정렬 변경, 같은 행 반복, escape pipe, 손상 표 fallback |
| 수식 diff | 명령/인자/지수/첨자/괄호/주석 변경, 구분자만 변경, 문법 오류 양쪽, 동치 식도 변경 |
| Git | staged/unstaged 차이, 미추적/삭제/rename, 공백·한글·선행 dash·개행 경로, invalid ref, binary, conflict |
| TUI | 40/80/120/200열, 스크롤·선택·검색·커서 겹침, 한국어/영어/무색상, Enter/Esc 누출, 60줄 이후 변경 |
| 자원/보안 | 수식 확장 폭주, 큰 반복 블록 diff, 취소/timeout, ANSI 출력, 외부 resource 명령, shell 인자 주입 |

자동 생성 테스트는 seed 고정과 최소 실패 사례 저장을 사용한다. 핵심 속성: 변환 밖 원문 불변, 변환 미리보기=적용 결과, Undo 원문 복원, 동일 입력 diff 없음, old/new 변경 coverage 누락 없음, raw hunk로 양쪽 재구성, budget 초과 시 조용히 정상 처리하지 않음. 두 구분자 사이 왕복은 양방향 안전 판정을 통과한 사례에서만 원복을 요구한다.

실제 engine fixture는 mock과 별도 suite로 운영하고 설치 안 됨을 통과로 세지 않는다. Git 테스트는 임시 repository, PTY는 격리 홈/문서, OS GUI/IME 테스트는 미검증 여부 명시. 수천 개 개수보다 사용자 제공 표/수식 재현 사례와 end-to-end 결과를 출시 기준으로 삼는다.

## 11. 문서·CLI·미결정 사항

향후 CLI 제안: `mdok lint --math-engine …`, `mdok compare a.md b.md`, `mdok compare --git staged --file …`, `mdok math-convert … --dry-run`. 기존 `lint/export/convert` 의미는 바꾸지 않는다. CLI 이름/단축키는 S1/S3 UI 설계에서 충돌 검사 후 확정한다. JSON 진단 출력에는 schemaVersion·engineVersion·partial 여부 포함.

사용자 확인이 유용한 것은 실제 문제 문서(공개 가능한 최소 예제), 사용하는 VS Code 확장/MathJax·KaTeX 설정, 비교 대상(두 파일/수정 전후/Git staged)의 우선순위다. 샘플을 받기 전에도 S0/S1은 시작 가능하다.

현재 이 기능들은 미구현이다. 출시 때 [호환성 문서](markdown-compatibility.md)에 인식/구조 검사/실제 엔진 검사/조판/변환을 분리해 표시하고, source renderer와 export profile이 다를 수 있음을 명시한다.

## 12. 기술 근거

2026-09-11 확인. MathJax는 LaTeX 전체가 아닌 부분집합이며 구분자·extension 구성을 지원한다: [MathJax TeX support](https://docs.mathjax.org/en/stable/input/tex/index.html).

KaTeX는 parse 오류, macro 설정, trust와 자원 관련 옵션을 제공한다. 이를 실제 engine adapter와 격리 정책의 출발점으로 삼되 지원 여부 판정은 해당 version으로 시험한다: [KaTeX options](https://katex.org/docs/options).

Git의 비교 대상·word diff·외부 diff 관련 옵션은 snapshot adapter 설계 참고다: [git-diff](https://git-scm.com/docs/git-diff). 위 source-mapped 분석·변환·구조 diff 알고리즘은 mdok의 설계 제안이며 이 도구들이 그대로 제공하는 기능이라는 뜻이 아니다.
