# PHP HTTP API 초안

---

## 엔드포인트

| 메서드 | 엔드포인트 | 의미 | 권한 |
|---|---|---|---|
| POST | `/api/auth/register` | 회원가입 `{login_id, display_name, password, password_confirm}` → 201 `{user}` | 공개, 보호 헤더·IP별 요청 제한 |
| POST | `/api/auth/login` | 회원 로그인 `{login_id, password}` → `{user}`와 회원 쿠키 | 공개, 보호 헤더·IP별 요청 제한 |
| GET | `/api/auth/me` | 회원 로그인 상태 `{user}`. 세션 없음·만료·폐기는 401 | 회원 세션 |
| POST | `/api/auth/logout` | 현재 회원 세션 폐기·쿠키 삭제 → `{logged_out:true}` | 보호 헤더, 반복 호출 허용 |
| GET | `/api/auth/workspaces` | 본인 작업실과 현재 게스트 연결 가능 여부 | 회원 |
| POST | `/api/auth/guest-link` | `{password}` 재확인 후 현재 게스트 연결 → `{guest}` | 회원+현재 게스트, 보호 헤더·시도 제한 |
| POST | `/api/auth/workspaces/select` | `{project_id}` 본인 작업실 활성화 → `{guest, project_id, role}` | 회원, 보호 헤더 |
| POST | `/api/auth/workspaces/join` | `{invite_code}` 회원 초대 참여 → 201 `{guest, project_id, role}` | 회원, 보호 헤더·시도 제한 |
| POST | `/api/guest/join` | 표시 이름+초대 코드 검증 후 세션 발급 | 공개(요청 제한 필요) |
| POST | `/api/projects` | 작업실 직접 만들기 `{display_name, title}`. 게스트·작업실·첫 보드를 만들고 만든 사람을 관리자로 입장시킴. 응답 `{guest, project, board, owner_code, owner_code_days}` — 재입장 코드 원문은 이 응답에서 한 번만 | 공개(요청 제한, `ALLOW_WORKSPACE_CREATE=0` 이면 403) |
| POST | `/api/projects/{id}/rename` | 작업실 이름 변경 `{title}` | 관리자 |
| POST | `/api/projects/{id}/delete` | 작업실 삭제 `{confirm_title}`. 작업실 이름을 그대로 보내야 함. 보드·객체·업무·초대 코드·참여 기록과 그 작업실이 올린 이미지 파일을 지움. 응답 `{deleted, project_id, removed_files}`. 되돌릴 수 없음 | 관리자(`ALLOW_WORKSPACE_DELETE=0` 이면 403) |
| POST | `/api/guest/leave` | 게스트 세션 종료 | 참여자 |
| GET | `/api/me` | 현재 세션의 게스트와 참여 프로젝트·역할 | 참여자 |
| POST | `/api/realtime-ticket` | Socket.IO 단기 접속 티켓 발급. `{board_id}` 는 보드 참여용, `{project_id}` 는 작업실 연결용. 둘 중 하나만 보냄(둘 다 있거나 없으면 400) | 참여자 |
| GET | `/api/projects/{id}/boards` | 프로젝트 보드 목록 | 참여자 |
| POST | `/api/projects/{id}/boards` | 보드 생성 | 관리자·편집자 |
| GET | `/api/boards/{id}/snapshot` | 저장 완료 객체 전체 조회 | 참여자 |
| POST | `/api/boards/{id}/rename` | 보드 이름 변경 `{title}` | 관리자·편집자 |
| POST | `/api/boards/{id}/delete` | 보드 삭제(객체·연결선 포함, 되돌릴 수 없음) | 관리자 |
| POST | `/api/images` | PNG/JPG/WEBP(최대 10MB) 이미지 업로드 | 관리자·편집자 |
| GET | `/api/images/{id}` | 프로젝트 권한 검증 후 이미지 반환 | 참여자 |
| GET | `/api/projects/{id}/analytics/summary` | 업무 상태·담당자·마감·체크리스트 SQL 집계. created_from·created_to·status·assignee_id 필터 | 참여자(viewer 이상), [28일차 계약](28-task-analytics.md) |
| GET | `/api/projects/{id}/tasks` (P1) | 공유 업무 목록(담당자 이름·버전 포함). 업무마다 `checklist` 에 세부 항목 `[{item_id, title, done}]` | 참여자 |
| GET | `/api/projects/{id}/members` | 프로젝트 참여자 목록(담당자 선택용) | 참여자 |
| GET | `/api/projects/{id}/invites` | 초대 코드 목록(역할·만료·인원 제한과 입장 인원·상태, 코드 원문 없음) | 관리자 |
| POST | `/api/projects/{id}/invites` | 초대 코드 발급 `{role, days, max_uses}` — `max_uses`(0~100)를 빼거나 null 로 주면 인원 제한 없음, 0 이면 재입장 전용 코드. 원문은 응답에서 한 번만 | 관리자 |
| POST | `/api/invites/{id}/revoke` | 초대 코드 취소(이미 입장한 참여자는 유지) | 관리자 |
| GET | `/api/health` | 서버·DB 상태 확인(개발용) | 공개 |

