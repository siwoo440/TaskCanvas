---
# 29일차 분석 대시보드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 작업실의 저장 업무를 공통 조건에 따라 KPI·차트·페이지 표로 조회하고 인증 변경 시 안전하게 폐기하는 분석 화면을 제공한다.

**Architecture:** 기존 summary의 필터·SQL 조건·계산식을 재사용한다. 새 dashboard API는 하나의 읽기 스냅샷에서 요약·일별 생성 수·담당자 선택지·20건 업무 표를 반환한다. 전용 프런트엔드 모듈은 조회 상태와 차트 수명을 담당하고 app.js는 작업실·인증 흐름을 연결한다.

**Tech Stack:** PHP 8.2, PDO/MariaDB InnoDB, 기존 HTML/CSS/JavaScript, 고정 버전 로컬 Chart.js UMD, Node.js HTTP·VM 테스트, CUA 브라우저 검증.

**Spec:** [승인된 상세 설계](../specs/2026-10-18-day29-analytics-dashboard-design.md)

---
## Global Constraints

- 기존 `/analytics/summary`의 응답·필터·날짜 생략 의미는 유지한다.
- 서울 기준 최근 30일 기본값, 양끝 포함 1~366일, 날짜 범위 1000~9999년, 고정 page_size=20.
- 정렬은 created_at DESC, task_id DESC. 빈 결과는 page=1·total_pages=1·rows=[].
- 기존 회원·독립 게스트 인증과 viewer 이상 역할을 조회 전 검사한다. no-store 응답 유지.
- tasks 원본 기준 집계, 담당자 ID 구분, 체크리스트 업무별 사전 집계, 모든 표시의 필터 일치.
- 같은 PDO 연결의 명시적 REPEATABLE READ 읽기 전용 스냅샷과 요청당 한 번의 서울 기준일 사용.
- 직접 작성한 코드에 Allman 스타일과 매 줄 짧은 한글 명사형 주석 적용. 외부 라이브러리 원본·라이선스 보존.
- CDN 없는 실행, 360px 배치, 차트 데이터의 접근 가능한 대체 표, 오류·빈 결과·로딩 제공.
- 임시 DB·예약 포트·서버 식별을 사용하고 개발 DB 초기화 금지. 실제 학교 PC 4대 AC15 완료 주장 금지.
- 기존 사용자 지시에 따라 main에서 작업한다. 로컬 단계 커밋은 최종 검증 후 29일차 커밋으로 통합하여 푸시한다. 26~28일차 이력 보존.

---
## Review Focus

1. 서울 자정 경계: 기본 기간과 마감 분류가 같은 기준일 사용. 작업 1·2에서 고정 기준일 검사.
2. 동명 담당자와 탈퇴 후 업무 담당자: ID별 구분과 필터 선택지 유지. 작업 2에서 동일 이름·탈퇴 멤버 데이터 검사.
3. 큰 page와 날짜 하한의 자동 기본값: 정수 오버플로·날짜 범위 이탈 없이 보정 또는 400. 작업 2에서 검사.
4. 필터 입력을 수정하고 조회하지 않은 상태: 새로고침·페이지 이동이 적용된 조건 사용. 작업 4의 VM 테스트로 검사.
5. 닫힌 화면의 응답과 오류·차트 로드 실패: 현재 계정 화면 오염 방지와 숫자 대체 표시. 작업 4·5에서 검사.

---
## 파일별 책임

| 파일 | 생성/수정과 책임 |
| --- | --- |
| apps/php-api/src/AnalyticsFilters.php | 생성: 공통 입력 검증·SQL WHERE 조립 |
| apps/php-api/src/TaskAnalytics.php | 수정: 공통 필터 사용, 정규화 필터·기준일을 받는 집계 분리 |
| apps/php-api/src/AnalyticsDashboard.php | 생성: 기간·페이지·스냅샷·일별·목록·선택지 |
| apps/php-api/src/controllers/AnalyticsController.php | 수정: dashboard 인증·응답 |
| apps/php-api/public/index.php | 수정: dashboard GET 경로 |
| apps/realtime/scripts/test-dashboard.js | 생성: 분리 DB·실제 HTTP 검증 |
| apps/php-api/tests/analytics-snapshot.php | 생성: 두 PDO 연결로 동시 수정·조회 일관성 검증 |
| apps/frontend/public/lib/chartjs/chart.umd.js, LICENSE.md, SOURCE.md | 생성: 고정 배포 파일·라이선스·출처/버전/해시 |
| apps/frontend/public/js/analytics-charts.js | 생성: 차트·대체 표와 파기 |
| apps/frontend/public/js/analytics-dashboard.js | 생성: 조회·필터·페이지·요청 세대·DOM |
| apps/frontend/public/css/analytics.css | 생성: 분석 화면·모바일·포커스·내부 스크롤 |
| apps/frontend/public/index.html, js/app.js | 수정: 분석 뷰·버튼·스크립트와 기존 상태 연결 |
| apps/realtime/scripts/test-dashboard-client.js | 생성: VM에서 모듈·화면 상태 검사 |
| docs/29-analytics-dashboard.md, docs/07-http-api.md, README.md | 생성/수정: 계약·사용·검증 기록과 목차 연결 |

