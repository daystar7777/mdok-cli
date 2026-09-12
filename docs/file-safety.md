# CLI 파일 변경·저장·복구 (0.1.11)

이 문서는 npm 패키지 `@daystar7777/mdok`의 터미널 편집기 설명입니다. 데스크톱
DMG는 별도 제품/버전이며 이번 CLI 게시로 자동 업데이트되지 않습니다.

## 외부 변경과 다시 읽기

열려 있는 현재 파일을 약 1초마다 다시 확인합니다. 저장 후 파일 자체가 바뀌는
원자적 교체도 계속 감지하며, 탭을 전환하면 선택한 파일을 즉시 확인합니다.
백그라운드 탭은 저장 직전 검사를 유지하고, 해당 탭으로 돌아오면 상태를 표시합니다.
다른 앱에서 아직 저장하지 않은 편집 내용은 볼 수 없습니다.

`Ctrl+O`를 누른 다음 `c`로 설정을 열고 다음 두 항목에서 Enter로 전환합니다.

- 외부 파일 변경: `확인 요청`(기본), `수정하지 않았으면 자동 반영`, `현재 내용 유지`.
- 원본 자동 저장: 기본 OFF. ON이면 입력을 멈춘 뒤 약 2초 후 원본에 저장합니다.

명령으로도 설정할 수 있습니다.

```sh
mdok config --external-changes ask --auto-save off
mdok config --external-changes auto --auto-save on
```

자동 반영은 내 편집이 없을 때만 적용합니다. 어떤 정책에서도 외부 변경을 무시하고
덮어쓰지 않습니다. 삭제·읽기 실패·저장 실패·충돌 시 자동 저장은 멈춥니다.
새 파일은 먼저 직접 저장해야 합니다. 이미 진행 중인 저장은 설정을 끄더라도
완료될 수 있습니다. 원본 자동 저장은 별도 Git 자동 커밋을 실행하지 않습니다.

## 외부 변경 확인 메뉴

`Ctrl+O u` 또는 파일 메뉴의 `외부 변경 / 다시 읽기`를 엽니다.

- `r`: 디스크 내용 다시 읽기. 미저장 편집이 있으면 추가로 `y`를 눌러야 버립니다.
- `d`, Enter: 디스크와 현재 버퍼 비교. 비교 화면에서 Esc로 닫습니다.
- `c`: 현재 버퍼를 같은 폴더의 고유한 `*.copy-<시간>-<식별자>.md`로 저장합니다.
  기존 원본과 현재 버퍼는 변경하지 않습니다.
- `k` 또는 Esc: 현재 내용 유지. 기존 충돌을 승인하는 동작은 아니므로 원본 저장은
  계속 차단됩니다.
- `a`: 자동 저장 재개 시도. 외부 변경이 해결되지 않았으면 다시 멈춥니다.

확인 화면을 띄운 뒤 디스크나 버퍼가 다시 바뀌면 기존 확인으로 편집을 버리지
않습니다. 다시 확인해야 합니다. 자동 병합·강제 덮어쓰기는 제공하지 않습니다.

## 저장과 중복 열기

일반 저장, 원본 자동 저장, 탐색기의 `저장 후 열기`, `math-convert --write`는
이전에 읽은 내용의 SHA-256을 기준으로 저장 전과 임시 파일 작성 후 다시 검사합니다.
새 파일은 배타적으로 생성하며 이미 있는 파일을 덮어쓰지 않습니다.

정규 경로 또는 동일 파일 ID의 별칭은 시작/일반 열기에서 기존 탭을 사용합니다.
여러 터미널에서 같은 파일을 열어도 버퍼는 별개이며, 먼저 저장한 뒤 다른 버퍼로
낡은 내용을 저장하면 충돌로 거부합니다. mdok끼리의 동시 저장은 파일 옆의 짧은
배타적 저장 잠금으로 직렬화하거나 거부합니다. 다른 프로그램은 이 잠금을 따르지
않으므로 최종 검사와 교체 사이의 모든 경쟁을 OS 차원에서 막는 보장은 아닙니다.

