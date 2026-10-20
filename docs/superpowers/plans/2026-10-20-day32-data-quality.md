---
# 32일차 데이터 품질 검사·보고서 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 기존 직접 구현 선호를 유지하며 마지막에 독립 검토를 수행한다.

**Goal:** 파일 품질 요약·전체 문제 행 조회·과거 보고서·예상/확정 저장 건수 대조를 구현한다.

**Architecture:** 기존 서버 파서·매핑·중복 계획을 단일 판정 원본으로 유지한다. 품질 집계는 순수 관찰기, 보고서 DB 보관·조회는 별도 서비스, 화면은 전용 모듈로 분리한다. 검증/확정 트랜잭션에 보고서 기록을 결합한다.

**Tech Stack:** 기존 PHP·MariaDB/InnoDB·순수 JavaScript·Node 분리 DB/VM 하네스. 새 패키지·외부 API 없음.

**Spec:** [승인 상세 설계](../specs/2026-10-20-day32-data-quality-design.md)

---
## Global Constraints

- main 기준 c3ea385에서 사용자 선호대로 직접 작업. 기존31일차 이전 이력 보존.
- 오류가 있으면 전체 저장 차단·원자적 저장·세션 및 작업실 권한 규칙 유지. 오류 행 자동 제외 없음.
- 파일5MiB·10,000행·50열·초안15분, DB 단일 패킷1MiB 유지. 원문 셀·키 값·원본 파일·세션 토큰을 품질 보고서에 복제하지 않음.
- 상세 응답은 문제 행20개 단위. 필터는 page·severity(error/warning)·type·column. 전체 문제를 한 응답/JSON에 넣지 않음.
- 필터 집계 단위는 해당 문제를 가진 서로 다른 행. 오류 수/오류 행·파일 중복/기존 중복의 중첩을 구분.
- 자료 자동 수정 없음. 과거 보고서 없음은 명시하고 추정 생성 없음. 33일차 고급 필터·77일차 학교PC4대는 후속 범위.
- 직접 작성 코드 Allman·줄별 짧은 한글 명사형 주석. 문서 제목 바로 위 가로줄. CUA만 브라우저 제어에 사용.

---
## Review Focus

1. 구조 오류로 파서가 null을 만든 셀을 실제 빈 값으로 잘못 세지 않아야 한다. 작업2 표본으로 고정.
2. 같은 정상 키가 파일과 기존 자료에 동시에 중복돼도 합집합 행 수가 부풀지 않아야 한다. 작업2·3에서 독립 기대값 고정.
3. 초안 만료·저장 후 원본 삭제·기존 이력에는 보고서 유무가 정확해야 한다. 작업3·4에서 실제 DB 검증.
4. 검증 후 대상 변경·SQL 실패·응답 유실에서 보고서가 실제 성공을 허위 표시하지 않아야 한다. 작업3에서 두 서버/SQL 오류 주입.
5. 필터·보고서·계정 전환의 응답 역전은 현재 화면을 바꾸지 않아야 한다. 작업5 VM 지연 응답과 실제 앱 이탈 검증.

---
## 파일 구조와 공통 계약

| 파일 | 책임 |
| --- | --- |
| database/schema.sql, apps/php-api/src/Schema.php, bin/reset-demo.php | 품질 표2개·동일 보정·초기화 순서 |
| apps/php-api/src/ImportQualityScan.php | 원본/정규화 판정 관찰·집계·행별 압축 항목 |
| apps/php-api/src/ImportQuality.php | 검증 이력 생성·보고서 저장/조회·확정 대조 |
| apps/php-api/src/ImportValues.php, ImportService.php | 세분 오류 코드·관찰기 호출·트랜잭션 결합 |
| apps/php-api/src/controllers/ImportController.php, public/index.php | 인증 우선 품질 조회2경로 |
| apps/frontend/public/js/import-quality.js | 요약·컬럼 표·상세 필터/페이지·예상/실제 출력 |
| apps/frontend/public/js/data-import.js, dataset-view.js, index.html, css/data-management.css | 검사 직후/이력 진입·보고서 수명·모바일 |
| apps/php-api/tests/import-quality-schema.php, import-quality-scan.php | 분리 DB 스키마·순수 품질 표본 |
| apps/realtime/scripts/test-import-quality.js, test-import-quality-client.js | 실제 API·저장 원자성·화면 수명 |

