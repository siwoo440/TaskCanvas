---
# 27일차 회원 접근 권한 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 기존 게스트 데이터를 보존하면서 회원의 작업실 참여·전환·역할 검사와 실시간 세션 무효화를 구현한다.

**Architecture:** guest_user_links와 기존 역할 검사를 재사용한다. guest_sessions를 회원 로그인 세션에 종속시키고 realtime_tickets를 발급 게스트 세션에 결합한다. HTTP와 Socket.IO가 같은 소유·만료·역할 조건을 검사한다.

**Tech Stack:** PHP 8.2, MariaDB/InnoDB, Node.js, Socket.IO, 기존 HTML/CSS/JavaScript. 신규 제품 의존성 없음.

**Spec:** [승인된 상세 설계](../specs/2026-10-18-day27-member-access-design.md)

---
## 공통 제약

- 기존 guest_id·업무·멤버십·업로드 참조 보존. 이름만으로 회원 소유 연결 금지.
- 연결은 회원 비밀번호와 유효한 게스트 세션을 함께 검증. 연결 해제·소유 이전 API 제외.
- 모든 신규·수정 코드에 Allman 스타일과 줄별 짧은 한글 명사형 주석 적용.
- 기존 X-TaskCanvas, HttpOnly·SameSite·Secure 설정, no-store, 요청 제한 유지.
- 유휴 소켓 인증 재검사는 1000ms. 각 수신 이벤트도 인증 검사. DB 오류 시 접근 거부.
- 테스트는 임시 DB와 예약한 별도 포트 사용. 개발 DB 초기화 금지. 테스트 서버 식별·포트 충돌 보호 유지.
- 39일차 멤버 관리와 통계·대시보드는 제외. 학교 PC 4대 AC15는 실제 실행 전 완료로 표시하지 않음.
- 작업 브랜치는 codex/day27-member-access. 단계별 로컬 커밋 후 검증 결과를 보고하고, 원격 통합 상태를 정확히 구분.

---
## 파일 책임

| 파일 | 책임 |
|---|---|
| database/schema.sql, apps/php-api/src/Schema.php | 세션·티켓 결합 컬럼과 동일한 신규/보정 정의 |
| apps/php-api/src/Auth.php, MemberAuth.php | 세션 발급·유효성·회원 세션 ID 내부 조회 |
| apps/php-api/src/MemberWorkspace.php | 회원 게스트 생성·연결·작업실 조회·전환·초대 트랜잭션 |
| apps/php-api/src/controllers/MemberWorkspaceController.php | 입력·CSRF·응답 처리 |
| apps/php-api/src/controllers/GuestController.php, ProjectController.php, MemberAuthController.php, TicketController.php | 기존 경로 보호와 회원 흐름 결합 |
| apps/php-api/public/index.php | 상세 설계의 신규 API 4개 등록 |
| apps/realtime/src/auth.js, session-guard.js | 결합 티켓 소비·활성 소켓 인증 검사 |
| apps/realtime/src/server.js, handlers/board.js, handlers/project.js | 가드·감시 시작 및 서버 검증 세션 정보 저장 |
| apps/frontend/public/js/member-workspaces.js | 회원 작업실 목록·초대·게스트 연결 UI |
| apps/frontend/public/index.html, css/member-auth.css, js/app.js, js/member-status.js, js/realtime.js | 화면 배치·선택·로그아웃·재연결 처리 |
| apps/php-api/tests/member-access-schema.php | 신규 컬럼·기존 보정·보존·재실행 검사 |
| apps/realtime/scripts/test-member-access.js | 격리된 실제 HTTP·Socket.IO 통합 검사 |

---
## 검토 시 집중할 경계 조건

1. 같은 회원의 여러 게스트가 한 작업실에 중복 참여: 최고 역할, 동률은 작은 guest_id 선택. 담당자 행 병합 금지. 작업 2에서 검증.
2. 다른 회원으로 로그인 전환·같은 회원 재로그인: 이전 회원 세션에 종속된 게스트 쿠키·티켓·소켓 거부. 작업 2·3에서 검증.
3. 이름 재입장·게스트 연결의 동시 요청: 연결된 게스트 세션 탈취나 중복 연결·초대 차감 방지. 작업 2에서 별도 PHP 서버 프로세스의 동시 요청으로 검증.
4. DB 오류·유휴 소켓·연결 직후 로그아웃: 가드가 열린 상태로 통과하지 않고 수신 이벤트 차단 및 감시 주기 후 방 제거. 작업 3에서 검증.
5. 다중 탭·미연결 게스트와 로그인 공존: 자동 소유 이전 금지, 작업실 전환 후 서버와 화면의 guest_id 일치. 작업 4에서 브라우저 검증.

