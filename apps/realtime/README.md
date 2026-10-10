# Realtime 서버

Node.js + Socket.IO 실시간 서버입니다. 보드 참여, 참여자·커서 공유, 펜·이동 미리보기 중계, 객체 잠금과 확정 저장, 공유 업무·연결선 전파를 담당합니다. 이벤트 규격은 [docs/08-realtime-contract.md](../../docs/08-realtime-contract.md)를 따릅니다.

## 확인된 환경

| 항목 | 값 |
|---|---|
| Node.js | 24 LTS (18 이상이면 동작) |
| 패키지 | `socket.io` 4, `mysql2` 3, 개발용 `socket.io-client`·`puppeteer-core`(화면 캡처용, 브라우저는 내려받지 않고 설치된 Chrome·Edge 사용) |
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
│   ├── note.js          # 메모 글·스타일 검증(2000자, 제어 문자 제거, 글자 크기 10~72)
│   ├── boards.js        # 보드 삭제·이름 변경 감시(주기적 DB 확인 → board:renamed / board:deleted)
│   ├── origin.js        # 접속 출처 검사(CORS_ORIGIN: auto·*·목록)
│   └── handlers/
│       ├── board.js     # board:join, disconnect → presence:update
│       ├── cursor.js    # cursor:move 중계(약 30Hz 제한)
│       ├── stroke.js    # stroke:preview 중계, stroke:commit DB 저장
│       ├── object.js    # object:create 도형·이미지·영상·업무 블럭 저장
│       ├── edit.js      # object:lock·preview·commit·delete·unlock
│       ├── task.js      # task:create·update (공유 업무 원본, 프로젝트 방 전파)
│       ├── link.js      # link:create·update·delete (관계 연결선)
│       ├── ping.js      # net:ping (접속 점검 화면의 왕복 시간 측정용 응답)
│       └── reply.js     # ack 응답 형식, 보드 일치 검사
├── scripts/test-client.js  # 2인 통합 테스트(실행 중인 서버 대상)
├── scripts/acceptance.js   # 수용 테스트 AC01~AC14, AC16~AC23 과 보안 점검 SEC01·운영 점검 OPS01 (서버를 직접 띄워 검사)
├── scripts/rehearsal.js    # 시연 리허설(브라우저 4개로 시연 대본 실행 + 전달 지연 측정)
├── scripts/capture-screens.js  # 실제 화면 캡처(임시 서버 + 설치된 Chrome 조작 → assets/screenshots)
├── scripts/check-env.js    # 사전 점검(Node·패키지·DB·포트·LAN 주소·방화벽·외부 영상)
├── scripts/lib/browser-kit.js  # 리허설·캡처가 함께 쓰는 브라우저 조작 도우미
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

MariaDB 만 켜져 있으면 됩니다. PHP 내장 서버(8081)와 실시간 서버(3002, 잠금 TTL 1.5초)를 직접 띄우고 테스트 프로젝트·초대 코드를 만든 뒤 `docs/11-acceptance-tests.md` 의 AC01~AC14, AC16~AC23 을 검사해 마크다운 표로 출력합니다(AC10·AC15 는 수동). 수용 기준과 별도로 접속 출처 제한(SEC01)과 업로드 정리(OPS01)도 검사해 요약 줄을 따로 냅니다. 업로드 정리는 러너가 만든 테스트 프로젝트의 이미지만 대상으로 합니다. PHP 경로가 다르면 `PHP_BIN` 환경 변수로 지정합니다. 실행 환경 변수(`PORT`, `LOCK_TTL_MS`, `LOCK_SWEEP_MS` 등)는 `.env` 보다 우선합니다.

## 시연 리허설

```bash
npm run rehearsal
```

MariaDB 와 Chrome(또는 Edge)만 있으면 됩니다. PHP 내장 서버(8083)와 실시간 서버(3004)를 임시로 띄우고 "리허설 프로젝트"에 예시 내용을 채운 뒤, 브라우저 네 개(관리자 1·편집자 3)로 [시연 대본](../../docs/16-demo-script.md)의 1~9번 장면을 실제 마우스·키보드 입력으로 실행합니다. 맨 앞에서 접속 점검 화면(`check.html`)도 열어 서버에 닿는 항목이 통과인지 봅니다. 약 30초 걸리며 장면별 `PASS`/`FAIL` 과 결과 표를 출력합니다. 실패가 있으면 종료 코드 1 입니다.