`type` 허용값은 required_missing·invalid_number·invalid_date·invalid_cell·invalid_row·optional_missing·duplicate_file·duplicate_existing. `column`은 포함한 source_id(s0...) 또는 구조 전용 `__row__`다. code는 기존 오류 객체 위치·message 계약을 유지하며 REQUIRED_MISSING·INVALID_NUMBER·INVALID_DATE·INVALID_CELL·INVALID_ROW를 사용한다.

보고서 summary는 received·valid_rows·error_rows·error_count·warning_rows·warning_count·duplicate_rows·file_duplicate_rows·existing_duplicate_rows와 columns 목록이다. columns 항목은 source_id·id·label·type·required·missing_count·missing_rate·error_count·invalid_count다. rate는 소수 첫째 자리, 빈 분모0이다.

저장 expected는 inserted·updated·skipped·before_rows, actual은 성공 때만 inserted·updated·skipped·after_rows·version·committed_at이며 성공 전 null이다. comparison은 성공 때만 counts_match·row_count_match, 그 외 null이다. run_id·file_name·checked_at·schema·key_column·duplicate_policy·target_dataset_id·target_version·status·format_version을 함께 반환한다.

상세 응답은 rows[{source_row,issues[{severity,type,source_id,field,message}]}]·pagination{page,page_size=20,total,total_pages}다. 필터가 있으면 그 조건에 맞는 issues만 남긴다. 행 순서는 source_row 오름차순, 행 내부는 오류→경고/원본 컬럼 순으로 고정한다.

---
## Task 1: 품질 보고서 DB 기반

**Files:** schema.sql·Schema.php·reset-demo.php·import-quality-schema.php, 기존 import-schema.php 검사 목록.

**Interfaces:** import_quality_reports(run_id PK/FK→import_runs CASCADE,format_version=1,metadata_json,summary_json,expected_json,actual_json NULL,created_at), import_quality_rows(run_id,source_row 복합PK,issues_json,run FK→quality_reports CASCADE). JSON_VALID 제약, InnoDB·utf8mb4_bin JSON. 이력 삭제를 통해 작업실/데이터셋 FK 수명 재사용.

- [ ] 분리 DB 신규/기존 보정의 품질 표 정의 동일성·기존 전체 행 해시·반복 실행·부모 run 삭제 FK·초안 삭제 보고서 유지·초기화 dry-run/실제 실행 테스트 작성.
- [ ] Run: `C:\xampp\php\php.exe apps/php-api/tests/import-quality-schema.php`. Expected: 품질 표 없음으로 FAIL.
- [ ] 두 설치 경로에 같은 표 정의 추가. 품질 행→보고서→기존 import 표 순서로 초기화 목록 보완. 기존 다섯 표/회원 표의 보존 검사는 약화하지 않음.
- [ ] Run: 위 명령과 `import-schema.php`. Expected: 신규·보정·FK·반복·전체 행 보존 PASS.
- [ ] Commit: `feat: 데이터 품질 보고서와 문제 행 보관 기반 추가`.

---
## Task 2: 정확한 품질 관찰기

**Files:** ImportQualityScan.php·ImportValues.php·import-quality-scan.php·기존 import-parser.php.

**Interfaces:** `new ImportQualityScan(array $config)`, `observe(array $raw,array $normalized,bool $fileDuplicate,bool $existingDuplicate): array`는 그 행의 압축 문제 목록을 반환, `summary(): array`는 공통 계약 집계 반환. 원본값/키값을 내부 저장하지 않음. 행 오류는 ImportValues::row 결과를 사용하며 중복 여부는 기존 계획 엔진이 전달한다.

