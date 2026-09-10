# mdok 웹·동기화·E2EE 실시간 협업 설계

> 2026-09-11: 현재 제품 범위와 문서별 키·권한 경계는 [통합 설계](product-design-2026-09-11.md)가 우선한다. 아래 workspace 공통키 설계는 채택하지 않는다.

작성: 2026-09-10. 상태: 구현 전 설계안.

> 이후 사용자 결정 반영: 개발 순서는 데스크톱 비로그인 → 모바일 앱 → 웹 페이지(첫 목표 종료) → 계정/5MB → 초대 가입 → 유료화다. [제품 개발 기준](product-plan.md)이 우선하며 아래 초기 협업 베타/구현 순서는 장기 기술 참고안으로 남긴다. 특정 사용자에게 개별 문서 열람 권한을 주는 요구사항이 추가되어, 아래 workspace 공통키/전체 공유 구상은 문서별 키·권한·metadata 경계로 대체해야 한다. GUI·다국어·번역/요약은 첫 제품 단계부터 다룬다.

사용자 확정 사항: 웹 편집, 기기 간 동기화, 실시간 협업을 포함하고 E2EE를 유지한다. 후보 서버는 Contabo €29.6, 16코어, RAM 64GB, 디스크 500GB다. 월 요금으로 가정하되 세금·지역·약정·갱신 조건은 미확인이다.

이번 결정은 기존 roadmap의 “협업/실시간 동기화 제외”를 대체한다. 오프라인 편집·Markdown 내보내기는 유지한다. 구현 코드, 배포, 서버 구매는 아직 없다.

## 1. 제품 범위

| 표면 | 초기 역할 |
|---|---|
| mdok.net | 소개, 다운로드, 문서, 요금/베타 안내 |
| app.mdok.net | 웹 편집, 문서 목록, 초대, 협업, 기기/복구키 관리 |
| app.mdok.net/api | 로그인, workspace/문서 권한, 기기 등록, 암호문 저장 |
| app.mdok.net/sync | 암호화된 update/접속 상태의 WebSocket 전송 |
| CLI/TUI | 로컬 편집 + 동일 sync client 연결 |
| Desktop | 초기에는 TUI 호스트 안정화, 이후 웹 편집 UI 공유 가능 |

브라우저와 API/WS를 같은 origin으로 두어 세션 처리를 단순화한다. 콘텐츠 미리보기는 별도 sandbox에 격리한다. 소개 사이트와 앱의 배포는 분리한다.

초기 베타: 텍스트 `.md/.markdown/.txt`, workspace 전체 단위 공유, owner/editor/viewer, 계정 기반 초대, 동시 커서, 오프라인 재접속, 버전 복구, Markdown 내보내기. 읽기 전용 공개 링크·첨부파일·문서별 복잡한 ACL·댓글은 후속 단계로 둔다. 사용자가 받은 권한과 공유 단위를 초대 화면에 표시한다.

E2EE 협업 워크스페이스에는 암호화된 CRDT 상태가 필요하다. `.md` 파일은 독립 로컬 모드에서는 원본이며, 협업 모드에서는 CRDT에서 생성한 이식 가능한 출력/로컬 사본이다. Git 저장소를 실시간 협업 DB로 사용하지 않는다.

## 2. 실행 구조

브라우저: React + CodeMirror 6 + Yjs → 로컬 암호화 persistence/outbox → E2EE provider → WebSocket.
CLI: TUI editing transaction → 같은 Yjs/E2EE client → 같은 WebSocket.
서버: TLS reverse proxy → account API + encrypted relay → PostgreSQL → 별도 서버/업체의 암호화 백업.