---
## 작업 1 — 공통 필터와 기존 통계 계약 보존

**Consumes:** 기존 TaskAnalytics와 test-analytics.js의 28일차 응답 계약.

**Produces:** `AnalyticsFilters::parse(array $query): array`, `AnalyticsFilters::where(int $projectId, array $filters): array`는 각각 기존 네 필터와 `['sql' => string, 'params' => array]` 반환. `TaskAnalytics::aggregate(int $projectId, array $filters, DateTimeImmutable $today): array`는 기존 summary 응답 전체 반환. 기존 `summary(int $projectId, array $query): array`는 위 인터페이스를 호출하는 공개 진입점 유지.

- [x] 기존 test-analytics.js를 실행해 변경 전 통과 기준 확보: `node apps/realtime/scripts/test-analytics.js`. 기존 40개 검증 통과 확인.
- [x] 별도 PHP 검증 파일에서 고정 서울 기준일로 aggregate를 호출하는 실패 테스트 추가. 같은 기준일의 as_of_date·due 분류와 기존 응답 필드 동일성 검사.
- [x] 테스트 실행으로 aggregate 부재 실패 확인 후 공통 검증·WHERE·기준일 전달 분리. 기존 summary에서 오늘 계산 한 번 수행.
- [x] 기존 40개 검사와 새 기준일 검사 통과 확인, 변경 PHP 파일 `C:\xampp\php\php.exe -l <파일>` 실행.
- [x] 관련 파일만 로컬 커밋: `refactor: 대시보드와 통계의 공통 필터 분리`.

---
## 작업 2 — 일관된 dashboard API

**Consumes:** 작업 1의 parse·where·aggregate, Database::pdo(), 기존 requireGuest·requireRole.

**Produces:** `AnalyticsDashboard::get(int $projectId, array $query): array`, `AnalyticsDashboard::read(int $projectId, array $filters, int $page, DateTimeImmutable $today): array`. get은 입력 정규화와 읽기 전용 트랜잭션을 소유하며 read는 이미 열린 스냅샷에서 조회한다. read는 테스트에서도 실제 PDO 스냅샷을 사용하며 외부 요청·테스트 전용 훅을 추가하지 않는다. 컨트롤러 `dashboard(Request $request): void`와 GET 경로 제공.

- [x] test-dashboard.js에 기존 격리 하네스의 임시 DB·포트 예약·nonce 서버 식별·finally 정리 패턴 적용. 첫 dashboard 요청 404 실패 확인.
- [x] 인증 없는 401, 다른 작업실 403, viewer 200, 회원 쿠키 누락·로그아웃 후 차단을 실제 HTTP로 검사.
- [x] 기본 최근 30일, 시작일만·종료일만, 1일·366일 허용, 367일·역순·존재하지 않는 윤일·1000-01-01에서 종료일만 입력 시 파생 하한 이탈·배열·빈 값·알 수 없는 키·page=0·소수·PHP 범위 초과의 400 검사 추가.
- [x] 동명 담당자·탈퇴 멤버·미배정·other 상태·업무의 여러 보드 참조·다수 체크리스트 fixture 작성. 요약 수·완료율·daily 합계·total 일치, 선택지의 필터 독립성과 타 작업실 정보 미노출 검사.
- [x] 0·20·21건, 동일 시각 task_id 역순, 큰 유효 page의 마지막 페이지 보정 검사. 실패 확인 후 API 구현.
- [x] get에서 page를 네 공통 필터와 분리하여 검증하고 기본 날짜 계산. read에서 aggregate·daily·선택지·rows 조회. count는 summary.tasks.total 재사용하고 LIMIT/OFFSET는 검증 후 정수 바인딩 또는 검증된 정수만 SQL에 삽입.
- [x] 스냅샷 검증 파일에서 임시 DB를 만들고 읽기 PDO 연결 A에 REPEATABLE READ READ ONLY 트랜잭션 시작 및 첫 읽기로 스냅샷 확정. 연결 B의 삽입·수정·삭제 커밋 후 A의 read 결과가 이전 상태로 일치하고 트랜잭션 종료 후 새 상태로 바뀌는지 검사. 예외 시 트랜잭션 정리도 검사.
- [x] `node apps/realtime/scripts/test-dashboard.js`, `C:\xampp\php\php.exe -d zend.assertions=1 -d assert.exception=1 apps/php-api/tests/analytics-snapshot.php`, 기존 test-analytics.js 통과 확인.
- [x] 관련 파일 로컬 커밋: `feat: 일관된 작업실 대시보드 조회 API 추가`.