- [ ] 독립 표본: required 문자 키·optional 숫자·required 날짜. raw1=A/빈값/정상날짜→경고1·missing1, raw2=B/틀린숫자/잘못된날짜→오류2·오류행1, raw3=빈키/2/정상날짜→오류1, raw4=A/3/정상날짜와 fileDuplicate+existingDuplicate→중복행1·중복경고2. Expected received4/valid2/error_rows2/error_count3/warning_rows2/warning_count3/duplicate_rows1/file1/existing1, 숫자 missing_rate25.0·invalid_count1.
- [ ] 추가 표본: 구조 오류로 null이 된 배열 셀은 invalid_row로 분류하고 결측으로 이중 집계하지 않음. 공백만 있는 원본은 결측, 문자 앞뒤 공백/대소문자는 유지, excluded 컬럼 값 통계 없음, 빈 입력 비율0, 키 없는 자료의 중복0.
- [ ] Run: `C:\xampp\php\php.exe apps/php-api/tests/import-quality-scan.php`. Expected: 관찰기 없음 FAIL.
- [ ] 관찰기와 오류 코드 세분 구현. JSON boolean·숫자 정밀도·날짜 판단은 기존 row 로직을 유지하고 문자열 메시지를 다시 파싱해 오류 종류를 추정하지 않음.
- [ ] Run: 위 명령과 `import-parser.php`. Expected: 고정 집계·원문 비보관·기존49개 파서 검사 PASS.
- [ ] Commit: `feat: 결측·형식 오류·중복의 정확한 품질 집계 구현`.

---
## Task 3: 검증·확정 저장에 보고서 결합

**Files:** ImportQuality.php·ImportService.php·test-import-quality.js, 기존 import-harness.cjs 재사용.

**Interfaces:** `ImportQuality::begin(int $projectId,int $actorId,array $draft,array $config,int $revision): int`는 현재 트랜잭션에 검증 run·보고서 헤더를 만들고 run_id 반환. `append(int $runId,int $sourceRow,array $issues): void`, `finish(int $runId,array $summary,array $report): void`, `confirm(int $runId,array $result,int $beforeRows): void`. begin의 중간 상태는 트랜잭션 밖에 공개하지 않음.

- [ ] 실제 validate 응답에 run_id·quality 요약이 없음을 검사해 RED. 보고서 수치는 작업2 기대값과 독립 비교하고 저장 차단은 기존422로 확인.
- [ ] 검증 config/원본/대상 version 검사 후 begin 호출. 기존 plan의 정상/오류 모든 행에 관찰기 호출, 중복 판정은 기존 seen/existing 결과 전달. 작업2 observe가 반환한 문제 행만 append로 즉시 저장, finish에서 요약·예상치·검증 상태 확정. 기존 중복/오류 집계를 품질 집계와 교차 확인.
- [ ] 검증과 보고서 저장을 같은 ImportAccess 트랜잭션에서 처리. 품질 INSERT 실패 SQL 주입 시 검증 이력·초안 revision·보고서 전체 롤백, 성공 응답 금지 검사.
- [ ] commit은 기존 저장 판단을 재사용하고 보고서를 새로 생성하지 않음. 데이터셋/이력 성공과 confirm을 같은 트랜잭션에 결합. confirm 실패 주입 시 실제 행·version·초안 소비·actual 전체 롤백. 기존 failed 이력은 실패를 나타내되 actual은 null.
- [ ] skip/update 표본에서 예상=실제, received=inserted+updated+skipped, after_rows=before_rows+inserted 비교. 실제 DB행수와 대조. 동일 초안 두 PHP 서버 commit/재시도에서 보고서1개·같은 actual, 다른 초안 대상 version 충돌409에서는 actual null 검사.
- [ ] 오류120개·최대10,000행/50열(빈 필수 필드)을 검증하고 모든 문제 행이 저장되되 각 INSERT가1MiB 미만임을 실제 DB에서 확인. 전체 원문·키·쿠키/세션 식별자가 품질 표 JSON에 없음을 sentinel로 검사.
- [ ] Run: `node apps/realtime/scripts/test-import-quality.js --write`, `test-datasets.js`, `test-import.js`. Expected: 보고서/저장 원자성·중복 정책·기존 저장91/업로드35 PASS.
- [ ] Commit: `feat: 검증 보고서와 확정 저장 건수의 원자적 대조 추가`.

