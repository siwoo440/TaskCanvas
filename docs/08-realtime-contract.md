# Socket.IO 실시간 이벤트 규격

---

## 이벤트 목록

| 이벤트 | 클라이언트 데이터 | 서버 처리 | DB |
|---|---|---|---|
| `board:join` | board_id, short_lived_ticket | 방 참여·권한 검사 | 조회만 |
| `project:join` | project_id, short_lived_ticket(작업실용) | 작업실 연결. 프로젝트 방에만 참여하며 이 연결은 `task:create`·`task:update`·`task:delete` 와 `checklist:*` 만 쓸 수 있음. 응답 `{project_id, you}` | 조회만 |
| `cursor:move` | board_id, x, y | 커서 위치 중계, 전송 빈도 제한 | X |
| `selection:set` | board_id, object_ids(번호 목록, 최대 200개), link_id(없으면 null) | 내가 고른 객체·연결선을 같은 보드의 참여자에게 전달하고 참여자 목록에 기억. 번호 형식만 검사하며 저장하지 않음. 응답 `{ok}` | X |
| `stroke:preview` | stroke_id, points_delta | 마우스 움직이는 동안 중계 | X |
| `stroke:commit` | stroke_id, points, style, request_id | 완성 획 확정·저장 | O |
| `object:create` | type(rect·ellipse·image·video·task·note), x, y, width, height, style, payload, request_id | 새 객체 확정 생성(잠금 불필요). note 는 `payload.text`(2000자 이하), `style.fill`(배경, 없으면 배경 없는 텍스트)·`style.color`(글자 색) | O |
| `object:lock` | object_id | 객체별 임시 잠금 획득 | X |
| `object:preview` | object_id, x, y, (width, height) | 잠금 소유자만 이동·크기 조절 중 중계. width·height 는 크기 조절 때만 포함 | X |
| `object:commit` | object_id, lock_token, version, changes, request_id | 변경 승인·저장·다른 참여자 중계 | O |
| `object:delete` | object_id, lock_token, version | 삭제 승인 | O |
| `object:unlock` | object_id, lock_token | 잠금 해제 | X |
| `task:create` (P1) | title, status, assignee_id, due_at (보드 연결은 board_id 도) | 업무 원본 생성 후 프로젝트 전체(모든 보드와 작업실)에 `task:created` 전파 | O |
| `task:update` (P1) | task_id, version, changes(title·status·assignee_id·due_at) (보드 연결은 board_id 도) | 버전 검사 후 저장, 프로젝트 전체(모든 보드와 작업실)에 `task:updated` 전파 | O |
| `task:delete` (P1) | task_id (보드 연결은 board_id 도) | 업무 원본과 체크리스트, 그 업무를 가리키는 모든 보드의 블럭을 함께 삭제. 응답 `{task_id, removed_objects}`. 블럭이 있던 보드에는 `object:deleted`, 프로젝트 전체에는 `task:deleted` 전파. 되돌릴 수 없음 | O |
| `checklist:add` (P1) | task_id, title(1~120자) (보드 연결은 board_id 도) | 업무에 세부 항목 추가(업무마다 30개까지). 응답 `{task, item_id}`, 프로젝트 전체에 `task:updated` 전파 | O |
| `checklist:update` (P1) | task_id, item_id, changes(title·done) (보드 연결은 board_id 도) | 항목의 이름이나 완료 여부 저장. 응답 `{task}`, 프로젝트 전체에 `task:updated` 전파 | O |
| `checklist:delete` (P1) | task_id, item_id (보드 연결은 board_id 도) | 항목 삭제. 응답 `{task}`, 프로젝트 전체에 `task:updated` 전파 | O |
| `link:create` (P1) | from_object_id, to_object_id, label | 같은 보드의 서로 다른 두 객체 연결. `link:created` 전파 | O |
| `link:update` (P1) | link_id, label | 라벨 변경. `link:updated` 전파 | O |
| `link:delete` (P1) | link_id | 연결선 삭제. `link:deleted` 전파. 객체 삭제 시 DB FK 로 함께 삭제 | O |
| `net:ping` | 없음 | 접속 점검 화면(`check.html`)이 왕복 시간을 잴 때 사용. 보드 참여 전에도 `{ok:true}` 만 바로 돌려줌 | X |