심볼릭 링크는 열 때 실제 경로로 해석하지만, 열린 경로가 나중에 링크로 바뀌면
저장을 거부합니다. 하드 링크가 여러 개인 파일은 원자적 교체로 링크 관계가 깨지는
것을 피하기 위해 원본 저장을 거부하며, 별도 사본으로 저장할 수 있습니다.
읽기 전용 권한이 설정된 파일도 교체 저장으로 권한을 우회하지 않습니다.

저장 도중 프로세스가 강제 종료되면 파일 옆의 `.파일명.mdok-write-lock` 디렉터리가
남을 수 있습니다. 자동으로 훔쳐서 해제하지 않습니다. 관련 mdok를 모두 종료하고
실제 저장이 진행 중이지 않음을 확인한 뒤 해당 **빈 잠금 디렉터리만** 제거하거나
사본으로 저장하세요. 원고나 다른 잠금 파일은 삭제하지 마세요.

## 미저장 복구 사본

최근 작업 공간은 기존처럼 `~/.mdok-session.json`에 저장됩니다. 미저장 내용은
실행마다 다른 ID의 `~/.mdok-recovery/<id>.json`에도 보관하여 다른 CLI 창이
최근 작업 공간을 갱신해도 덮어쓰지 않습니다. 현재 실행에서 저장하거나 명시적으로
버려 미저장 문서가 없어지면 해당 실행의 복구 사본만 제거합니다.

```sh
mdok recover
mdok recover <목록에 나온 ID>
```

다른 실행의 복구 사본은 자동 삭제하지 않으므로 오래 사용하면 공간이 늘어날 수
있습니다. 기존 버전의 복구 기록에 디스크 기준값이 없으면 원본 덮어쓰기를 허용하지
않습니다. 비교 후 사본으로 저장하거나 원본을 명시적으로 다시 읽으세요.

복구는 약 1.5초 후와 정상 종료 시 저장하는 보조 수단이며 **백업이 아닙니다**.
저장소 오류·강제 종료 직전 입력·파일 삭제를 모두 복구한다고 보장하지 않습니다.
복구 사본은 **암호화되지 않은 로컬 평문**입니다. 중요한 원고는 독립적으로 백업하세요.

## 미리보기와 제한

대화형 편집기의 미리보기는 별도 작업 스레드에서 준비하며 상태를 표시합니다.
새 문서를 열 때 이전 문서 화면을 지우고, 같은 문서를 편집할 때는 이전 미리보기를
유지합니다. 완료·오류·취소를 구분하고 오래된 결과는 현재 문서에 적용하지 않습니다.
표시는 백분율이나 속도 향상 보장이 아닙니다. 작업 스레드는 시간/메모리 한도가 있습니다.

대화형 문서는 유효한 UTF-8 텍스트 최대 1MiB입니다. 수식 조판/내보내기와 별도로,
CLI UI는 한국어·영어를 지원합니다. 문서 내용을 네트워크로 보내서 변경을 확인하거나
미리보기를 준비하지 않습니다. LLM·셸·Git 등 기존의 명시적 외부 작업은 별개입니다.

## English summary

External-change handling defaults to Ask, with clean-only auto-reload and Keep
options. Original-file auto-save defaults OFF and runs after two idle seconds;
new documents need a manual save first. Errors, conflicts and deletion pause it.
Ctrl+O u offers reload (explicit dirty-discard confirmation), comparison, a unique
copy, Keep and auto-save resume. Save, Explore save/open and math-convert --write
check the prior disk hash before replacing files. A short cooperative per-file
lock prevents competing mdok writes, but is not a cross-application OS transaction.
Abandoned write locks require checking that all relevant editors have stopped
before removing only that empty lock directory. Hardlinked files require a copy.

Each TUI execution preserves independent unsaved recovery data under
~/.mdok-recovery. Use mdok recover, then mdok recover <id>. Recovery is best-effort,
local plaintext, and not a backup; old sessions are retained. Legacy drafts
without a disk token cannot authorize an overwrite. Preview work runs off the UI
thread with visible pending state. Desktop installers are a separate release.
