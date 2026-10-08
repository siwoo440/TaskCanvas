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
│   └── handlers/
│       ├── board.js     # board:join, disconnect → presence:update
│       ├── cursor.js    # cursor:move 중계(약 30Hz 제한)
│       ├── stroke.js    # stroke:preview 중계, stroke:commit DB 저장
│       ├── object.js    # object:create 도형 저장
│       └── reply.js     # ack 응답 형식, 보드 일치 검사
├── scripts/test-client.js  # 2인 통합 테스트
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

## 이벤트 요약

| 방향 | 이벤트 | 내용 |
|---|---|---|
| C→S (ack) | `board:join` `{board_id, ticket}` | 티켓 검증 후 방 참여. 응답 `{ok, you, participants}` |
| S→C | `presence:update` `{participants}` | 참여자 입장·퇴장 시 전체 목록 |
| C→S | `cursor:move` `{board_id, x, y}` | 커서 중계. S→C 로 `{guest_id, display_name, color, x, y}` |
| C→S | `stroke:preview` `{board_id, stroke_id, points_delta, style}` | 그리는 중 중계 (DB 기록 없음) |
| C→S (ack) | `stroke:commit` `{board_id, stroke_id, points, style, request_id}` | DB 저장. 응답 `{ok, request_id, object_id, new_version, persisted}` |
| C→S (ack) | `object:create` `{board_id, type, x, y, width, height, style, request_id}` | 사각형·원 생성. 응답에 `object` 포함 |
| S→C | `object:created` `{board_id, guest_id, object}` | 다른 참여자에게 확정 객체 전달 |

오류 ack 는 `{ok:false, error:{code, message}}` 이며 코드는 HTTP API 와 같은 체계(`INVALID_TICKET`, `FORBIDDEN`, `BAD_REQUEST`, `SAVE_FAILED`, `ALREADY_JOINED`)를 씁니다.

## 설계 메모

- 한 소켓 연결은 한 보드에만 참여합니다. 다른 `board_id` 로 보낸 이벤트는 무시하거나 `FORBIDDEN` 으로 거부합니다.
- 티켓은 `UPDATE ... WHERE used_at IS NULL` 로 한 번만 소비되며 60초 뒤 만료됩니다.
- `stroke:commit` 은 소켓에 저장된 역할을 믿지 않고 매번 `project_members` 를 다시 조회합니다.
- 커서·미리보기는 메모리에서만 중계하고, 확정된 획만 `board_objects(type='stroke')` 에 저장합니다. 좌표는 `payload_json.points`, 경계 사각형은 `x/y/width/height` 입니다.

## 아직 없는 것 (4단계)

`object:lock / preview / commit / delete / unlock`, 잠금 TTL, 버전 충돌 처리