**구현 상태(1·5·7·9·11·17·18단계):** 위 엔드포인트는 모두 `apps/php-api` 에 구현되어 있습니다. 보드 이름 변경·삭제는 HTTP 로 처리하고, 그 보드를 열고 있는 참여자에게는 실시간 서버가 DB 를 주기적으로 확인해 `board:renamed`/`board:deleted` 로 알립니다. 삭제해도 업로드한 이미지 파일과 공유 업무 원본은 남습니다. 초대 코드는 `days` 1~30(기본 7), 상태는 `active`·`expired`·`revoked`·`exhausted` 이며, 최초 관리자는 화면에서 작업실을 직접 만든 사람이거나 `bin/create-project.php` 가 출력하는 관리자 코드로 입장한 사람입니다. 직접 만든 사람의 재입장 코드는 90일 유효한 재입장 전용 코드입니다. 업무 생성·수정은 모든 보드에 전파해야 하므로 HTTP 가 아니라 실시간 서버의 `task:create`/`task:update` 로 처리합니다. 작업실의 업무 현황판도 작업실용 티켓으로 실시간 서버에 연결해(`project:join`) 같은 이벤트를 씁니다. 모든 `POST` 는 `X-TaskCanvas: 1` 헤더를 요구하며, `/api/images` 는 `multipart/form-data`(`project_id`, `file`), 나머지는 `Content-Type: application/json` 입니다. 이미지 업로드 응답은 `{asset:{asset_id, url:'/api/images/{id}', mime_type, size_bytes, width, height}}` 이고, 조회는 참여자 세션 쿠키가 있어야 하며 `Cache-Control: private` 로 반환됩니다.

---

## 요청·응답 예시

게스트 입장 요청:

```json
{
  "display_name": "시연참여자A",
  "invite_code": "사용자가직접입력한초대코드"
}
```

성공 응답 예시:

```json
{
  "guest": {
    "guest_id": 7,
    "display_name": "시연참여자A"
  },
  "project_id": 1,
  "role": "editor"
}
```

실제 세션 토큰은 JSON에 반복 노출하지 않고 가능한 **HttpOnly 쿠키**에 저장합니다. 위 ID는 구조 설명용 예시이며 실사용 계정이 아닙니다.

오류 응답:

```json
{
  "error": {
    "code": "INVALID_INVITE",
    "message": "초대 코드가 올바르지 않거나 만료되었습니다."
  }
}
```

---

## 오류 코드 계약

| 코드 | 의미 |
|---|---|
| `INVALID_INVITE` | 초대 코드 오류·만료 |
| `INVITE_EXHAUSTED` | 인원 제한이 있는 초대 코드의 인원이 모두 참(401). 이미 입장한 이름으로는 다시 들어올 수 있음 |
| `REENTRY_ONLY` | 재입장 전용 코드에 아직 참여하지 않은 이름을 씀(401) |
| `NAME_IN_USE` | 코드의 역할보다 높은 권한의 참여자가 쓰는 이름으로 입장 시도(403) |
| `CREATE_DISABLED` | 서버 설정으로 작업실 직접 만들기를 꺼 둠(403) |
| `DELETE_DISABLED` | 서버 설정으로 작업실 삭제를 꺼 둠(403) |
| `CONFIRM_MISMATCH` | 작업실 삭제 요청의 `confirm_title` 이 작업실 이름과 다름(400) |
| `FORBIDDEN` | 프로젝트/보드 접근 권한 없음 |
| `OBJECT_LOCKED` | 타 사용자 잠금 존재 |
| `VERSION_CONFLICT` | 객체 버전 충돌 |
| `INVALID_FILE` | 허용 형식 아님 |
| `FILE_TOO_LARGE` | 파일당 10MB 초과 |
| `SAVE_FAILED` | 영구 저장 실패 |
| `RECONNECT_REQUIRED` | 스냅샷 재로드 필요 |
| `UNAUTHORIZED` | 세션 없음·만료 (HTTP 401) |
| `RATE_LIMITED` | 입장 시도 횟수 초과 (HTTP 429) |
| `BAD_REQUEST` | 본문 형식·필수값 오류 (HTTP 400) |
| `NOT_FOUND` / `METHOD_NOT_ALLOWED` | 경로·메서드 오류 |

---

## HTTP 보안 요건

- 게스트 입장과 초대 코드 검증에 요청 제한 적용.
- 상태 변경 API에 CSRF 방어, 세션 `SameSite`, `HttpOnly`, 적절한 `Secure` 사용.
- DB 쿼리는 PHP PDO 바인딩(Prepared Statements).
- 사용자 입력 출력은 HTML 이스케이프, 외부 URL은 http/https 및 도메인 검증.