---
## 작업 1 — 세션과 티켓의 데이터 기반

**Files:** schema.sql, Schema.php, 새 member-access-schema.php. reset-demo.php는 외래키 대응 필요 여부를 확인하고 해당하는 경우만 수정.

**Interfaces:** guest_sessions.user_session_id는 NULL 또는 user_sessions.session_id, ON DELETE CASCADE. realtime_tickets.guest_session_id는 NULL 또는 guest_sessions.session_id, ON DELETE CASCADE. 인덱스·타입·컬럼 위치·제약 이름을 신규 설치와 보정에서 일치시킨다.

- [x] 신규 설치·25/26일차 DB 보정·반복 실행 테스트 작성. 컬럼 부재 실패를 확인. 기존 데이터 비교는 컬럼 추가 전 필드와 행을 기준으로 수행.
- [x] 무효한 외래키 저장 거부, 회원 세션 삭제 시 종속 게스트 세션·티켓만 삭제, 기존 미연결 게스트 데이터 보존 검사 추가.
- [x] schema.sql과 Schema.php에 두 컬럼·외래키·인덱스 추가. 기존 행의 새 컬럼은 NULL 유지.
- [x] `C:\xampp\php\php.exe apps/php-api/tests/member-access-schema.php` 실행. 신규/보정 동일·보존·재실행 통과 확인. 기존 member-schema.php도 실행.
- [x] 해당 파일만 로컬 커밋: `feat: 회원 접근 세션과 실시간 티켓 결합 데이터 추가`.

---
## 작업 2 — HTTP 회원 권한과 작업실 흐름

**Consumes:** 작업 1의 컬럼. 기존 Request, Database, Auth::rank(), MemberAuth::verifyPassword(), Throttle, Invite 정책.

**Produces:** Auth::issueSession(int $guestId, ?int $userSessionId = null): int는 발급 게스트 세션 ID 반환. MemberAuth::issueSession(Request $request, int $userId): int는 새 회원 세션 ID 반환. MemberAuth::currentUser() 내부 배열에 user_session_id 추가, publicUser() 필드 유지. MemberWorkspace의 public 메서드는 아래 이름 사용.

- `workspaces(array $user): array`: 회원 연결 작업실을 project_id·title·role·guest_id로 반환. 최고 역할·작은 guest_id 순으로 중복 제거.
- `restore(Request $request, array $user): void`: 유효한 미연결 게스트는 보존, 그 외 본인 게스트 선택 또는 생성 후 종속 세션 발급.
- `linkGuest(Request $request): array`: 현재 세션과 재확인 비밀번호로 연결하고 새 종속 세션 발급.
- `selectWorkspace(Request $request, int $projectId): array`: 회원 멤버십만 선택하고 종속 세션 발급.
- `joinWorkspace(Request $request, string $inviteCode): array`: 본인 게스트에 초대 역할 추가, 기존 멤버십은 보존.