---
## 작업 3 — 로컬 차트와 접근 가능한 표시

**Consumes:** API summary·daily_created의 상세 설계 필드.

**Produces:** `window.AnalyticsCharts.mount(root)`는 `{ render(data), destroy() }` 반환. data는 dashboard 응답이며 root는 차트와 대체 표 컨테이너. Chart 전역이 없으면 숫자 표를 렌더링하고 차트 사용 불가 안내.

- [x] 공식 Chart.js 배포 경로·라이선스를 확인하고 고정 버전 UMD·LICENSE를 저장. SOURCE.md에 실제 버전·원본 URL·SHA256 기록. 실행 시 외부 요청 없는지 확인.
- [x] test-dashboard-client.js에 Chart 대역·최소 DOM 대역 작성. ID가 다른 동명 담당자의 개별 막대, other 범례, daily의 0값, 재렌더 전 destroy, Chart 부재 시 대체 표 테스트를 먼저 추가하고 실패 확인.
- [x] analytics-charts.js 구현. 상태 도넛·담당자 전체/완료 막대·일별 생성 선을 구성하고 모든 수치를 접근 가능한 표로 제공. 0건은 차트 대신 빈 안내. 이름·업무 제목은 textContent로 처리.
- [x] `node apps/realtime/scripts/test-dashboard-client.js` 통과 확인.
- [x] 차트 모듈·정적 배포물·테스트 로컬 커밋: `feat: 로컬 분석 차트와 대체 데이터 표 추가`.

---
## 작업 4 — 조회 화면과 요청 수명 관리

**Consumes:** `window.api.get(path)`, 작업 3의 AnalyticsCharts, dashboard API.

**Produces:** `window.AnalyticsDashboard.mount(root, { onBack, onAccessLost })`는 `{ open({ projectId, title }), close() }` 반환. onAccessLost는 현재 요청의 401·403 또는 작업실 404 오류에만 호출. mount는 DOM 이벤트를 한 번만 연결하며 close는 세대 증가·데이터 폐기·차트 파기·필터 초기화.

- [x] VM 테스트에 제어 가능한 Promise API 대역으로 응답 역전·이전 오류 무시·닫은 뒤 결과 폐기·로딩 소유권·빈 결과·400과 네트워크 오류 검사 추가 후 실패 확인.
- [x] 필터 초안과 적용 조건을 따로 저장하는 테스트 추가. 초안 수정 뒤 페이지/새로고침은 마지막 적용 조건 사용, 조회 버튼은 새 초안으로 page=1, 첫 조회 실패는 실패한 조건으로 재시도 검사.
- [x] index.html에 view-analytics와 form·상태 영역·KPI 4개·차트 컨테이너·업무 표·페이지 버튼 추가. 모듈과 CSS를 정해진 순서로 로드.
- [x] analytics-dashboard.js 구현. 첫 호출은 날짜 없는 API 요청으로 서버 기본값 사용, 응답 filters로 입력 채우기. 후속 호출은 확정 날짜와 적용 조건 사용. 성공 전에는 현재 요청 조건을 별도로 보관해 재시도 시 복원.
- [x] 새 요청 시작 시 결과 삭제·차트 파기·로딩 표시, 현재 세대만 성공/오류/로딩 종료 처리. 서버가 보정한 page로 표시. 상태·날짜 오류를 입력과 연결하고 적용 조건·성공 조회 시각 출력.
- [x] analytics.css에서 360px 세로 배치·카드·읽기 쉬운 숫자·포커스 표시·표 내부 가로 스크롤·다수 담당자 차트 내부 스크롤 구현.
- [x] VM 검사 통과와 변경 JS의 `node --check <파일>` 확인.
- [x] 화면·모듈·테스트 로컬 커밋: `feat: 공통 필터와 페이지를 갖춘 분석 화면 구현`.

---
## 작업 5 — 기존 작업실·회원 흐름 연결

**Consumes:** 작업 4의 mount/open/close, app.js의 state·showView·openWorkspace·leaveDeletedWorkspace·기존 인증 만료 이벤트.