---

## 27일차 인증 보완

회원에 연결된 게스트는 동일한 활성 회원 세션에 종속된 게스트 쿠키가 필요합니다. 연결된 이름의 비회원 재입장은 거부합니다. `/api/me`의 회원용 세션은 `member: true`와 연결 게스트들의 작업실 목록을 반환하며, 작업실 전환은 select API로 활성 게스트를 바꿉니다. 티켓은 발급 세션에 결합합니다. [27일차 상세](27-member-access.md).

---
## 29일차 분석 조회

`GET /api/projects/{id}/analytics/dashboard` — 기존 세션과 열람자 이상 권한 필요. 생성일·상태·담당자 필터, 기본 최근 30일·최대 366일, page 기본 1·20건 고정이다. summary·daily_created·status_trend·assignee_options·pagination·rows를 같은 DB 스냅샷에서 반환한다. status_trend는 기록된 상태 변경만 날짜·도착 상태별로 집계하며 과거 상태를 추정하지 않는다. rows의 board_id는 연결된 원본 보드 중 가장 작은 ID이며 없으면 null이다. 잘못된 조건은 INVALID_FILTER 400, 응답은 no-store다. 기존 `/analytics/summary` 계약은 유지한다. [입력·응답 필드와 검증](29-analytics-dashboard.md).

`GET /api/projects/{id}/analytics/export` — 대시보드와 같은 생성일·상태·담당자 필터를 적용해 전체 업무를 UTF-8 BOM CSV로 반환한다. 열람자 이상 권한과 no-store를 적용하며 page는 받지 않는다. 같은 데이터 시점에서 화면의 pagination.total과 CSV 데이터 행 수가 일치한다. 요청 사이에 업무가 바뀌면 값이 달라질 수 있다. 500행 분할 조회·일관된 스냅샷·수식 방어를 적용한다. [33일차 상세](33-analytics-completion.md).

---
## 30일차 파일 업로드·미리보기

`POST /api/projects/{id}/imports/upload`는 multipart `file`·`encoding`, `/imports/preview`는 JSON `draft_token`·선택 `encoding/json_path`를 받는다. 편집자 이상과 변경 보호 헤더가 필요하다. 초안은 세션·작업실에 결합한15분 임시 보관이며 최초 응답만 토큰을 제공한다. 원본 메타데이터·전체 행 수·최대20행을 반환한다. [응답 필드·오류·제한](30-file-preview.md#4-api-계약).

---
## 31일차 — 데이터셋 확정 저장·재조회

`POST /imports/validate`·`/imports/commit`, `GET /datasets`·`/datasets/{datasetId}`·`/rows`·`/chart`·`/runs`, `GET /imports/runs`, `POST /datasets/{datasetId}/delete`를 추가했다. 모든 경로는 `/api/projects/{id}` 기준이다. 편집자 이상은 검증·저장·재가져오기, 열람자 이상은 조회, 관리자만 삭제 가능하다.

검증은 서버 원본 전체와 컬럼 설정을 검사하고 validation_revision을 반환한다. 저장은 draft_token·validation_revision만 받으며 오류 행이 있으면422, revision/version 충돌은409다. 같은 초안의 재시도는 동일한 확정 결과를 반환한다. [컬럼 계약·입력 필드·오류·권한 상세](31-dataset-storage.md#4-api).

---
## 34일차 회원 작업 흐름 API

회원 쿠키를 사용하는 `GET /api/auth/home`, `GET /api/auth/search?q=검색어`, `POST /api/auth/boards/{id}/favorite`·`/visit`, `GET/POST /api/projects/{id}/analytics/views`, `POST /analytics/views/{viewId}/delete`를 추가했다. 즐겨찾기는 명시적 active 불리언, 저장 뷰 수정·삭제는 version을 요구한다. 다른 회원의 설정은 404다.

`GET /api/projects/{id}/members/manage`, `POST /members/role`·`/members/remove`는 회원 관리자만 사용한다. target_guest_id 기준 같은 회원의 연결 별칭 전체를 변경한다. 내보내기는 confirm_name을 요구하고 마지막 관리자 변경은409다. 변경 요청은 모두 보호 헤더와 최신 세션 검사를 적용한다. [상세 계약·한도](34-member-workflow.md).

---
## 32일차 품질 보고서

검증 응답에 run_id·quality를 추가했다. GET /api/projects/{id}/imports/runs/{runId}/quality 및 /quality/rows는 열람자 이상이 조회한다. 상세 행은20개 단위이며 page·severity·type·column 교집합을 적용한다. 실제 확정값은 성공 전 null, 보고서 없는 구형 이력은404다. [입력·수치·권한·보관 상세](32-data-quality.md#4-api와-권한).
