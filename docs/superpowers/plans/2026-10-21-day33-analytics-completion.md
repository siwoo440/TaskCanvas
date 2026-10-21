---

# 33일차 데이터 분석 완성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 공통 필터, 실제 상태 이력, 정확한 추이, CSV 내보내기, 차트 드릴다운을 하나의 일관된 분석 흐름으로 구현한다.

**Architecture:** 기존 `AnalyticsFilters`와 `AnalyticsDashboard`를 공통 조회 계약으로 유지하고 상태 변경 경로에서 이력을 원자적으로 기록한다. 대시보드·상세 목록·CSV는 같은 서버 필터를 사용하며 프론트엔드는 서버가 반환한 적용 조건만 화면 상태로 확정한다.

**Tech Stack:** PHP 8, MySQL/MariaDB, 순수 JavaScript, Chart.js, Node.js 테스트 러너, Socket.IO

**진행 결과:** 구현·검증 완료. 대시보드 API50·분석 이력7·CSV8·이력 스키마11·실시간 핸들러 통합·분리 수용 자동28/보안2/운영1 통과. 단일 커밋과 main 푸시는 최종 전달 단계에서 수행.

**Spec:** `docs/superpowers/specs/2026-10-21-compressed-roadmap-design.md`

---

## Global Constraints

- 기존 게스트·회원 세션과 관리자·편집자·열람자 권한 계약 유지
- 기존 1~32일차 데이터 보존
- Asia/Seoul 기준 날짜 처리
- 기록되지 않은 과거 상태 이력 추정 금지
- 화면과 CSV의 필터·집계 원본 일치
- 사용자 작성 코드의 Allman 스타일과 줄별 짧은 한글 주석 유지

---

## Review Focus

- 같은 요청의 재시도로 상태 이력이 중복되지 않는지 검사
- 삭제되거나 다른 작업실에 속한 담당자·업무·보드의 접근 차단 검사
- 역순 기간과 존재하지 않는 날짜의 명시적 오류 검사
- 이력 기록 전 기간을 완료 추이로 추정하지 않는지 검사
- 화면 전체 건수와 CSV 데이터 행 수가 같은지 검사

---

### Task 1: 상태 이력 스키마와 멱등 기록

**Files:**
- Modify: `database/schema.sql`
- Modify: `apps/php-api/src/Schema.php`
- Create: `apps/php-api/src/TaskStatusHistory.php`
- Create: `apps/php-api/tests/task-status-history-schema.php`

**Interfaces:**
- Consumes: 기존 `tasks`, `users`, `guests`, 작업실 멤버십
- Produces: `TaskStatusHistory::record(int $taskId, string $before, string $after, array $actor, string $requestId): void`

- [x] **Step 1:** 중복 요청 ID, 작업실 격리, 변경 시각 보존을 검증하는 실패 테스트 작성
- [x] **Step 2:** `php apps/php-api/tests/task-status-history-schema.php` 실행 후 실패 확인
- [x] **Step 3:** 상태 이력 테이블과 기존 DB 보정 정의 추가
- [x] **Step 4:** 트랜잭션 안에서 멱등 기록하는 `TaskStatusHistory` 구현
- [x] **Step 5:** 같은 테스트를 실행해 통과 확인
- 중간 커밋 생략: 사용자 요청에 따라 최종 33일차 단일 커밋에 통합

---

### Task 2: 모든 상태 변경 경로 연결

**Files:**
- Modify: `apps/realtime/src/handlers/task.js`
- HTTP 상태 수정 경로 없음: 실제 Socket.IO 경로만 연결
- Create: `apps/realtime/scripts/test-task-history.js`

**Interfaces:**
- Consumes: `TaskStatusHistory::record(...)`, Socket.IO `request_id`
- Produces: 상태 변경과 이력 저장의 원자적 결과

- [x] **Step 1:** 실제 Socket.IO 업무 핸들러의 단일 기록·재시도·충돌·롤백·동시 수정·시간대 통합 테스트 작성
- [x] **Step 2:** `node apps/realtime/scripts/test-task-history.js` 실행 후 실패 확인
- [x] **Step 3:** 실제 상태가 바뀐 경우에만 같은 트랜잭션에서 이력 기록
- [x] **Step 4:** 테스트 실행 후 통과 확인
- [x] **Step 5:** 기존 업무 수정 수용 테스트 실행
- 중간 커밋 생략: 사용자 요청에 따라 최종 33일차 단일 커밋에 통합

