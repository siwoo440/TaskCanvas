# Frontend (3단계 구현)

프레임워크·빌드 도구 없이 HTML/CSS/JavaScript 와 Canvas API 로 만든 화이트보드 화면입니다. `public/` 폴더를 그대로 웹 서버에 올리면 동작합니다. 화면 구성은 [docs/04-ui-spec.md](../../docs/04-ui-spec.md), 이벤트는 [docs/08-realtime-contract.md](../../docs/08-realtime-contract.md)를 따릅니다.

## 폴더 구조

```
frontend/public/
├── index.html        # 입장 / 보드 선택 / 화이트보드 세 화면
├── css/app.css
└── js/
    ├── config.js     # API 경로, 실시간 서버 주소(기본: 같은 호스트의 3001 포트)
    ├── api.js        # fetch 래퍼 (JSON, X-TaskCanvas 헤더, 오류 코드)
    ├── realtime.js   # Socket.IO 연결, 티켓 참여, 재접속 시 자동 재참여
    ├── media.js      # 이미지 업로드(multipart), 영상 URL 사전 검사, 영상 iframe 오버레이
    ├── canvas.js     # 격자·객체·미리보기·커서·선택/잠금 표시 렌더링, 클릭 판정, 확대·이동 뷰포트
    ├── tools.js      # 선택·펜·사각형·원·이동 도구 입력 처리, 단축키
    └── app.js        # 화면 전환, 상태, API·실시간 연결, 잠금 기반 이동·삭제·속성 변경
```

Socket.IO 클라이언트 스크립트는 실시간 서버가 제공하는 `http://<서버>:3001/socket.io/socket.io.js` 를 동적으로 불러오므로 인터넷 연결이 없는 학교 LAN 에서도 동작합니다.

## 개발 실행 (서버 1대)

MariaDB 가 실행 중이고 `apps/php-api/.env`, `apps/realtime/.env` 가 준비된 상태에서:

```bash
C:/xampp/php/php.exe -S 0.0.0.0:8080 -t apps/frontend/public apps/php-api/public/index.php
```

```bash
node apps/realtime/src/server.js
```

브라우저에서 `http://localhost:8080` 을 열고 초대 코드로 입장합니다. 다른 PC 는 `http://<서버 LAN IP>:8080` 으로 접속하며, 실시간 서버는 같은 호스트의 3001 포트로 자동 연결됩니다. (PHP 내장 서버는 `/api/*` 만 PHP 로 처리하고 나머지는 이 폴더의 정적 파일을 제공합니다.)

## Apache(XAMPP) 배포

1. `apps/frontend/public` 내용을 `C:/xampp/htdocs/` 에 복사(또는 `DocumentRoot` 변경).
2. `apps/php-api/README.md` 의 `Alias /api` 설정 추가.
3. `js/config.js` 의 `realtimeUrl` 이 서버 PC 주소와 맞는지 확인(기본값은 접속한 호스트의 3001 포트).

## 화면 동작

| 화면 | 동작 |
|---|---|
| 입장 | 이름·초대 코드 → `POST /api/guest/join`. 세션 쿠키가 있으면 `GET /api/me` 로 바로 보드 선택 화면 |
| 보드 선택 | 보드 목록·생성(편집자 이상), 나가기 |
| 화이트보드 | 스냅샷 복원 → 티켓 발급 → `board:join`. 상단에 보드 전환·참여자·연결/저장 상태 |