- [x] test-member-access.js에 임시 DB·PHP 서버 생성/정리와 서버 식별을 구성. GET /api/auth/workspaces가 404로 실패하는 것 확인.
- [x] 신규 회원 복원, A/B 격리, 본문 ID 위조, 비밀번호 실패·제한, 멱등 연결·충돌, 동명이인 거부, 연결 전 세션·티켓 거부 테스트 추가.
- [x] 새 MemberWorkspace와 컨트롤러 작성. 상세 설계의 GET workspaces·POST guest-link/select/join 등록. 비밀번호 필드 검증은 기존 26일차 규칙 재사용. 응답은 기존 guest·project_id·role 형식 유지.
- [x] Auth::currentGuest()에서 게스트 세션의 회원 결합·소유·만료 검사. MemberAuthController 로그인은 restore 호출, 로그아웃은 회원 종속 세션만 폐기하고 독립 게스트 세션은 보존.
- [x] GuestController 이름 재입장 경로에서 회원 연결 재사용 차단. 연결·이름 조회·초대 가입은 회원/게스트/초대 행 잠금의 일관된 순서를 사용하고 트랜잭션 안에서 유효성을 재확인.
- [x] ProjectController 회원 생성과 GuestController::me() 회원 목록 결합. TicketController는 발급 세션 ID 저장. 쿠키 발급은 DB 저장 성공 후 수행, 실패 시 미완료 연결 롤백.
- [x] 다른 회원 작업실 API·티켓 403, viewer 쓰기 거부, editor 관리 거부, admin 성공, 초대 한도·재입장·만료·폐기·동시 중복 차감 방지, 다중 게스트 역할 결정 검사.
- [x] 두 PHP 서버 프로세스로 같은 게스트 동시 연결과 연결/이름 재입장 경쟁 실행. 연결 후 타인 세션 거부와 초대 차감 정확성 확인.
- [x] `node apps/realtime/scripts/test-member-access.js` HTTP 검사 통과. 기존 test-member-auth.js·test-auth-port-safety.js·tests/env.php 실행. 의도된 로그인 게스트 복원 변경만 기대값 조정, 기존 독립 게스트 로그아웃 보존 검사 유지.
- [x] HTTP 구현과 테스트 로컬 커밋: `feat: 회원 작업실 초대·전환과 검증된 게스트 연결`.

---
## 작업 3 — 실시간 인증과 만료 연결 정리

**Consumes:** 티켓의 guest_session_id, 세션의 user_session_id, guest_user_links, 기존 역할·방·presence·잠금 정리.

**Produces:** auth.validSession(guestSessionId, guestId, projectId): Promise<boolean>, session-guard.register(io, socket): void, session-guard.startWatcher(io): void. 티켓 소비 응답은 내부 guest_session_id와 user_session_id를 포함한다.

- [x] 통합 테스트에 보드·작업실 소켓 생성과 ACK 검사 추가. 로그아웃 전 티켓으로 로그아웃 후 연결이 성공하는 현재 문제를 실패 테스트로 확인.
- [x] auth.js 티켓 소비에 발급 세션·회원 소유·만료·최신 멤버십 검사 추가. 결합 없는 이전 티켓과 다른 대상의 티켓은 거부.
- [x] board/project 참여 시 확인된 세션 ID를 socket.data에 저장. 참여 직후 상태 변경을 포함해 감시 대상 등록 전에 인증 재확인.
- [x] session-guard.js 공통 수신 가드와 1000ms 감시 구현. 초기 join은 티켓 검증 경로로 처리, 참여 후 다른 이벤트는 validSession 성공 후만 next 호출. 실패 ACK 뒤 disconnect, 조회 예외도 동일하게 차단.
- [x] 감시 작업 중첩을 막고 연결 해제 때 기존 presence·잠금 정리 사용. 세션 없는 연결은 제한 없이 인증된 방에 참여하지 못하도록 유지.
- [x] 로그아웃·회원 만료·게스트 만료·재로그인·최초 연결·멤버십 삭제 후 미사용 티켓과 활성 보드/작업실 소켓 차단 검사. 다른 브라우저 세션 유지 확인.
- [x] DB 조회 오류를 제어된 테스트로 재현해 가드의 접근 거부 확인. 유휴 소켓은 1000ms에 DB 처리 여유를 더한 3000ms 이내 disconnect 확인. 원래 역할 검사와 방 범위 혼용 검사 유지.
- [x] `node apps/realtime/scripts/test-member-access.js` 전체 HTTP/소켓 통과 후 로컬 커밋: `feat: 실시간 티켓의 회원 세션 검증과 만료 연결 해제`.

---
## 작업 4 — 회원 작업실 화면과 전환

**Consumes:** 작업 2의 API, 기존 bootstrap(preferredProjectId), Realtime, window.api.

**Produces:** member-workspaces.js는 상태 조회·회원 작업실 선택·초대·연결을 담당. app.js의 기존 작업실 전환은 회원일 때 select 성공 후 bootstrap(projectId) 호출. 회원 상태 변경은 `taskcanvas:member-change` CustomEvent의 detail.user로 전달하고 서버 인증을 대체하지 않는다.

