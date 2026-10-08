# PHP API

게스트 입장·세션, 보드, 저장 스냅샷, Socket.IO 접속 티켓, 이미지 업로드, 참여자·공유 업무 조회, 관리자용 초대 코드 관리를 담당하는 순수 PHP(프레임워크·Composer 없음) API입니다. 규격은 [docs/07-http-api.md](../../docs/07-http-api.md)를 따릅니다.

## 확인된 환경

| 항목 | 값 |
|---|---|
| PHP | XAMPP 8.2 (8.0 이상, `pdo_mysql`·`fileinfo`·`mbstring` 확장 필요) |
| DB | XAMPP MariaDB 10.4 (`JSON` 컬럼은 `LONGTEXT + json_valid` 로 생성됨 — 정상) |
| 개발 서버 | PHP 내장 서버 또는 Apache |

## 폴더 구조

```
php-api/
├── public/            # 웹 루트. index.php 가 모든 /api/* 요청을 받음
│   ├── index.php      # 라우트 등록(프런트 컨트롤러)
│   └── .htaccess      # Apache 용 리라이트
├── src/
│   ├── bootstrap.php  # 오토로더·.env·예외 처리
│   ├── Env.php        # .env 로더(실행 환경 변수가 .env 보다 우선)
│   ├── Database.php   # PDO 연결, 바인딩 쿼리 헬퍼
│   ├── Request.php / Response.php / Router.php
│   ├── Auth.php       # 세션 쿠키, 역할 검사, CSRF 헤더 검사
│   ├── Invite.php     # 초대 코드 생성·발급·상태 (CLI 와 API 공용)
│   ├── Storage.php    # 업로드 폴더 경로, 업로드 파일 이름 규칙
│   ├── DemoSeed.php   # 시연용 예시 보드 내용(메모·도형·연결선·공유 업무) 채우기
│   ├── ApiException.php
│   └── controllers/   # Guest / Board / Project / Ticket / Image / Invite / System
├── bin/
│   ├── create-project.php  # 프로젝트 + 보드 생성, 최초 관리자 초대 코드 출력
│   ├── create-invite.php   # 초대 코드 발급(원문은 화면에만 출력)
│   ├── check-env.php       # 사전 점검(PHP 버전·확장·업로드 한도·DB·스키마·업로드 폴더)
│   ├── reset-demo.php      # 시연 초기화(전체 데이터·업로드 삭제 후 시연 프로젝트 생성, --seed 로 예시 채움)
│   └── seed-demo.php       # 빈 보드에 시연용 예시 내용 채우기
├── storage/
│   ├── .htaccess      # 웹 직접 접근 차단(이중 방어)
│   └── uploads/       # 업로드 이미지(실행 시 생성, Git 제외)
└── .env.example       # 설정 예시 → .env 로 복사
```

## 처음 실행하기

```bash
# 1) DB 스키마 적용 (XAMPP MariaDB 실행 중이어야 함)
C:/xampp/mysql/bin/mysql.exe -u root < database/schema.sql
```

```bash
# 2) 설정 파일 복사 후 필요하면 수정
cp apps/php-api/.env.example apps/php-api/.env
```

```bash
# 3) 프로젝트와 보드 생성 — "관리자 초대 코드" 가 한 번 출력됩니다
C:/xampp/php/php.exe apps/php-api/bin/create-project.php "시연 프로젝트" "기획 보드" "개발 보드"
```

```bash
# 4) 개발 서버 실행 (프론트엔드 정적 파일 + /api, Apache 없이)
C:/xampp/php/php.exe -S 0.0.0.0:8080 -t apps/frontend/public apps/php-api/public/index.php
```

`http://localhost:8080/api/health` 가 `{"status":"ok","db":true}` 를 돌려주면 준비 완료입니다. 3)에서 받은 관리자 코드로 입장하면 보드 선택 화면의 **초대 코드 관리**에서 편집자·열람자 코드를 발급할 수 있습니다. 명령줄로 발급하려면:

```bash
C:/xampp/php/php.exe apps/php-api/bin/create-invite.php 1 editor 7
```

출력된 코드는 팀원에게 직접 전달하고 저장소·문서에 기록하지 않습니다.

