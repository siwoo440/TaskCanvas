# PHP HTTP API 초안

---

## 엔드포인트

| 메서드 | 엔드포인트 | 의미 | 권한 |
|---|---|---|---|
| POST | `/api/guest/join` | 표시 이름+초대 코드 검증 후 세션 발급 | 공개(요청 제한 필요) |
| POST | `/api/projects` | 작업실 직접 만들기 `{display_name, title}`. 게스트·작업실·첫 보드를 만들고 만든 사람을 관리자로 입장시킴. 응답 `{guest, project, board, owner_code, owner_code_days}` — 재입장 코드 원문은 이 응답에서 한 번만 | 공개(요청 제한, `ALLOW_WORKSPACE_CREATE=0` 이면 403) |
| POST | `/api/projects/{id}/rename` | 작업실 이름 변경 `{title}` | 관리자 |
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