| 조작 | 동작 |
|---|---|
| 선택 (V) | 객체 클릭 → `object:lock` 획득 후 드래그 이동(`object:preview`), 놓으면 `object:commit`. Shift+클릭으로 선택 토글, 빈 곳 드래그는 영역 선택. 여러 개를 선택하고 끌면 모든 객체 잠금을 얻은 뒤 함께 이동(하나라도 타인 잠금이면 전체 취소) |
| 연결선 (L) | 객체에서 객체로 드래그 → `link:create`. 선을 클릭하면 오른쪽 패널에서 라벨 저장(`link:update`)·삭제(`link:delete`). 연결된 객체를 지우면 선도 사라짐 |
| Delete / Backspace | 선택 객체(여러 개 가능)를 하나씩 잠근 뒤 `object:delete`, 연결선 선택 시 `link:delete` |
| 속성 패널 변경 | 선택 객체가 있으면 잠근 뒤 `object:commit{changes:{style}}` 로 색상·굵기·채우기 적용 |
| 펜 (P) | 누른 채 이동하면 약 40ms 단위로 `stroke:preview`, 놓으면 `stroke:commit` |
| 사각형 (R) / 원 (O) | 드래그로 생성, 놓으면 `object:create` |
| 이미지 🖼 | 파일 선택·캔버스에 드래그 앤 드롭·Ctrl+V → `POST /api/images` → `object:create{type:'image'}`. 긴 변 400 단위로 맞춰 삽입 |
| 영상 ▶ | URL 입력(YouTube·Vimeo) → `object:create{type:'video'}`. 서버가 만든 `embed_url` 을 오버레이 iframe 으로 표시, 제목 막대를 잡아 이동 |
| 업무 블럭 ☑ (T) | 기존 업무 선택 또는 새 업무 생성(`task:create`) → `object:create{type:'task', payload:{task_id}}`. 블럭을 선택하면 오른쪽 패널에서 제목·상태·담당자·마감일을 수정(`task:update`)하며 같은 업무를 참조하는 모든 보드의 블럭이 함께 바뀜. 블럭 삭제는 보드 표시만 제거 |
| 격자 맞춤 | 속성 패널 체크 시 도형 생성·이동 좌표를 10 단위로 맞춤 |
| 이동 (H), Space+드래그, 가운데 버튼 | 화면 이동 |
| 마우스 휠 | 커서 기준 확대·축소 (0.1~8배) |
| ⤢ | 객체 전체가 보이도록 화면 맞춤 |
| Esc | 그리는 중인 획·도형 취소, 이동 취소(잠금 해제), 선택 해제 |

- 저장 상태는 서버 ack(`persisted:true`)를 받은 뒤에만 `저장됨` 으로 바뀝니다. 응답 대기 중인 객체는 반투명으로 표시되고, 실패하면 화면에서 제거되고 안내가 뜹니다.
- 연결이 끊기면 `재접속 중` 으로 표시되고, 다시 연결되면 새 티켓으로 자동 재참여한 뒤 **서버의 마지막 저장 상태**를 다시 불러옵니다(미저장 작업은 복구하지 않음).
- 열람자는 도구가 비활성화되고 화면 이동만 가능합니다. 서버도 별도로 권한을 검사합니다.
- 타인의 커서는 5초, 확정되지 않은 미리보기는 15초 뒤 자동으로 지워집니다.
- 다른 사용자가 잠근 객체는 그 사람 색상의 점선 테두리와 "OOO 편집 중" 이름표로 표시되고, 클릭하면 안내만 뜨고 선택되지 않습니다. 타인의 이동 중 위치(`object:preview`)도 실시간으로 따라갑니다.
- 이동 중 잠금이 만료되거나(30초) 다른 사용자가 먼저 수정해 `VERSION_CONFLICT` 가 나면 이동을 취소하고 스냅샷을 다시 불러옵니다.

- 이미지는 `<img>` 캐시로 캔버스에 직접 그리고(로딩·실패 자리 표시 포함), 영상은 캔버스에 그릴 수 없으므로 `#overlay` 의 iframe 을 매 렌더마다 캔버스 좌표에 맞춰 이동·크기 조정합니다. iframe 영역은 재생용으로 클릭을 받고, 위쪽 제목 막대만 캔버스가 받아 선택·이동합니다.

## 아직 없는 것

- 크기 조절 핸들, 초대 링크 편의 기능 — P1 후순위
- 고급 체크리스트·댓글·표·흐름도 자동 정렬 — P2