---
## Task 4: 보고서 조회·필터·페이지 API

**Files:** ImportQuality.php·ImportController.php·public/index.php·test-import-quality.js.

**Interfaces:** `ImportQuality::detail(int $projectId,int $runId): array`, `rows(int $projectId,int $runId,array $query): array`. `GET /api/projects/{id}/imports/runs/{runId}/quality`·`/quality/rows`, 기존 authorize viewer 사용. 보고서 없는 기존 run은 QUALITY_REPORT_NOT_FOUND 404, 다른 작업실 run도404.

- [ ] 경로404 RED 확인. severity/type/column/page 조합별 고정 행 기대값, 오류120행의20행×6페이지·마지막 페이지·빈 결과1/1 검사. 같은 행의 오류+경고는 필터별 항목만 제공, 여러 문제라도 행 하나로 페이지 집계.
- [ ] page0/음수/소수/array/overflow, 불명 severity/type/column·unknown query400. 비인증401·타 작업실403/404·viewer조회200/editor·admin조회200, 쿠키 없는 연결 회원401·no-store 확인.
- [ ] 조회는 project_id+run_id 범위로 부모를 확인한 뒤 작은 문제 행 JSON을 순서대로 읽고 필터에 맞는 행만20개 응답. 거대한 전체 issues 배열을 메모리에 누적하지 않음. SQL식별자/경로에 필터 문자열 직접 삽입 금지. 보고서는 불변 스냅샷이며 성공 actual/status는 일관된 읽기 스냅샷으로 조회.
- [ ] 초안 만료/삭제·성공 후 조각0개여도 보고서 조회 가능, 기존 보고서 없는 run은 명확한404, 데이터셋·작업실 삭제 후 부모/보고서/문제 행 FK 정리 검사. 미래 schema/현재 version을 과거 메타데이터에 덮어쓰지 않음.
- [ ] Run: `node apps/realtime/scripts/test-import-quality.js`. Expected: 전체 권한·필터·페이지·원자성·수명 검사 PASS.
- [ ] Commit: `feat: 품질 보고서 상세·문제 행 필터 조회 API 추가`.

---
## Task 5: 품질 보고서 화면·수명 연결

**Files:** import-quality.js·data-import.js·dataset-view.js·index.html·data-management.css·test-import-quality-client.js·기존 import-client/flow 검사.

**Interfaces:** `window.ImportQualityView.mount(root,{onAccessLost})`→`open({projectId,runId})/close()`. 요약·컬럼 집계 렌더 공통 `window.ImportQualityView.summary(root,quality)` 사용. DataImport mount 콜백에 선택 `onQuality({runId})` 추가, DatasetView가 품질 뷰를 소유. 기존 onSaved·onBack·onAccessLost 유지.

- [ ] VM에서 모듈 없음 RED. validate의 summary와 상세 열기, 이력 run별 열기, reportId전환/필터/페이지 응답 역전, 옛401 무시·현재401 정리, 오류/경고/빈 상태·404 과거 보고서 안내·네트워크 재시도 검사 작성.
- [ ] 품질 요약과 컬럼 결측/형식오류 표 구현. 문제 목록20행·조건에 맞는 항목·전체/페이지 건수 표시. expected와 actual을 별도 열로 표시하고 actual null이면 ‘미확정’, 성공 후 match값은 서버 응답만 사용.
- [ ] DataImport 조건 변경 시 현재 보고서 수명/검증 자격 폐기. 업로드/원본 해석과 무관한 이름 변경 응답 수명은31일차 수정 유지. 저장 성공 뒤 상세 품질 재조회, 이력 버튼으로 과거 보고서를 열 때 당시 조건임을 표시.
- [ ] DatasetView close/작업실전환/인증상실에서 품질 뷰 close 연결. 필터를 바꾼 뒤 늦은 결과가 새 선택을 복원하지 않게 요청 세대 분리. 표·라벨·메시지는 textContent, 셀 원문 추가 조회 없음.
- [ ] Run: `node apps/realtime/scripts/test-import-quality-client.js`, `test-import-client.js`, `test-import-flow.js`, `test-dashboard-client.js`, `test-member-client.js`. Expected: 품질 UI·수명·기존 업로드/저장/분석/회원 화면 PASS.
- [ ] Commit: `feat: 데이터 품질 요약·문제 탐색·저장 대조 화면 추가`.