**Produces:** 작업실 상단 ‘분석 대시보드’ 버튼, 분석 진입·복귀와 기존 작업실 실시간 통지 유지. app.js의 뷰 이탈·계정/게스트 변경 경로에서 close 호출.

- [x] VM 테스트에 작업실 삭제·회원 변경·로그아웃·다른 작업실 선택 후 모듈 폐기 검사 추가. 기존 test-member-client.js 패턴으로 필요한 app 연결을 실행하고 실패 확인.
- [x] app.js에서 한 번 mount하고 진입 시 현재 작업실 ID·이름 전달. 돌아가기는 close 후 openWorkspace로 최신 목록 조회. 분석 중 작업실 연결의 project:deleted·auth:expired 이벤트 유지.
- [x] showView의 분석 이탈과 leaveDeletedWorkspace에 중복 호출해도 안전한 close 연결. 포커스 재검증에서 신원 변경 시 기존 정리 경로가 분석에도 적용되는지 확인.
- [x] CUA에서 실제 API fixture로 KPI·차트·표 수치와 필터·페이지·새로고침·복귀 검증. 같은 계정 재로그인·다른 계정·다중 탭 작업실 전환 후 이전 결과가 남지 않는지 확인.
- [x] CUA에서 360px·키보드 접근·빈 결과·차트 로드 실패·통신 오류를 검증하고 스크린샷 기록. 개발 DB fixture는 고유 식별 데이터만 제거하며 실제 데이터 보존.
- [x] `node apps/realtime/scripts/test-dashboard-client.js`, `node apps/realtime/scripts/test-member-client.js` 통과 확인 후 연결 변경 로컬 커밋: `feat: 작업실과 회원 상태에 분석 화면 연결`.

---
## 작업 6 — 회귀 검증·문서·29일차 통합

**Consumes:** 앞 단계의 동작·검증 기록. 새로운 기능 확대 없이 발견된 범위 내 결함만 수정.

- [ ] 분리 DB에서 dashboard·snapshot·analytics·member-client·member-access·member-auth·session-guard 테스트 실행. PHP/JS 문법과 `git diff --check` 확인. 각 명령의 실제 통과 수와 수동 미검증을 기록.
- [ ] 승인된 설계와 diff를 대조해 권한·스냅샷·응답 역전·표 안전 출력·로컬 차트 배포를 검토. requesting-code-review 스킬에 따라 최종 독립 검토를 수행하고 지적을 수정한 범위만 재검증.
- [ ] docs/29-analytics-dashboard.md에 사용 흐름·필터·API 필드·페이지·최종 검증·제한·차트 버전 기록. docs/07-http-api.md에 경로·필드 추가, README 목차 연결.
- [ ] 작업 전 기준 f6633193b4cc91cd26d1ecce211037e1edd83f80 이후 로컬 커밋만 대상임을 확인하고 Git bundle 백업. 원격 main이 기준에서 변경되었으면 내용을 먼저 확인하고 통합 방식 재판단.
- [ ] 설계·계획·구현을 `29일차 : KPI·차트·업무 표 분석 대시보드 구현` 한 커밋으로 통합. 본문에 API·필터·스냅샷·인증 정리·검증 결과 기재. 기존 26~28일차 tree와 커밋 유지 확인.
- [ ] main 푸시 후 로컬/원격 HEAD 일치·작업 트리 상태 확인. 분석 화면을 열고 완료 기능·실제 테스트 결과·남은 제한·커밋 링크를 보고.

---
## 자체 검토와 실행 방식

설계 1~3절은 작업 4·5, 4~6절은 작업 1·2, 7절은 작업 3·4, 8절은 작업 4·5, 9~10절은 작업 6에 대응한다. Review Focus의 다섯 경계 조건을 각 소유 작업의 검증에 포함했다. 응답 필드와 모듈 인터페이스는 작업 간 같은 이름을 사용한다.

직접 구현을 권장한다. 공통 필터 → 스냅샷 API → 차트·조회 상태 → 기존 인증 연결 순서로 인터페이스 의존성이 이어지므로 한 세션에서 진행하기 적합하다. 계획 승인 뒤 executing-plans를 사용하며, 개별 작업의 체크 항목과 검증 결과를 갱신한다.

---
## 실행 기록

2026-10-19: 작업 1~5 완료. 기존 통계 40개·대시보드 41개·스냅샷·클라이언트·작업실 선택 6개 통과. 독립 검토의 날짜 상한 P1은 실패 재현 후 수정·재검토 통과. 상세 결과와 제한은 docs/29-analytics-dashboard.md에 기록. 기존 사용자 지시에 따라 최종 통합은 main에서 진행.