서버→클라이언트 이벤트: `presence:update`(참여자 목록. 참여자마다 `cursor` 에 마지막 커서 위치 `{x, y}` 또는 null — 따라가기용, 19단계. `selection` 에 지금 고른 것 `{object_ids, link_id}` — 20단계), `cursor:move`(타인 커서), `selection:update`(타인 선택: guest_id, display_name, color, object_ids, link_id. 아무것도 고르지 않았으면 빈 목록과 null — 20단계), `stroke:preview`(타인 펜 미리보기), `object:created`(확정 객체), `object:locked`(타인 잠금: object_id, guest_id, display_name, color), `object:unlocked`(해제: object_id, reason), `object:preview`(타인 이동 중 위치), `object:updated`(변경 확정 객체), `object:deleted`(삭제된 object_id), `task:created`/`task:updated`(공유 업무 원본 — 프로젝트 방 `project:{id}` 로 보드와 무관하게 전파, 작업실 연결도 받음. 업무에는 `checklist: [{item_id, title, done}]` 가 함께 실리고, 체크리스트가 바뀔 때도 `task:updated` 로 업무 전체를 다시 보냄 — 21단계), `task:deleted`(task_id, guest_id — 업무가 지워짐. 블럭은 `object:deleted` 로 따로 옴, 22단계), `project:deleted`(project_id — 관리자가 작업실을 지움. 그 작업실의 보드 연결과 작업실 연결 모두에게 보내고 0.3초 뒤 연결을 끊음. 이때 `board:deleted` 는 보내지 않음, 22단계), `board:renamed`(board_id, title)·`board:deleted`(board_id) — 작업실(HTTP)에서 보드가 바뀌면 서버가 5초 주기(`BOARD_SWEEP_MS`)로 감지해 그 보드의 참여자에게 알리고, 삭제 시에는 알림 뒤 연결을 끊음.

**구현 상태(2~4·7~9·11·17·19~22단계):** 위 이벤트 전부가 `apps/realtime` 에 구현되어 있습니다. ack 응답은 `{ok:true, ...}` 또는 `{ok:false, error:{code,message}}` 형식이며, `object:lock` 실패 시 `error.locked_by`, `VERSION_CONFLICT` 시 최상위 `object`(최신 상태)를 함께 돌려줍니다. `board:join` 응답에는 현재 보드의 잠금 목록 `locks` 가 포함됩니다. 한 연결은 보드 참여와 작업실 연결 중 하나만 할 수 있고, 작업실 연결이 보드 이벤트를 보내면 `FORBIDDEN` 입니다. 업무 이벤트의 `VERSION_CONFLICT` 는 최상위 `task`(최신 상태)를 함께 돌려줍니다.

**삭제(22단계):** `task:delete` 는 편집자 이상만 쓸 수 있고 버전을 보지 않습니다(지우려는 뜻이 분명하므로). 업무 행을 잠근 트랜잭션 안에서 블럭과 업무를 함께 지우고, 누가 그 블럭을 잠그고 있었으면 잠금도 정리합니다. 작업실 삭제는 웹 서버(HTTP)가 처리하고, 실시간 서버는 접속자가 있는 작업실이 DB 에 남아 있는지 `BOARD_SWEEP_MS`(기본 5초)마다 확인해 `project:deleted` 를 보냅니다.

**체크리스트(21단계):** `checklist:*` 는 편집자 이상만 쓸 수 있고, 업무가 그 연결의 프로젝트에 속해야 합니다(아니면 `NOT_FOUND`). 항목 이름은 앞뒤 공백과 줄바꿈을 정리해 1~120자, `done` 은 참·거짓만 받습니다(`BAD_REQUEST`). 항목 단위로 저장하고 업무의 `version` 은 올리지 않으므로 `task:update` 의 버전 검사와 서로 걸리지 않습니다. 같은 항목을 동시에 바꾸면 나중에 저장된 값이 남습니다. 30개 제한은 업무 행을 잠그고 세므로 한꺼번에 여러 개를 보내도 넘지 않습니다.

**요청 제한(19단계):** 연결마다 두 가지 한도를 둡니다. 응답을 돌려주는 요청(참여·잠금·저장·삭제·업무·체크리스트·연결선·선택 알림·`net:ping`)은 한꺼번에 300개까지, 그 뒤로는 1초에 50개씩 받고 넘치면 `{ok:false, error:{code:'RATE_LIMITED'}}` 로 거절합니다(처리하지 않음). 미리보기 중계(`stroke:preview`·`object:preview`)는 한꺼번에 1200개, 1초에 600개까지 전달하고 넘치면 조용히 버립니다. 커서는 기존대로 약 30Hz 로 따로 제한합니다. 값은 `RATE_SAVE_BURST`·`RATE_SAVE_PER_SEC`·`RATE_RELAY_BURST`·`RATE_RELAY_PER_SEC` 로 바꾸고, BURST 를 0 으로 두면 끕니다.

**접속 출처(14단계):** 새 연결 요청마다 Origin 헤더를 검사합니다. 기본값 `CORS_ORIGIN=auto` 는 실시간 서버와 같은 호스트에서 열린 페이지만 허용하며, 거부된 연결은 403 으로 끝나 `board:join` 까지 가지 못합니다. 설정값은 [apps/realtime/README.md](../apps/realtime/README.md)의 "접속 출처 제한"을 참고합니다.

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
8. 메모(`type='note'`)의 글은 `object:commit` 의 `changes.text` 로 바꿈. 글자 크기는 `style.size`(10~72)에 저장하고 `changes.style` 로 바꾸며, 숫자가 아니거나 범위 밖이면 기본 16 으로 저장. 서버가 줄바꿈을 `\n` 으로 통일하고 제어 문자를 지우며 2000자를 넘으면 거부. 메모가 아닌 객체에 보낸 `text` 는 무시. 클라이언트는 편집하는 동안 10초마다 `object:preview` 를 보내 잠금을 연장하고, 방금 만든 메모를 비워 둔 채 끝내면 `object:delete` 로 지움.

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