- [x] 브라우저에서 현재 회원의 작업실 목록·초대·게스트 연결 UI가 없는 상태를 확인하고 구현 전 기준 기록.
- [x] 홈 회원 영역에 작업실 목록·초대 폼·현재 게스트 연결 버튼 추가. 비밀번호 재확인 dialog는 취소·완료·pagehide 때 값 정리. 오류는 안전한 textContent로 표시.
- [x] member-status.js는 조회/로그인 상태 변경·로그아웃 시 이벤트 전달. app.js는 서버 상태 재확인 후 기존 보드·업무·실시간 연결을 정리하고 새 작업실 로드. 다중 탭 복귀도 서버 세션을 재확인.
- [x] realtime.js에 인증 만료 안내와 재접속 중단 처리 추가. 일반 네트워크 복구 동작 유지, INVALID_TICKET은 무한 자동 재시도 금지.
- [x] 실제 브라우저에서 두 테스트 회원의 작업실 생성·초대·미연결 게스트 연결·전환·새로고침·로그아웃·다른 탭 계정 변경 확인. 표시 역할·활성 guest_id·담당자 보존 확인.
- [x] 360px 너비에서 목록·초대·dialog 버튼 접근 확인. 임의 테스트 비밀번호를 지우고 결과 화면 스크린샷 저장. 작업 파일 JS 문법·diff 검사 후 로컬 커밋.

---
## 작업 5 — 통합 검증과 완료 기록

**Files:** README.md, docs/07-http-api.md, docs/10-wbs-timeline.md, docs/11-acceptance-tests.md, docs/12-risks-security.md, docs/README.md, 새 docs/27-member-access.md, apps/php-api/README.md.

- [x] 테스트별 통과 수·수동 미실행 항목을 기록. 이전 25/26일차 문서의 현재 상태 설명도 회원 연결 구현 범위에 맞게 갱신.
- [x] 새 분리 DB 검사·기존 인증·스키마·환경·포트 충돌 검사 재실행. 모든 변경 PHP에 php -l, JS에 node --check, git diff --check 실행.
- [x] 별도 임시 DB·절대 UPLOAD_DIR·독립 포트의 기존 acceptance.js 실행. 현재 스크립트가 기본 개발 DB를 사용할 수 있으므로 DB_NAME을 임시 DB로 지정하고 하위 프로세스 설정 전파를 확인한 후 실행. 종료 후 생성한 테스트 자원만 정리.
- [x] 전체 브랜치 검토에서 세션 미검사 경로·역할 우회·이름 탈취·프런트 상태 불일치 확인. 발견된 문제 수정과 해당 회귀 검사 통과 후 종료.
- [x] 27일차 구현 결과 문서에 실행 환경·정확한 검증 결과·1초 감시 한계·AC15 미실행을 명시하고 로컬 커밋.
- [x] 최종 변경 요약·검증·커밋·원격 통합 상태를 보고. 설계/계획 커밋과 구현 결과를 구분하고 미검증 기능을 완료로 표기하지 않음.

---
## 계획 자체 검토

승인된 설계의 데이터·HTTP·초대·게스트 보호·실시간·화면·회귀 검증을 작업 1~5에 배정했다. 단계 간 메서드·응답 필드를 일치시켰다. 기존 참조 보존과 세션 결합 없는 이전 티켓 거부를 함께 반영했다. 동시 연결·다중 게스트·다른 브라우저·DB 오류·다중 탭은 각 담당 작업에서 검증한다.

---

## 실행 결과와 보완

직접 구현과 별도 전체 코드 검토 완료. 연결 저장 실패 시 원자성, 미연결 게스트 탭 복귀, 이전 소켓의 늦은 인증 실패 문제를 각각 실패 회귀 테스트로 재현한 뒤 수정했다. 단계별 결과는 [27일차 기록](../../27-member-access.md) 참고. 사용자 요청에 따라 작업 브랜치를 main에 통합하고 main 외 로컬·원격 브랜치를 삭제했다. 기존 로컬 실행 경로를 유지했으며 회원에게 사용할 수 없는 이름 기반 재입장 코드 카드는 숨겼다.
