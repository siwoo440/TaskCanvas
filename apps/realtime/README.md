# Realtime 서버 (2단계 구현)

Node.js + Socket.IO 실시간 서버입니다. 보드 참여, 참여자·커서 공유, 펜 미리보기 중계, 펜 확정 저장을 담당합니다. 이벤트 규격은 [docs/08-realtime-contract.md](../../docs/08-realtime-contract.md)를 따릅니다.

## 확인된 환경

| 항목 | 값 |
|---|---|
| Node.js | 24 LTS (18 이상이면 동작) |
| 패키지 | `socket.io` 4, `mysql2` 3, 개발용 `socket.io-client` |
| DB | PHP API 와 같은 `taskcanvas` DB (티켓·객체 저장) |

## 폴더 구조

```
realtime/
├── src/
│   ├── server.js        # 진입점. /health HTTP 와 Socket.IO 서버
│   ├── env.js           # .env 로더
│   ├── db.js            # mysql2 커넥션 풀
│   ├── auth.js          # 티켓 일회성 검증, 역할 재확인
│   ├── presence.js      # 보드별 참여자·커서 색상(메모리)
│   ├── locks.js         # 객체 선점 잠금(메모리, TTL·연결 종료 해제)
│   ├── video.js         # 외부 영상 URL 검증·임베드 URL 생성
│   └── handlers/
│       ├── board.js     # board:join, disconnect → presence:update
│       ├── cursor.js    # cursor:move 중계(약 30Hz 제한)
│       ├── stroke.js    # stroke:preview 중계, stroke:commit DB 저장
│       ├── object.js    # object:create 도형·이미지·영상·업무 블럭 저장
│       ├── edit.js      # object:lock·preview·commit·delete·unlock
│       ├── task.js      # task:create·update (공유 업무 원본, 프로젝트 방 전파)
│       ├── link.js      # link:create·update·delete (관계 연결선)
│       └── reply.js     # ack 응답 형식, 보드 일치 검사
├── scripts/test-client.js  # 2인 통합 테스트(실행 중인 서버 대상)
├── scripts/acceptance.js   # 수용 테스트 AC01~AC14, AC16~AC21 (서버를 직접 띄워 검사)
├── scripts/fixtures/       # 업로드 표본 이미지(png/jpg/webp/gif/위장 파일)
└── .env.example
```

## 실행

```bash
cd apps/realtime; npm install; cp .env.example .env; npm start
```

`http://localhost:3001/health` 가 `{"status":"ok"}` 를 돌려주면 준비 완료입니다. 다른 PC에서는 서버 PC의 LAN IP와 3001 포트로 접속하며, Windows 방화벽에서 3001 포트를 허용해야 합니다.

## 통합 테스트

PHP API(8080)와 실시간 서버(3001)가 모두 떠 있는 상태에서 실행합니다. 초대 코드는 `php bin/create-invite.php` 로 발급한 editor 코드입니다.

```bash
node apps/realtime/scripts/test-client.js <초대코드>
```

두 사용자가 입장 → 티켓 발급 → 보드 참여 → 커서·펜 미리보기 중계 → 펜 확정 저장 → 스냅샷 복원 → 연결 종료 갱신을 순서대로 검사합니다.

## 수용 테스트

```bash
npm run test:acceptance
```

MariaDB 만 켜져 있으면 됩니다. PHP 내장 서버(8081)와 실시간 서버(3002, 잠금 TTL 1.5초)를 직접 띄우고 테스트 프로젝트·초대 코드를 만든 뒤 `docs/11-acceptance-tests.md` 의 AC01~AC14, AC16~AC21 을 검사해 마크다운 표로 출력합니다(AC10·AC15 는 수동). PHP 경로가 다르면 `PHP_BIN` 환경 변수로 지정합니다. 실행 환경 변수(`PORT`, `LOCK_TTL_MS`, `LOCK_SWEEP_MS` 등)는 `.env` 보다 우선합니다.

## 이벤트 요약

