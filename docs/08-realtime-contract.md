# Socket.IO 실시간 이벤트 규격

---

## 이벤트 목록

| 이벤트 | 클라이언트 데이터 | 서버 처리 | DB |
|---|---|---|---|
| `board:join` | board_id, short_lived_ticket | 방 참여·권한 검사 | 조회만 |
| `cursor:move` | board_id, x, y | 커서 위치 중계, 전송 빈도 제한 | X |
| `stroke:preview` | stroke_id, points_delta | 마우스 움직이는 동안 중계 | X |
| `stroke:commit` | stroke_id, points, style, request_id | 완성 획 확정·저장 | O |
| `object:lock` | object_id | 객체별 임시 잠금 획득 | X |
| `object:preview` | object_id, x, y | 잠금 소유자만 이동 중 중계 | X |
| `object:commit` | object_id, lock_token, version, changes, request_id | 변경 승인·저장·다른 참여자 중계 | O |
| `object:delete` | object_id, lock_token, version | 삭제 승인 | O |
| `object:unlock` | object_id, lock_token | 잠금 해제 | X |
| `task:update` (P1) | task_id, version, changes | 동일 원본 업무의 모든 참조 보드 갱신 | O |

---

## 객체 확정 예시(JSON)

```json
{
  "request_id": "req-illustration-01",
  "board_id": 1,
  "object_id": 2001,
  "version": 4,
  "lock_token": "서버가발급한임시잠금표식",
  "changes": {
    "x": 420,
    "y": 180
  }
}
```

서버 응답은 `request_id`, `object_id`, `new_version`, `persisted=true`를 포함하도록 제안합니다. 잠금 토큰은 서버에서 발급하고 본인 잠금 객체에만 사용해야 합니다.

---

## 선점 잠금 명세

1. 편집자는 객체 편집 시작 전 `object:lock` 요청.
2. 서버는 멤버십·역할·보드·잠금 부재를 검증하고 단일 소유자에게 임시 토큰 발급.
3. 같은 객체에 대한 타 사용자 잠금/수정 요청은 `OBJECT_LOCKED` 거절.
4. 서버는 연결 종료·정상 완료·TTL 만료 시 잠금을 해제.
5. 다중 선택(P1)은 선택된 **모든** 객체 잠금 획득 실패 시 이동 전체 취소.
6. `version`이 불일치하면 덮어쓰지 않고 `VERSION_CONFLICT` 응답 후 새 스냅샷 요청.

---

## 펜 동기화 전략

- 선 이동 좌표를 적절한 주기로 묶어 전달(예: 20~30Hz 목표를 테스트 후 결정).
- 4명의 현재 커서 상태는 DB에 저장하지 않음.
- `stroke:commit` 성공 전에는 저장 표시를 하지 않음.
- 네트워크 단절 중 미완성 획은 4차 결정에 따라 **복구 대상에서 제외**.

---

## 게스트와 보드 권한

- 브라우저가 보낸 사용자 이름/역할/객체 소유자 ID를 신뢰하지 않음.
- Node.js는 인증 티켓으로 세션과 역할을 확인하고 이벤트마다 권한 검증.
- 이미 다른 보드에 참여한 소켓이 임의의 `board_id`로 이벤트를 보내지 못하도록 검사.
- 클라이언트가 DB의 키를 임의 지정해 타 프로젝트 객체를 조작하지 못하도록 FK와 권한 검사 결합.
