# Socket.IO 실시간 이벤트 규격

---

## 이벤트 목록

| 이벤트 | 클라이언트 데이터 | 서버 처리 | DB |
|---|---|---|---|
| `board:join` | board_id, short_lived_ticket | 방 참여·권한 검사 | 조회만 |
| `cursor:move` | board_id, x, y | 커서 위치 중계, 전송 빈도 제한 | X |
| `stroke:preview` | stroke_id, points_delta | 마우스 움직이는 동안 중계 | X |
| `stroke:commit` | stroke_id, points, style, request_id | 완성 획 확정·저장 | O |
| `object:create` | type(rect·ellipse·image·video·task·note), x, y, width, height, style, payload, request_id | 새 객체 확정 생성(잠금 불필요). note 는 `payload.text`(2000자 이하), `style.fill`(배경, 없으면 배경 없는 텍스트)·`style.color`(글자 색) | O |
| `object:lock` | object_id | 객체별 임시 잠금 획득 | X |
| `object:preview` | object_id, x, y, (width, height) | 잠금 소유자만 이동·크기 조절 중 중계. width·height 는 크기 조절 때만 포함 | X |
| `object:commit` | object_id, lock_token, version, changes, request_id | 변경 승인·저장·다른 참여자 중계 | O |
| `object:delete` | object_id, lock_token, version | 삭제 승인 | O |
| `object:unlock` | object_id, lock_token | 잠금 해제 | X |
| `task:create` (P1) | title, status, assignee_id, due_at | 업무 원본 생성 후 프로젝트 전체에 `task:created` 전파 | O |
| `task:update` (P1) | task_id, version, changes(title·status·assignee_id·due_at) | 버전 검사 후 저장, 프로젝트 전체에 `task:updated` 전파 | O |
| `link:create` (P1) | from_object_id, to_object_id, label | 같은 보드의 서로 다른 두 객체 연결. `link:created` 전파 | O |
| `link:update` (P1) | link_id, label | 라벨 변경. `link:updated` 전파 | O |
| `link:delete` (P1) | link_id | 연결선 삭제. `link:deleted` 전파. 객체 삭제 시 DB FK 로 함께 삭제 | O |

서버→클라이언트 이벤트: `presence:update`(참여자 목록), `cursor:move`(타인 커서), `stroke:preview`(타인 펜 미리보기), `object:created`(확정 객체), `object:locked`(타인 잠금: object_id, guest_id, display_name, color), `object:unlocked`(해제: object_id, reason), `object:preview`(타인 이동 중 위치), `object:updated`(변경 확정 객체), `object:deleted`(삭제된 object_id), `task:created`/`task:updated`(공유 업무 원본 — 프로젝트 방 `project:{id}` 로 보드와 무관하게 전파), `board:renamed`(board_id, title)·`board:deleted`(board_id) — 작업실(HTTP)에서 보드가 바뀌면 서버가 5초 주기(`BOARD_SWEEP_MS`)로 감지해 그 보드의 참여자에게 알리고, 삭제 시에는 알림 뒤 연결을 끊음.

**구현 상태(2~4·7~9·11단계):** 위 이벤트 전부가 `apps/realtime` 에 구현되어 있습니다. ack 응답은 `{ok:true, ...}` 또는 `{ok:false, error:{code,message}}` 형식이며, `object:lock` 실패 시 `error.locked_by`, `VERSION_CONFLICT` 시 최상위 `object`(최신 상태)를 함께 돌려줍니다. `board:join` 응답에는 현재 보드의 잠금 목록 `locks` 가 포함됩니다.

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
4. 서버는 연결 종료·정상 완료·TTL 만료 시 잠금을 해제. (구현: TTL 30초, `object:preview`/`commit` 마다 연장, 5초 주기 만료 검사, 만료 시 `object:unlocked{reason:'expired'}` 를 잠금 소유자에게도 전송)
5. 다중 선택(P1)은 선택된 **모든** 객체 잠금 획득 실패 시 이동 전체 취소. (구현: 클라이언트가 객체마다 `object:lock` 을 순서대로 요청하고 하나라도 실패하면 이미 받은 토큰을 `object:unlock` 으로 반납. 성공 시 객체마다 `object:preview`/`object:commit`)
6. `version`이 불일치하면 덮어쓰지 않고 `VERSION_CONFLICT` 응답 후 새 스냅샷 요청. (구현: 충돌 시 서버가 잠금도 해제하며, 클라이언트는 `GET /api/boards/{id}/snapshot` 으로 재동기화)
7. 펜 획(`type='stroke'`)의 이동은 `changes.x/y` 만 보내고 서버가 `payload.points` 전체를 평행 이동해 저장. 크기 변경(`changes.width/height`, 1 이상)은 획을 제외한 도형·이미지·영상·업무 블럭에 허용하며 획에 보내면 무시. (9단계 구현: 클라이언트 모서리 핸들 → `object:lock` → `object:preview{x,y,width,height}` → `object:commit`)
8. 메모(`type='note'`)의 글은 `object:commit` 의 `changes.text` 로 바꿈. 서버가 줄바꿈을 `\n` 으로 통일하고 제어 문자를 지우며 2000자를 넘으면 거부. 메모가 아닌 객체에 보낸 `text` 는 무시. 클라이언트는 편집하는 동안 10초마다 `object:preview` 를 보내 잠금을 연장하고, 방금 만든 메모를 비워 둔 채 끝내면 `object:delete` 로 지움.

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
