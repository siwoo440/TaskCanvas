# PHP HTTP API 초안

---

## 엔드포인트

| 메서드 | 엔드포인트 | 의미 | 권한 |
|---|---|---|---|
| POST | `/api/guest/join` | 표시 이름+초대 코드 검증 후 세션 발급 | 공개(요청 제한 필요) |
| POST | `/api/guest/leave` | 게스트 세션 종료 | 참여자 |
| GET | `/api/me` | 현재 세션의 게스트와 참여 프로젝트·역할 | 참여자 |
| POST | `/api/realtime-ticket` | Socket.IO 단기 접속 티켓 발급 | 보드 참여자 |
| GET | `/api/projects/{id}/boards` | 프로젝트 보드 목록 | 참여자 |
| POST | `/api/projects/{id}/boards` | 보드 생성 | 관리자·편집자 |
| GET | `/api/boards/{id}/snapshot` | 저장 완료 객체 전체 조회 | 참여자 |
| POST | `/api/images` | PNG/JPG/WEBP(최대 10MB) 이미지 업로드 | 관리자·편집자 |
| GET | `/api/images/{id}` | 프로젝트 권한 검증 후 이미지 반환 | 참여자 |
| GET | `/api/projects/{id}/tasks` (P1) | 공유 업무 목록 | 참여자 |
| GET | `/api/health` | 서버·DB 상태 확인(개발용) | 공개 |

**구현 상태(1·5단계):** `tasks` 를 제외한 위 엔드포인트는 `apps/php-api` 에 구현되어 있습니다. 모든 `POST` 는 `X-TaskCanvas: 1` 헤더를 요구하며, `/api/images` 는 `multipart/form-data`(`project_id`, `file`), 나머지는 `Content-Type: application/json` 입니다. 이미지 업로드 응답은 `{asset:{asset_id, url:'/api/images/{id}', mime_type, size_bytes, width, height}}` 이고, 조회는 참여자 세션 쿠키가 있어야 하며 `Cache-Control: private` 로 반환됩니다.

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