| 방향 | 이벤트 | 내용 |
|---|---|---|
| C→S (ack) | `board:join` `{board_id, ticket}` | 티켓 검증 후 방 참여. 응답 `{ok, you, participants}` |
| S→C | `presence:update` `{participants}` | 참여자 입장·퇴장 시 전체 목록 |
| C→S | `cursor:move` `{board_id, x, y}` | 커서 중계. S→C 로 `{guest_id, display_name, color, x, y}` |
| C→S | `stroke:preview` `{board_id, stroke_id, points_delta, style}` | 그리는 중 중계 (DB 기록 없음) |
| C→S (ack) | `stroke:commit` `{board_id, stroke_id, points, style, request_id}` | DB 저장. 응답 `{ok, request_id, object_id, new_version, persisted}` |
| C→S (ack) | `object:create` `{board_id, type, x, y, width, height, style, payload, request_id}` | `rect`·`ellipse`·`image`(payload.asset_id)·`video`(payload.source_url)·`task`(payload.task_id) 생성. 응답에 `object` 포함 |
| S→C | `object:created` `{board_id, guest_id, object}` | 다른 참여자에게 확정 객체 전달 |
| C→S (ack) | `object:lock` `{board_id, object_id}` | 선점 잠금. 응답 `{lock_token, expires_in}`, 실패 `OBJECT_LOCKED` + `error.locked_by` |
| C→S | `object:preview` `{board_id, object_id, lock_token, x, y, width?, height?}` | 잠금 소유자의 이동·크기 조절 중 상태 중계(크기는 조절 중일 때만) |
| C→S (ack) | `object:commit` `{board_id, object_id, lock_token, version, changes, request_id}` | 버전 검사 후 저장·잠금 해제. `changes`: x, y, width, height(도형만), style |
| C→S (ack) | `object:delete` `{board_id, object_id, lock_token, version}` | 버전 검사 후 삭제·잠금 해제 |
| C→S (ack) | `object:unlock` `{board_id, object_id, lock_token}` | 변경 없이 잠금 해제 |
| S→C | `object:locked` / `object:unlocked` / `object:preview` / `object:updated` / `object:deleted` | 잠금·해제(reason)·이동 중·변경·삭제 전파 |
| C→S (ack) | `task:create` `{board_id, title, status, assignee_id, due_at}` | 공유 업무 원본 생성. 응답 `{task}` |
| C→S (ack) | `task:update` `{board_id, task_id, version, changes}` | 버전 검사 후 저장. 충돌 시 `VERSION_CONFLICT` + 최상위 `task` |
| S→C | `task:created` / `task:updated` `{task, guest_id}` | 프로젝트 방(`project:{id}`)의 모든 보드 참여자에게 전파 |
| C→S (ack) | `link:create` `{board_id, from_object_id, to_object_id, label}` / `link:update` `{link_id, label}` / `link:delete` `{link_id}` | 연결선. 응답 `{link}`. S→C 로 `link:created`/`link:updated`/`link:deleted` 전파 |

오류 ack 는 `{ok:false, error:{code, message}}` 이며 코드는 HTTP API 와 같은 체계(`INVALID_TICKET`, `FORBIDDEN`, `BAD_REQUEST`, `SAVE_FAILED`, `ALREADY_JOINED`, `OBJECT_LOCKED`, `LOCK_REQUIRED`, `VERSION_CONFLICT`, `NOT_FOUND`)를 씁니다.

## 설계 메모

- 한 소켓 연결은 한 보드에만 참여합니다. 다른 `board_id` 로 보낸 이벤트는 무시하거나 `FORBIDDEN` 으로 거부합니다.
- 티켓은 `UPDATE ... WHERE used_at IS NULL` 로 한 번만 소비되며 60초 뒤 만료됩니다.
- `stroke:commit` 은 소켓에 저장된 역할을 믿지 않고 매번 `project_members` 를 다시 조회합니다.
- 커서·미리보기는 메모리에서만 중계하고, 확정된 획만 `board_objects(type='stroke')` 에 저장합니다. 좌표는 `payload_json.points`, 경계 사각형은 `x/y/width/height` 입니다.
- 잠금은 소켓 단위로 메모리에만 보관합니다(`LOCK_TTL_MS`, 기본 30초). 이동 미리보기·확정 때마다 연장되고, 연결 종료·만료·확정·삭제 시 해제되며 `object:unlocked` 로 알립니다.
- `object:commit` 은 `SELECT ... FOR UPDATE` 트랜잭션 안에서 `version` 을 비교해 다르면 `VERSION_CONFLICT` 를 돌려주고 잠금을 해제합니다. 성공 시 `version+1` 로 저장합니다.

## 아직 없는 것

고급 체크리스트·댓글·표·흐름도 자동 정렬(P2)