### Apache(XAMPP)로 서비스할 때

`C:/xampp/apache/conf/httpd.conf` 끝에 다음을 추가하고 Apache를 재시작합니다. (`mod_rewrite` 는 XAMPP 기본 활성화)

```apache
Alias /api "C:/경로/TaskCanvas/apps/php-api/public"
<Directory "C:/경로/TaskCanvas/apps/php-api/public">
    AllowOverride All
    Require all granted
</Directory>
```

`.htaccess` 가 `/api/...` 요청을 `index.php` 로 넘깁니다. 저장소 전체를 `htdocs` 아래에 두지 말고 `public` 폴더만 연결하세요(`storage/` 는 웹에서 보이면 안 됩니다).

## 호출 규칙

- 상태 변경 요청(`POST`)은 **`X-TaskCanvas: 1`** 헤더가 필요합니다. 브라우저가 교차 사이트에서 이 헤더를 붙일 수 없으므로 CSRF 방어 역할을 합니다. 본문은 `Content-Type: application/json`(이미지 업로드만 `multipart/form-data`)입니다.
- 입장 성공 시 세션 토큰은 **HttpOnly·SameSite=Strict 쿠키(`tc_session`)** 로만 전달됩니다. 응답 JSON에는 토큰이 없습니다.
- 실시간 티켓(`POST /api/realtime-ticket`)은 60초 유효·일회용이며 DB에는 해시만 저장됩니다. Node.js 서버가 `realtime_tickets` 테이블로 검증합니다.
- 같은 프로젝트에 같은 표시 이름으로 다시 입장하면 기존 게스트와 역할을 재사용합니다(MVP 단순화).
- 입장 요청은 같은 IP 에서 10분에 20회(`RATE_LIMIT`, `RATE_WINDOW`)로 제한됩니다. 입장 요청 20번 중 1번꼴로 만료 세션·티켓·시도 기록을 정리합니다.

## 초대 코드 (관리자)

| 메서드 | 경로 | 내용 |
|---|---|---|
| GET | `/api/projects/{id}/invites` | 초대 목록. `{invite_id, role, expires_at, revoked_at, created_at, status}` — `status` 는 `active`·`expired`·`revoked`. 코드 원문과 해시는 반환하지 않음 |
| POST | `/api/projects/{id}/invites` | `{role, days}` 로 발급. `role` 은 admin·editor·viewer, `days` 는 1~30(기본 7). 응답 `{invite, code}` — **코드 원문은 이 응답에서만 한 번** |
| POST | `/api/invites/{id}/revoke` | 초대 취소. 이미 입장한 참여자는 유지되고 그 코드로 새로 입장만 막힘 |

세 경로 모두 해당 프로젝트의 관리자만 호출할 수 있습니다(그 외 403). 최초 관리자는 `create-project.php` 가 출력하는 관리자 코드로 지정합니다.

## 보드 관리

| 메서드 | 경로 | 내용 |
|---|---|---|
| POST | `/api/projects/{id}/boards` | 보드 생성 `{title}` — 편집자 이상 |
| POST | `/api/boards/{id}/rename` | 이름 변경 `{title}` — 편집자 이상 |
| POST | `/api/boards/{id}/delete` | 보드 삭제 — 관리자만. 보드의 객체·연결선·접속 티켓이 함께 지워지며 되돌릴 수 없음. 업로드 이미지 파일과 공유 업무 원본은 유지 |

이 API 는 소켓 알림을 보내지 않습니다. 그 보드를 열고 있는 참여자에게는 실시간 서버가 DB 를 주기적으로 확인해 알립니다(`apps/realtime/src/boards.js`).

## 이미지 업로드

```bash
curl -b cookies.txt -X POST http://localhost:8080/api/images -H "X-TaskCanvas: 1" -F project_id=1 -F file=@sample.png
```