- 장면 뒤에는 A 화면이 보낸 것이 다른 화면에 도착하기까지의 시간을 잽니다(커서·펜 미리보기·이동 미리보기·확정 저장 응답·확정 결과). 미리보기 중앙값이 150ms, 확정 저장 응답 중앙값이 500ms 를 넘으면 실패입니다(`REH_MAX_PREVIEW_MS`·`REH_MAX_COMMIT_MS` 로 변경).
- 마지막에 네 화면의 객체·연결선이 서버 저장 내용과 같은지, 화면 스크립트 오류가 없었는지 확인하고, 이 실행에서 만든 초대 코드를 모두 취소합니다. "리허설 프로젝트"는 DB 에 남습니다.
- **네 화면이 모두 이 PC 안에서 돕니다.** 다른 PC 의 접속·방화벽·LAN 구간의 지연은 확인하지 못하므로 AC15 를 대신하지 않습니다. 영상은 객체 생성까지만 확인하고 외부 요청은 보내지 않습니다.
- 환경 변수: `DB_NAME`(다른 DB), `CHROME_BIN`, `PHP_BIN`, `REH_API_PORT`, `REH_RT_PORT`.

## 사전 점검

```bash
npm run check
```

Node 버전, 패키지 설치, `.env` 와 접속 출처 설정, DB 연결, 두 포트(서버가 떠 있으면 응답, 아니면 비어 있는지), LAN 주소, Windows 방화벽의 허용·차단 규칙, 외부 영상 접속을 확인합니다. PHP 쪽까지 한 번에 보려면 저장소 루트의 `scripts\check-env.bat` 을 씁니다.

- 방화벽 규칙은 관리자 권한 없이 읽을 수 있는 레지스트리 저장 값을 해석합니다. 읽지 못하면 `[주의]` 로만 알립니다.
- 서버가 떠 있을 때 실행하면 LAN 주소로도 응답하는지 확인합니다. 그래도 다른 PC 에서 실제로 닿는지는 마지막에 출력되는 접속 점검 주소(`/check.html`)를 그 PC 의 브라우저로 열어 확인해야 합니다.

## 접속 출처 제한

`CORS_ORIGIN` 으로 실시간 서버에 붙을 수 있는 브라우저 출처를 정합니다(`src/origin.js`).

| 값 | 동작 |
|---|---|
| `auto` (기본) | 요청의 Origin 과 Host 의 호스트 이름이 같을 때만 허용. 화면은 `http://서버IP:8080`, 실시간 서버는 `서버IP:3001` 이라 포트만 다르므로 서버 IP 가 바뀌어도 설정을 고치지 않아도 됨 |
| `*` | 모든 출처 허용(개발용) |
| 쉼표 목록 | `http://192.168.0.10:8080,http://192.168.0.10` 처럼 적은 출처만 허용 |

- 폴링 응답의 CORS 헤더뿐 아니라 웹소켓을 포함한 모든 새 연결 요청에서 검사합니다(거부 시 403). 웹소켓 연결은 브라우저의 CORS 검사를 받지 않기 때문입니다.
- Origin 헤더가 없는 요청(브라우저가 아닌 테스트 스크립트)은 통과시킵니다. 권한은 어느 경우든 일회용 티켓이 지킵니다.
- 화면과 실시간 서버를 서로 다른 호스트에 두려면 `auto` 대신 목록을 씁니다. 거부된 화면에는 "실시간 서버에 연결하지 못했습니다" 안내가 뜹니다.
- 이미 `.env` 를 만들어 둔 PC 는 예전 값 `CORS_ORIGIN=*` 가 남아 있을 수 있습니다. `auto` 로 바꾸고 서버를 다시 띄웁니다.

## 화면 캡처

```bash
npm run capture
```

MariaDB 만 켜져 있으면 됩니다. PHP 내장 서버(8082)와 실시간 서버(3003)를 임시로 띄우고 "시연 프로젝트"를 만들어 예시 내용을 채운 뒤, 설치된 Chrome 을 창 없이 실행해 관리자와 편집자 두 사람으로 접속하고 `assets/screenshots/` 에 9장(소개·입장·작업실·초대 관리·보드·잠금·업무·메모 편집·PNG 내보내기)을 저장합니다.

