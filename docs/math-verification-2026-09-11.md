# 수식·구조 비교 검증 결과 — 2026-09-11

환경: macOS, Node 기반 TUI/npm. 0.1.7 릴리즈 준비 시점의 검증 기록입니다.

| 검증 | 최종 결과 |
| --- | --- |
| TypeScript build / diff whitespace check | 통과 |
| `npm run test:all` 소스 테스트 | 298/298 |
| 대량 회귀 테스트 | 5,844/5,844 |
| 실제 PTY 전체 시나리오 | 63/63 |
| npm audit (개발 의존성 포함) | 알려진 취약점 0건 |
| 임시 경로 npm 패키지 설치 및 실제 수식 엔진 | KaTeX/MathJax 통과 |

새 테스트는 구분자·코드 제외·통화·Unicode·CRLF·선택 변환·stale 원문 거부,
실제 두 수식 엔진과 매크로 격리, 180개 원문 보존 diff, 표 셀/수식 변경,
실제 Git staged/unstaged/commit/unborn HEAD/충돌/특수 경로/읽기 전용,
worker 중단·시간 제한·대용량 이벤트 루프 응답성, 컴파일된 CLI를 검증합니다.

PTY는 기존 50개 주요 시나리오와 신규 13개를 포함합니다. 신규 범위:
수식 메뉴와 진단, KaTeX/MathJax, 변환 y 적용/Enter 비적용/Undo,
한국어, 디스크↔버퍼 비교의 읽기 전용 동작, 원문·좌우 전환,
60행 이후 diff, 검색·행 이동·Esc, 좁은 화면 비교/진단입니다.

검증 중 수정한 사항:

- macOS `/var`와 `/private/var`의 Git 경로 정규화.
- 비교 검색창 및 좁은 터미널의 높이/줄바꿈 제약.
- 긴 원문 비교 행의 가로 탐색.
- 분석 worker 분리, 취소 및 결과 스냅샷 검사.
- 첫 커밋 전 Git staged 비교.
- MathJax 의존성을 갱신하여 하위 XML 파서의 알려진 취약점 제거.
- PTY 시작 화면 전환 대기와 중첩 검색/비교창 종료 절차 보완.

테스트 통과는 모든 LaTeX/Pandoc 문법이나 모든 OS를 보증하지 않습니다.
후속 배포 검증에서 macOS arm64 Bun 단일 바이너리의 worker/엔진 포함과
실제 수식·변환·비교를 확인했으며, 동일한 검사를 릴리즈 CI에도 추가했습니다.
Windows/Linux 실제 대화형 터미널, Pandoc/XeLaTeX 실변환은 미검증입니다.
영구 수식 설정, 증분 AST 캐시, 전체 TeX 패키지, 수학적 동치
판정 및 자동 병합은 이번 구현 범위에 포함되지 않습니다.
구체적인 지원 범위는 [사용법](math-tools.md)을 참조하세요.