CodeMirror는 DOM 입력/선택/undo를, Yjs는 동시 편집 병합을 담당한다. [CodeMirror 문서](https://codemirror.net/docs/guide/)와 [Yjs 문서](https://docs.yjs.dev/)에 근거한 구성이다. Node 의존 파일 I/O와 터미널 renderer는 브라우저 bundle에 포함하지 않는다.

제안하는 점진적 코드 구조:

```text
apps/cli          기존 Ink TUI와 CLI
apps/web          브라우저 편집기, 계정/공유/키관리 화면
apps/server       인증 API, 권한, 암호문 relay/영속화
apps/desktop      native 파일/키체인 adapter, 창 관리
packages/core     문서 ID, 편집 transaction, Markdown 기능, 메시지
packages/sync     Yjs binding, outbox, 암호화 transport, 재접속
packages/crypto   검증된 암호 라이브러리 wrapper, envelope/schema
packages/storage 브라우저/Node 저장 adapter
```

디렉터리를 한꺼번에 옮기지 않는다. 현재 공개 npm CLI 경로를 유지한 채 core와 adapter를 먼저 추출한다. TUI 전체를 웹 터미널로 올리는 방식은 서버 shell 노출과 사용자별 프로세스 비용 때문에 채택하지 않는다.

## 3. E2EE 신뢰 경계

암호화 대상: 문서 본문, 제목/경로, workspace 이름, 버전 snapshot, 협업 커서/선택 범위 및 표시 이름 등 presence payload. 서버가 알아야 하는 정보: 계정/기기 ID, opaque workspace/doc ID, 멤버 권한, epoch, 접속 시각, 암호문 크기, 전송 순서. E2EE는 이 메타데이터를 숨기지 않는다.

서버에는 문서 대칭키·기기 개인키·복구키를 평문으로 저장하지 않는다. 서버 DB 유출을 막는 저장 암호화와 E2EE는 별도 개념이다. TLS는 E2EE와 함께 사용한다.

웹 앱이 해킹되어 악성 JavaScript를 배포하면 열린 문서와 메모리의 키를 훔칠 수 있다. 웹 E2EE는 이 한계를 없애지 못한다. 앱 origin에는 광고/analytics/외부 실행 스크립트를 넣지 않고 CSP, 의존성 고정, release 검토를 적용한다. 더 강한 배포 신뢰는 서명된 desktop/client로 제공한다. 악성 협업자는 받은 문서를 복사할 수 있으며 철회로 과거 사본을 삭제시킬 수 없다.

## 4. 키와 공유 설계

로그인과 문서 복호화는 분리한다. 초기 로그인 후보는 기존 방향에 맞춘 GitHub OAuth이며 로그인 세션으로 암호키를 재생성하지 않는다.

- 기기마다 암호화용 키쌍과 서명용 키쌍을 생성한다. 기기 등록에는 기존 신뢰 기기 또는 복구키 승인이 필요하다.
- 계정 복구 bundle은 무작위 고엔트로피 복구키로 암호화한다. 기존 기기/복구키를 모두 잃으면 로그인 복구만으로 문서를 복원할 수 없다. 이를 가입/복구 화면에서 확인한다.
- workspace마다 랜덤 epoch 키를 만들고 승인된 멤버 기기에 개별 key envelope로 전달한다. workspace 전체 공유이므로 키 권한과 화면 권한이 일치한다.
- 공개키는 owner가 서명한 membership manifest와 기기 인증 chain에 연결한다. 최초 상대 키 신뢰에는 별도 채널 fingerprint/QR 확인을 제공한다. 서버가 임의로 바꾼 키를 자동 신뢰하지 않는다. 단순 이메일 초대만으로 악성 서버의 키 바꿔치기까지 방어한다고 주장하지 않는다.
- reader도 공유 대칭키를 알기 때문에 AEAD만으로 쓰기 권한을 검증할 수 없다. update마다 기기 서명이 필요하며 수신자는 해당 epoch의 writer 권한까지 검증한다.
- 퇴장/기기 분실: 기존 소켓 종료, membership version 증가, epoch 변경, 새 키를 남은 멤버 기기에 재배포한다. owner 기기가 새 epoch checkpoint를 생성·검증할 때까지 rotation을 완료 처리하지 않는다. 이전 epoch 쓰기는 거절하고 최신 권한으로 재가입한다.
- offline 기기의 옛 epoch 편집은 자동 투입하지 않는다. 여전히 승인된 기기가 최신 상태를 받은 뒤 로컬 fork를 비교·복원하게 한다. 신규 멤버의 과거 이력 열람은 별도 정책이며 기본은 현 상태부터다.

암호 primitive 후보는 libsodium의 XChaCha20-Poly1305, 공개키 envelope, 분리된 서명 키다. [XChaCha 공식 문서](https://doc.libsodium.org/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction)는 큰 nonce 공간과 무작위 nonce 사용을 설명한다. 직접 암호 알고리즘을 작성하지 않는다. 기존 scrypt/HKDF/AES-GCM 메모는 단일 비밀번호 구상으로, 협업 key lifecycle 전체를 해결하지 않는다. 최종 알고리즘 suite/키 직렬화/구현 라이브러리는 호환성 spike와 별도 보안 리뷰를 거쳐 version 1로 고정한다.

브라우저 디스크에는 암호화된 update/key bundle만 보관하며 unlock secret은 메모리에 둔다. 기본 y-indexeddb는 평문 Yjs 상태를 저장하므로 그대로 쓰지 않고 암호화 adapter가 필요하다. CLI/desktop은 OS keychain과 보호된 로컬 저장소를 사용한다. 로그인 로그아웃과 vault 잠금은 구분한다.

## 5. 암호문 협업 프로토콜

Yjs의 update는 중복·역순 전달에 강하고 모든 update를 받으면 수렴한다. 이는 인증/인가나 암호화를 제공한다는 뜻이 아니다. [Yjs update API](https://docs.yjs.dev/api/document-updates).

기본 y-websocket 서버가 평문 Y.Doc를 다루는 구조는 그대로 채택하지 않는다. custom E2EE provider와 암호문 relay를 구현하며 서버에서 Yjs 병합·state vector 계산·검색을 하지 않는다.

저장 envelope 초안:

```text
protocolVersion, workspaceId, docId, epoch, membershipVersion,
deviceId, updateId, kind, nonce, ciphertext, signature
```

protocol/doc/epoch/device/kind/update ID 등을 AEAD associated data에 묶고, 정규화된 header+ciphertext에 서명한다. 암호문을 다른 문서·epoch로 옮기는 공격을 거부한다. 같은 updateId로 다른 payload가 오면 오류로 처리한다. nonce는 키별 유일성을 보장한다.

1. 편집을 로컬 transaction으로 적용하고 암호화된 outbox에 기록한다. UI는 `이 기기에 저장됨`을 표시한다.
2. 연결 인증, origin 검증, workspace ACL과 writer 기기 서명을 확인한다.
3. `(docId, epoch, updateId)` 고유 제약으로 중복 저장을 막고 문서별 순서 번호를 부여한다.
4. PostgreSQL durable commit 후에만 `서버에 저장됨` ACK를 보낸다. 전달과 durable ACK를 구분하며 재시도는 안전해야 한다.
5. 다른 기기는 서명/권한/AEAD를 확인한 뒤 복호화하고 Yjs에 적용한다. 잘못된 update는 격리하고 로컬 사본을 보존한다.
6. 재접속 시 마지막 durable cursor 이후 암호문을 받아 재생한다. presence는 TTL이 있는 암호화된 임시 데이터이며 DB 이력에 저장하지 않는다.

멤버 철회는 연결 시뿐 아니라 append 시에도 확인한다. view-only 소켓의 쓰기를 차단한다. 토큰을 URL query/log에 노출하지 않고 웹은 HttpOnly Secure 세션과 origin 검증, CLI는 별도 revoke 가능한 기기 인증을 사용한다.

단일 relay 인스턴스로 시작하면 room 순서/브로드캐스트가 단순하다. 증설 시 docId 단위 shard owner와 fencing을 도입하거나 공유 pub/sub을 추가한다. Redis pub/sub만으로 durable 저장을 대체하지 않는다.

## 6. 이력, compaction, offline 처리

서버는 암호문을 병합할 수 없으므로 이력을 무제한 유지하면 저장소가 빨리 찬다. 승인된 owner 기기가 문서의 update를 재생하고 암호화 checkpoint를 만든다.

- checkpoint는 document generation, epoch, 포함한 durable sequence, client 검증 가능한 log digest/chain, 서명을 포함한다. Yjs 전체 상태를 보존하며 단순 Markdown 문자열을 snapshot으로 사용하지 않는다.
- 서버는 동일 epoch/generation과 expected sequence를 비교한 후 checkpoint를 CAS로 등록한다. 이후 도착한 tail update는 유지한다.
- 초기 베타는 rollback 가능한 기간 동안 이전 snapshot/log를 보존한다. owner와 두 번째 기기의 복구 검증 전에는 로그를 지우지 않는다. 적절한 기기가 없으면 compaction을 연기하고 quota로 제한한다.
- CRDT 내부 이력의 GC/epoch reset은 별도 작업이다. offline client의 오래된 update가 더 이상 적용 가능하지 않으면 local recovery branch를 제공한다. 조용히 버리지 않는다.
- 서버의 log 누락·rollback은 최신 checkpoint를 아는 기기에서 탐지한다. 새 기기의 강한 freshness 보장은 기존 신뢰 기기의 checkpoint 확인이 필요하다. 프로토콜이 모든 악성 서버 fork를 자동 방지한다고 약속하지 않는다.
- Markdown 복원은 현재 협업 문서에 대한 새 transaction으로 적용한다. 오래된 DB row로 전체 문서를 덮어쓰지 않는다.

## 7. 로컬 파일과 협업의 연결

문서 ID와 로컬 path를 별도 mapping으로 관리한다. 기존 `.md`를 처음 연결할 때 CRDT를 한 번 초기화하고 모든 기기가 같은 ID를 사용한다. 각 기기에서 독립 초기화하면 중복 본문이 생길 수 있다.

협업 중 외부 에디터가 파일을 바꾸면 마지막 materialized 버전·현재 Yjs 상태·새 디스크 내용을 비교한다. 단순 변경은 transaction으로 변환하고 겹치는 변경은 비교/복구 UI로 보낸다. 전체 delete+insert를 자동 반복하지 않는다. watcher는 자체 저장 hash를 식별하고 파일 경로가 같은 두 기기의 독립 덮어쓰기를 차단한다.

협업 undo는 사용자 자신의 transaction origin만 추적한다. AI rewrite는 요청 시 문서 ID, 선택 상대 위치와 원문 hash를 기록하고 accept 시 재검증한다. Git은 로컬 파일의 명시적인 버전 관리 기능으로만 유지한다.

## 8. 서버 데이터 모델과 경계

| 테이블/저장소 | 내용 |
|---|---|
| users / sessions | 계정과 로그인 세션, 문서 키 제외 |
| devices | 공개키, 승인 chain, revoke 시각 |
| workspaces / members | opaque ID, owner/editor/viewer, membership version |
| key_envelopes | recipient device별 암호화 epoch key와 서명 |
| documents | opaque ID, workspace, generation, tombstone |
| encrypted_updates | envelope, sequence, 바이트 수, durable timestamp |
| encrypted_snapshots | 암호화 checkpoint, coverage, digest, 서명 |
| quota_usage / audit_events | 암호문 사용량, 권한/관리 이벤트, 본문 미포함 |

모든 쿼리와 다운로드는 계정/멤버 범위로 제한한다. 서버의 경로 접근에는 사용자 파일명을 쓰지 않는다. 문서 rename/title은 암호화 manifest update로 처리한다. 삭제는 tombstone으로 전파하고 복구 기간 뒤 purge한다.

quota는 암호문 바이트, 이력, 문서 수, 연결 수, update 크기/속도에 대해 서버에서 원자적으로 검사한다. 기존 문서의 “서버가 .md 확장자/본문 타입 강제”는 파일명까지 E2EE인 설계에서는 불가능하다. 클라이언트는 타입을 검사하고 서버는 형식화된 암호문과 크기/권한만 검사한다.

아래는 제안하는 베타 제한으로 가격/제품 약속은 아니다: workspace 5명, 문서 1MiB, 암호화 update frame 256KiB, 큰 snapshot은 최대 16MiB 업로드 경로로 별도 처리, 접속 3개/기기, 압축 해제/CRDT replay 시간과 메모리 제한. 한도를 넘는 정상 문서는 내보내기/복구 경로를 제공한다.

복호화 후 악성 CRDT payload와 매우 큰 문서도 가능하므로 Web Worker에서 검증/적용하고 리소스 제한을 둔다. 서버는 body가 암호화되어 있으므로 본문 유효성을 검사할 수 없다.

## 9. 검색, AI, 내보내기

- 본문 검색과 Markdown 렌더링은 복호화한 클라이언트에서 수행한다. 서버 full-text search는 초기 범위에 없다.
- HTML 렌더링은 sanitize와 sandbox를 통과한다. E2EE 문서의 외부 이미지 자동 로드는 상대 서버에 접속 정보를 노출할 수 있어 기본 차단한다.
- BYOK API key는 공용 서버 DB/로그에 저장하지 않는다. CLI/desktop은 로컬 endpoint를 호출한다.
- 브라우저에서는 제공자의 CORS 허용 여부에 따라 직접 호출 가능성이 달라진다. 직접 호출 불가 시 AI를 비활성화하거나 별도의 명시적 동의 relay 기능으로 분리한다. 서버 relay는 요청 평문을 볼 수 있으므로 “AI 처리까지 서버가 모른다”는 약속을 할 수 없다.
- 어떤 방식이든 AI를 실행하면 선택한 내용이 모델 제공자에게 전달됨을 표시한다. E2EE 저장과 AI 제공자 전송은 구분한다. 자동으로 모든 공유 문서를 컨텍스트로 보내지 않는다.
- 초기 범위에는 서버 LLM inference를 포함하지 않는다. GPU 없는 VPS의 RAM 크기를 AI 응답 용량으로 계산하지 않는다.

## 10. Contabo 견적 평가

공식 [상품 포트폴리오](https://help.contabo.com/en/support/solutions/articles/103000408463-can-i-get-more-information-about-contabo-s-server-portfolio-)에서 일치하는 구성은 Core의 Cloud VPS 16: 16 vCore, RAM 64GB, 500GB SSD, 1Gbit/s port, snapshot 3개다. CPU 모델은 프로비저닝 시 가용성에 따라 배정된다. 이것이 실제 주문 상품인지는 장바구니에서 확인해야 한다. 500GB를 NVMe 또는 HDD로 단정하지 않는다.

Contabo는 [VPS가 공유 자원을 사용한다고 설명한다](https://help.contabo.com/en/support/solutions/articles/103000271608-can-i-setup-mining-on-my-server-). 16 vCore를 독점 물리 16코어 성능으로 계산하지 않는다. €29.6은 사용자 견적으로 유지하며 공식 주문 페이지의 실제 결제 가격은 확인하지 못했다.

판단: 월 €29.6이 지속 가능한 실제 요금이고 조건이 맞으면 개발·초기 초대 베타용으로 합리적인 후보다. 텍스트 협업 서비스의 첫 서버로 메모리는 넉넉하다. 다만 이 사양만으로 유료 서비스 가용성/동시 사용자 수를 보장할 수 없다. 초기에는 월 단위 시험 운영을 권장하고 지역·CPU steal·디스크 commit latency를 측정한다.

확인할 구매 조건: 세금, 지역 추가금, setup fee, 약정/프로모션 종료 가격, SSD/NVMe, IPv4 비용, traffic/FUP, backup 별도 가격, 해지/이전 조건. 한국 사용자 중심이면 실제 한국 회선에서 후보 지역의 RTT를 비교한다. CDN은 정적 자산에는 유리하지만 편집 변경의 origin 왕복 지연을 제거하지 않는다.

€29.6 × 12 = €355.2/년(서버만, 같은 요금 유지 가정). 예산 편성을 위한 임시 여유분으로 외부 백업/모니터링/메일 등에 월 €10–20을 추가하면 월 €39.6–49.6 수준이다. 이는 별도 업체의 검증된 견적이 아니며 LLM API 비용·세금은 제외한다.

Contabo [Auto Backup](https://help.contabo.com/en/support/solutions/articles/103000331723-how-do-i-order-the-auto-backup-add-on-)은 선택 부가서비스이며 일일 off-server 백업을 최대 10일 보관한다고 설명한다. 이 제품을 쓰더라도 별도 계정/장애영역의 복구본과 DB restore 시험을 갖춘다.

## 11. 단일 서버 운영과 측정

초기 배포 제안: Ubuntu/Debian 지원 버전, Caddy 또는 Nginx TLS, container compose, web static build, API, relay, PostgreSQL, 백업 job, 제한된 메트릭 수집. K8s와 검색 클러스터는 첫 배포에 필요하지 않다. 운영 서버에서 CI build나 범용 AI 추론을 같이 돌리지 않는다.

리소스 계획의 시작값(성능 측정값 아님): API/relay 합계 4–8GB, PostgreSQL 상한 8–16GB, OS/cache/운영 도구 8–16GB, 나머지 여유. Node 프로세스 한 개가 16코어를 자동 활용하지 않으며 메모리 제한, connection pool, room 단위 부하를 관측한다.

500GB 전체를 사용자 할당량으로 판매하지 않는다. 예시 계산: OS/운영 50GB + DB/WAL/maintenance 여유 100GB + 작업/복구 공간 50GB를 남기면 약 300GB가 남는다. 사용자당 현재 문서 5MB, snapshot/update 포함 5배 저장을 가정하면 300GB/25MB ≈ 12,000명분의 저장량이다. 이는 가정에 따른 디스크 계산이며 가입자/동시접속 보장이 아니다. compaction이 없으면 이 배수는 훨씬 커진다.

첫 부하 시험 시나리오: 50→200→500 WebSocket 연결, 10/100KB/1MiB 문서, 10–30% active writer, active writer당 초당 2회 update, 방당 2/5/20명, 30분 지속 + 재접속 burst. broadcast fanout, 서명 검증 CPU, durable ACK p95/p99, event-loop lag, CPU steal, PostgreSQL fsync/WAL, DB queue, 메모리, 클라이언트 replay 시간을 측정한다. 500명 수용을 사양만 보고 약속하지 않는다.

목표 제안: 선택 지역 RTT와 별도로 서버 처리 p95 100ms 이내, 통상 원격 반영 300ms 이내를 시험 목표로 삼고 실제 원거리 사용자는 측정 결과로 조정한다. update 유실 0, 권한 위반 0, 재시도 중복 안전성은 필수다.

보안/운영: HTTPS만 공개, DB 비공개, 관리 SSH 제한, 비루트 서비스, secret rotation, 프로세스 제한, 디스크 70/80/90% 경보, 외부 health probe, 본문/키 제외 로그, 의존성 업데이트, rolling 재시작 시 outbox 재전송 확인.

초기 복구 목표 제안: 프로세스 재시작은 durable ACK 받은 update 유실 0; 서버 전체 손실은 외부 DB base backup+WAL 보관이 검증됐을 때 RPO 15분/RTO 4시간. 일일 snapshot만으로 이 목표를 주장하지 않는다. 정기 restore drill에서 계정/ACL/envelope/checkpoint/tail을 함께 복원하고 마지막 승인 기기로 복호화한다. 복호화 키 없이 백업을 복원해도 내용은 읽을 수 없어야 한다.

단일 VPS는 단일 장애점이다. 유료 SLA가 필요해지면 먼저 DB/relay 장애 대응과 외부 복제/백업을 분리한다. 단순 고사양 업그레이드만으로 가용성이 올라가지는 않는다. 여러 relay로 확장할 때의 shared authorization/revocation과 room routing도 그 시점에 검증한다.

## 12. 구현 순서와 출시 조건

1. **기존 편집기 안정화:** review R1–R5와 undo/Unicode 회귀 테스트, 문서 ID/transaction/state adapter 추출. 완료 조건: 저장/탭 전환/세션 복구에서 데이터 손실 없음.
2. **웹 로컬 편집:** CodeMirror, local vault 잠금, 암호화된 로컬 복구, sanitize preview, Markdown import/export. 완료 조건: offline reload와 키 잠금/재해제 시험.
3. **E2EE 협업 vertical slice:** 두 브라우저가 한 문서를 편집하고 암호문 DB만으로 재시작 복원. 완료 조건: 동시 수정/삭제/undo 수렴, duplicate/out-of-order/reconnect, 서버 DB/로그에 plaintext 없음.
4. **공유·복구·철회:** 기기 승인, 서명된 membership, viewer 쓰기 거절, epoch rotation, 분실 기기, 복구키, 신규 멤버 현재 상태 열기, malicious key substitution 시험.
5. **동기화와 내구성:** CLI adapter, 파일 watcher 충돌, checkpoint compaction과 오래된 offline 기기 복구, quota, 삭제/복구.
6. **Contabo 초대 베타:** 배포/백업/restore drill/부하 시험, 외부 cryptographic protocol review, 실제 지역 지연 확인. 완료된 측정 범위로 인원 제한 후 운영.

E2EE는 마지막에 붙이는 기능이 아니다. key lifecycle·암호문 transport·권한 검증·복구가 설계의 중심이며, 두 브라우저의 간단한 편집 성공만으로 공개 출시하지 않는다.