- 찍는 김에 실제 키보드·마우스 입력으로 다섯 가지를 확인해 `PASS`/`FAIL` 로 출력합니다: 초대 링크 입장, 메모 글 입력 후 바깥 클릭 저장, 오른쪽 패널에서 글자 크기 변경, Ctrl+Z 두 번으로 차례로 되돌리기, Ctrl+Y 두 번으로 다시 실행. 하나라도 실패하면 종료 코드 1 입니다.
- 실행할 때마다 `.env` 의 DB 에 "시연 프로젝트"가 하나 생깁니다. 다른 DB 에서 찍으려면 `DB_NAME` 환경 변수를 지정합니다. Chrome 경로는 `CHROME_BIN`, PHP 경로는 `PHP_BIN`, 포트는 `CAP_API_PORT`·`CAP_RT_PORT` 로 바꿀 수 있습니다.
- 수용 테스트(8081·3002)나 개발 서버(8080·3001)와 포트가 달라 동시에 떠 있어도 됩니다.

## 이벤트 요약

| 방향 | 이벤트 | 내용 |
|---|---|---|
| C→S (ack) | `board:join` `{board_id, ticket}` | 티켓 검증 후 방 참여. 응답 `{ok, you, participants}` |
| S→C | `presence:update` `{participants}` | 참여자 입장·퇴장 시 전체 목록 |
| C→S | `cursor:move` `{board_id, x, y}` | 커서 중계. S→C 로 `{guest_id, display_name, color, x, y}` |
| C→S | `stroke:preview` `{board_id, stroke_id, points_delta, style}` | 그리는 중 중계 (DB 기록 없음) |
| C→S (ack) | `stroke:commit` `{board_id, stroke_id, points, style, request_id}` | DB 저장. 응답 `{ok, request_id, object_id, new_version, persisted}` |
| C→S (ack) | `object:create` `{board_id, type, x, y, width, height, style, payload, request_id}` | `rect`·`ellipse`·`image`(payload.asset_id)·`video`(payload.source_url)·`task`(payload.task_id)·`note`(payload.text) 생성. 응답에 `object` 포함 |
| S→C | `object:created` `{board_id, guest_id, object}` | 다른 참여자에게 확정 객체 전달 |
| C→S (ack) | `object:lock` `{board_id, object_id}` | 선점 잠금. 응답 `{lock_token, expires_in}`, 실패 `OBJECT_LOCKED` + `error.locked_by` |
| C→S | `object:preview` `{board_id, object_id, lock_token, x, y, width?, height?}` | 잠금 소유자의 이동·크기 조절 중 상태 중계(크기는 조절 중일 때만) |
| C→S (ack) | `object:commit` `{board_id, object_id, lock_token, version, changes, request_id}` | 버전 검사 후 저장·잠금 해제. `changes`: x, y, width, height(획 제외), style, text(메모만) |
| C→S (ack) | `object:delete` `{board_id, object_id, lock_token, version}` | 버전 검사 후 삭제·잠금 해제 |
| C→S (ack) | `object:unlock` `{board_id, object_id, lock_token}` | 변경 없이 잠금 해제 |
| S→C | `object:locked` / `object:unlocked` / `object:preview` / `object:updated` / `object:deleted` | 잠금·해제(reason)·이동 중·변경·삭제 전파 |
| C→S (ack) | `task:create` `{board_id, title, status, assignee_id, due_at}` | 공유 업무 원본 생성. 응답 `{task}` |
| C→S (ack) | `task:update` `{board_id, task_id, version, changes}` | 버전 검사 후 저장. 충돌 시 `VERSION_CONFLICT` + 최상위 `task` |
| S→C | `task:created` / `task:updated` `{task, guest_id}` | 프로젝트 방(`project:{id}`)의 모든 보드 참여자에게 전파 |
| C→S (ack) | `link:create` `{board_id, from_object_id, to_object_id, label}` / `link:update` `{link_id, label}` / `link:delete` `{link_id}` | 연결선. 응답 `{link}`. S→C 로 `link:created`/`link:updated`/`link:deleted` 전파 |
| S→C | `board:renamed` `{board_id, title}` / `board:deleted` `{board_id}` | 작업실에서 보드 이름이 바뀌거나 삭제되면 그 보드의 참여자에게 알림. 삭제 시 알림 뒤 연결 종료. 감지 주기 `BOARD_SWEEP_MS`(기본 5초) |
| C→S (ack) | `net:ping` | 접속 점검 화면이 왕복 시간을 잴 때 사용. 보드 참여 전에도 `{ok:true}` 만 바로 돌려줌 |

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
