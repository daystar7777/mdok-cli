# Explore — 전체 화면 파일 탐색기

상단 **Explore** 버튼 또는 `Ctrl+O`, `E`로 엽니다. 현재 편집 화면 대신
전체 화면 탐색기를 표시하며, 기존 사이드바와는 별개입니다.

- 한 번 클릭: 선택. 더블클릭 / **열기** / Enter: 폴더 진입 또는 파일 열기.
- 휠: 목록 스크롤. ↑↓, PgUp/PgDn, Home/End: 선택 이동.
- **상위** / Backspace: 상위 폴더. **경로** / p: 경로 직접 입력.
- **검색** / `/`: 현재 폴더 이름 필터. 검색어를 비우면 전체 목록으로 돌아갑니다.
- **MD만/전체 파일** / m, **숨김** / h: 표시 필터. r: 새로 고침.
- **새 MD** / n: 현재 폴더에 새 Markdown 생성. 확장자가 없으면 `.md`를 붙입니다.
- 입력칸에서 Ctrl+U는 전체 지우기, Esc는 입력 취소입니다.
- **돌아가기** / Esc: 기존 문서로 돌아갑니다. 탐색 위치·검색·선택·스크롤은
  같은 실행 세션 안에서 유지합니다. 폴더를 이동하면 검색은 초기화합니다.

파일을 열면 기본 뷰어로 전환하며 현재 문서를 교체합니다. 새 파일은 분할 편집으로
진입합니다. 현재 문서가 미저장이면 저장·버리기·취소를 묻고 기본 선택은 취소입니다.
확인창에서 ←→/Tab+Enter 또는 s/d/c, 마우스로 선택할 수 있습니다.
이미 다른 탭에 열린 문서는 그 버퍼를 보존하며 중복 탭을 만들지 않습니다.

새 파일은 배타적 생성(`wx`)으로 기존 파일/심볼릭 링크를 덮어쓰지 않습니다.
열기 실패·생성 실패는 원래 편집 버퍼를 유지합니다. 유효한 UTF-8 일반 파일만
열며 1 MiB 초과 및 바이너리는 거부합니다. 파일 삭제·복사·이동은 제공하지 않습니다.

폴더는 현재 단계만 비동기로 읽고, 크기·수정일은 화면에 보이는 항목만 조회합니다.
권한 오류와 사라진 경로는 화면에 표시합니다. 심볼릭 링크 폴더는 실제 경로로
진입하며 전체 트리를 재귀 순회하지 않습니다. 10만 항목을 넘는 폴더는 명시적으로
거부합니다. 좁은 화면은 버튼을 여러 줄로 배치하고 크기·수정일 열을 숨깁니다.

상단 Explore 표기는 언어와 관계없이 유지하며 탐색기 안내는 한국어/영어를 지원합니다.
Windows 실제 마우스/콘솔 동작 검증은 별도로 필요합니다.

## 검증

macOS Node 환경에서 기존 TUI 63개 회귀 항목과 탐색기 전용 20개 항목을
확인했습니다. 탐색기 검증에는 상단 버튼/더블클릭/하단 저장 버튼의 마우스 좌표,
미저장 저장·버리기·취소, 같은 파일 저장 후 재열기, 한글 생성, 덮어쓰기 방지,
검색·선택 복원, 폴더 경로, 숨김 파일, 긴 목록, 바이너리 거부, 좁은 화면,
분할된 마우스 제어 문자 유입 방지가 포함됩니다.

재현: `npm run test:all`, `npm run test:tui`.
# Document display

Only the selected document is displayed. View uses the full document area;
Split shows that document's source and preview. If multiple documents are already
open, click their name tabs to switch without losing unsaved edits. On narrow
terminals, `[<]` and `[>]` reveal adjacent names. Explore opens replace the current
document (with Save/Discard/Cancel for unsaved edits), rather than adding panes.