---

### Task 3: 필터·추이·상세·CSV API 통합

**Files:**
- Modify: `apps/php-api/src/AnalyticsFilters.php`
- Modify: `apps/php-api/src/AnalyticsDashboard.php`
- Modify: `apps/php-api/src/TaskAnalytics.php`
- Modify: `apps/php-api/src/controllers/AnalyticsController.php`
- Modify: `apps/php-api/public/index.php`
- Create: `apps/php-api/src/AnalyticsExport.php`
- Create: `apps/realtime/scripts/test-analytics-history.js`
- Create: `apps/realtime/scripts/test-analytics-csv.js`

**Interfaces:**
- Consumes: 업무 생성일·현재 상태·현재 담당자 공통 필터와 실제 상태 이력
- Produces: 대시보드 JSON의 `status_trend`, 드릴다운 상세 목록, 동일 조건 CSV 응답

- [x] **Step 1:** 필터별 총계·추이·상세 일치와 이력 이전 미추정을 검증하는 실패 테스트 작성
- [x] **Step 2:** 분석 이력 테스트 실행 후 실패 확인
- [x] **Step 3:** 업무 공통 조건과 상태 이력 기반 추이 집계 추가; 가져온 데이터셋은 별도 화면 유지
- [x] **Step 4:** 드릴다운 상세 조회에 같은 필터와 권한 검사 적용
- [x] **Step 5:** UTF-8 BOM CSV 응답과 안전한 파일명 구현
- [x] **Step 6:** 분석 이력·CSV 테스트 실행 후 통과 확인
- [x] **Step 7:** 기존 `test-analytics.js`와 `test-dashboard.js` 회귀 검사
- 중간 커밋 생략: 사용자 요청에 따라 최종 33일차 단일 커밋에 통합

---

### Task 4: 차트 드릴다운과 CSV 화면

**Files:**
- Modify: `apps/frontend/public/index.html`
- Modify: `apps/frontend/public/css/analytics.css`
- Modify: `apps/frontend/public/js/analytics-charts.js`
- Modify: `apps/frontend/public/js/analytics-dashboard.js`
- Modify: `apps/realtime/scripts/test-dashboard-client.js`

**Interfaces:**
- Consumes: 서버의 `filters`, `status_trend`, 상세 목록, CSV URL
- Produces: 차트 선택 → 상세 표 → 원본 보드 이동과 현재 조건 CSV 다운로드 흐름

- [x] **Step 1:** 차트 선택·필터 보존·CSV URL·삭제된 보드 안내의 실패 테스트 작성
- [x] **Step 2:** `node apps/realtime/scripts/test-dashboard-client.js` 실행 후 실패 확인
- [x] **Step 3:** 추이 차트와 상태·담당자 선택 이벤트 구현
- [x] **Step 4:** 상세 표와 원본 보드 이동·접근 오류 안내 구현
- [x] **Step 5:** 현재 서버 적용 필터를 사용하는 CSV 버튼 구현
- [x] **Step 6:** 클라이언트 테스트 실행 후 통과 확인
- [x] **Step 7:** 키보드 포커스와 빈 결과 화면 확인
- 중간 커밋 생략: 사용자 요청에 따라 최종 33일차 단일 커밋에 통합

---

### Task 5: 33일차 통합 검증과 문서화

**Files:**
- Modify: `docs/07-http-api.md`
- Modify: `docs/10-wbs-timeline.md`
- Modify: `docs/11-acceptance-tests.md`
- Create: `docs/33-analytics-completion.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1~4의 검증 결과
- Produces: 실행 가능한 API 계약, 수용 결과, 33일차 완료 기록

- [x] **Step 1:** 스키마·분석·대시보드 관련 전체 자동 테스트 실행
- [x] **Step 2:** 실제 브라우저에서 필터·드릴다운·CSV 흐름 확인
- [x] **Step 3:** 다른 작업실 접근과 세션 만료 시나리오 확인
- [x] **Step 4:** 통계·표·CSV 수치 대조 결과 기록
- [x] **Step 5:** 통과한 항목만 33일차 완료로 문서화
- [x] **Step 6:** 최종 문서와 검증 결과 커밋