---
## Task 6: 실제 브라우저·회귀·문서·32일차 통합

**Files:** docs/32-data-quality.md·07-http-api.md·README.md·docs/README.md·30-roadmap-reordered.md·10-wbs-timeline.md. 검증 자료/전체 DB 백업은 ignored tmp/day32 아래.

- [ ] 개발 DB 전체 백업·기존 모든 표 행 해시 대조 뒤 보정. 기존 자료 변경0 확인. 고유 회원/작업실/파일 fixture만 생성.
- [ ] CUA에서 결측·잘못된 숫자/날짜·파일/기존 중복 표본 검사→품질 요약→유형/컬럼 필터→100건 초과 페이지→수정 파일 재검사→저장→브라우저 새로고침→이력 보고서 예상/실제 일치 확인. 360px 내부 표 스크롤·키보드·현재 화면 기록 저장. 소유 ID/건수 재확인 후 fixture만 정리.
- [ ] Run: PHP 품질schema/scan·import-schema/parser·회원schema·필터/snapshot/env, Node quality API/VM·datasets91·imports35·analytics40·dashboard41·member-auth41·member-access59·client/flow/preview/dashboard/member·sessionguard/portsafety·selection/footer. 기존 `node tmp/day27/run-acceptance.cjs` 분리 DB 래퍼 사용. Expected: 자동 회귀 전부 PASS, 수동2건은 실행 여부를 그대로 명시. 개발 DB 초기화 금지.
- [ ] 변경 PHP `php -l`·JS `node --check`·`git diff --check`. Expected: 구문/공백 오류0. 테스트 수치는 실제 출력으로 문서화.
- [ ] requesting-code-review의 읽기 전용 최종 독립 검토. Important/Critical은 재현 테스트 RED→GREEN과 전체 green으로 처리. 원문 비노출·수치 정의·원자성·과거 보고서·UI응답경합을 Review Focus로 전달.
- [ ] 문서에 사용법·필터/API 계약·원본 미보관·과거 보고서 없음·오류 차단·성공 후 건수 비교·현장 미검증 기록. 로드맵32완료/33이후계획 반영.
- [ ] 로컬 단계 커밋/복구 bundle 보존. 원격 main 변경 여부 확인 후 이번32일차만 `32일차 : 데이터 품질 검사·오류 보고서 및 저장 결과 대조 구현`으로 통합. 통합 전후 tree 동일·부모31일차 확인, main 푸시·원격SHA·clean 확인.
- [ ] 사용자 페이지 링크·검증 화면·완료 범위·남은 현장 검증 보고.

---
## 자체 검토와 실행 방식

설계1~3절은 작업2·3·5,4절은 작업1·3·4,5절은 작업4,6절은 작업3·5,7절은 작업6으로 대응한다. 관찰기→저장→조회→화면 계약의 이름·필터·row 단위를 통일했다. Review Focus5개 모두 해당 작업에 검증을 추가했다.

직접 구현을 유지한다. 같은 검증 run_id·revision·보고서 스냅샷이 단계 전체를 연결하므로 한 구현자가 순서대로 진행하고 마지막에 독립 검토하는 방식이 적합하다. 이 계획 검토·확인 후 실행한다.