- PNG/JPG/WEBP, 파일당 10MB(`MAX_UPLOAD_BYTES`). 내용 기반 MIME(`finfo`)과 `getimagesize` 가 모두 통과해야 하며, 위장 확장자는 `INVALID_FILE`(415), 크기 초과는 `FILE_TOO_LARGE`(413).
- 저장 위치는 `UPLOAD_DIR`(기본 `storage/uploads`, 웹 루트 밖), 파일명은 랜덤 32자. 응답에는 경로 대신 `/api/images/{id}` URL 만 포함.
- `GET /api/images/{id}` 는 같은 프로젝트 참여자만 조회할 수 있고 ETag/304 를 지원합니다.

## 시연 초기화

```bash
C:/xampp/php/php.exe apps/php-api/bin/reset-demo.php --dry-run
```

지워질 테이블별 행 수와 업로드 이미지 수만 보여 주고 아무것도 바꾸지 않습니다. 실제로 초기화하려면 `--dry-run` 을 빼고 실행한 뒤 확인 질문에 **DB 이름을 그대로 입력**합니다(`--yes` 는 질문 생략).

- TaskCanvas 테이블 12개를 모두 비우고(`TRUNCATE`), 업로드 폴더에서는 서버가 만든 이름 규칙(`<프로젝트 ID>/<32자 16진수>.png|jpg|webp`)에 맞는 파일만 지웁니다. 그 외 파일은 건드리지 않습니다.
- 끝나면 시연 프로젝트(보드 2개)와 관리자·편집자·열람자 초대 코드를 새로 만들어 한 번 출력합니다.
- **되돌릴 수 없습니다.** Windows 에서는 `scripts\reset-demo.bat` 로도 실행할 수 있습니다.
- `--seed` 를 함께 주면 새로 만든 보드에 아래 예시 내용을 채웁니다.

## 시연용 예시 보드

```bash
C:/xampp/php/php.exe apps/php-api/bin/seed-demo.php 1
```

프로젝트(여기서는 `project_id=1`)의 첫 번째 보드에 제목 글·펜 획 밑줄·색 메모 3장·흐름 메모 3장과 연결선·강조 타원·테두리 사각형, 그리고 공유 업무 3개(진행 중·할 일·완료)와 그 블럭을 넣습니다. 두 번째 보드가 비어 있으면 같은 업무를 가리키는 블럭을 하나 더 놓아, 한쪽에서 상태를 바꾸면 양쪽이 함께 바뀌는 것을 바로 보여 줄 수 있습니다.

- 실시간 서버가 저장하는 것과 같은 형식으로 DB 에 직접 넣습니다. 전부 들어가거나 전부 취소됩니다(트랜잭션).
- 첫 번째 보드에 객체가 하나라도 있으면 넣지 않습니다. `--force` 를 주면 기존 내용을 지우지 않고 그 위에 추가합니다.
- 보드를 열어 둔 참여자에게는 알림이 가지 않으므로 새로고침해야 보입니다. 시연 전에 미리 실행합니다.

## 사전 점검

```bash
C:/xampp/php/php.exe apps/php-api/bin/check-env.php
```

PHP 버전(8.0 이상), 확장(`pdo_mysql`·`fileinfo`·`mbstring`), php.ini 업로드 한도가 앱 한도(10MB)보다 큰지, `.env`, DB 연결과 테이블 12개, 업로드 폴더 쓰기 권한을 `[통과]`·`[주의]`·`[실패]` 로 출력합니다. 실패가 있으면 종료 코드 1 입니다. 실시간 서버·포트·방화벽까지 한 번에 보려면 저장소 루트의 `scripts\check-env.bat` 을 씁니다.

## 수동 테스트 예시

```bash
curl -c cookies.txt -X POST http://localhost:8080/api/guest/join -H "Content-Type: application/json" -H "X-TaskCanvas: 1" --data-binary @join.json
```

`join.json` 은 UTF-8 로 저장한 `{"display_name":"이름","invite_code":"발급받은코드"}` 입니다. (Windows 콘솔에서 `-d` 로 한글을 직접 넣으면 cp949 로 전송되어 JSON 오류가 납니다.)

```bash
curl -b cookies.txt http://localhost:8080/api/me
```

## 아직 없는 것

- 이미지 객체가 보드에서 모두 지워졌을 때 원본 파일을 정리하는 정책(미정 사항, 현재는 시연 초기화로만 정리)
- 초대 코드별 사용 횟수 제한(현재는 만료와 취소만)
