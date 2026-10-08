# PHP API (1단계 구현)

게스트 입장, 세션, 보드 목록·생성, 저장 스냅샷 조회, Socket.IO 접속 티켓 발급을 담당하는 순수 PHP(프레임워크·Composer 없음) API입니다. 규격은 [docs/07-http-api.md](../../docs/07-http-api.md)를 따릅니다.

## 확인된 환경

| 항목 | 값 |
|---|---|
| PHP | XAMPP 8.2 (`pdo_mysql`, `fileinfo` 확장 필요) |
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
│   ├── Env.php        # .env 로더
│   ├── Database.php   # PDO 연결, 바인딩 쿼리 헬퍼
│   ├── Request.php / Response.php / Router.php
│   ├── Auth.php       # 세션 쿠키, 역할 검사, CSRF 헤더 검사
│   ├── ApiException.php
│   └── controllers/   # Guest / Board / Ticket / Image / System
├── bin/
│   ├── create-project.php  # 프로젝트 + 보드 생성(개발용)
│   └── create-invite.php   # 초대 코드 발급(원문은 화면에만 출력)
├── storage/uploads/   # 업로드 이미지(실행 시 생성, Git 제외)
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
# 3) 프로젝트와 보드 생성
C:/xampp/php/php.exe apps/php-api/bin/create-project.php "시연 프로젝트" "기획 보드" "개발 보드"
```

```bash
# 4) 초대 코드 발급 (출력된 코드는 팀원에게 직접 전달, 저장소에 기록 금지)
C:/xampp/php/php.exe apps/php-api/bin/create-invite.php 1 editor 7
```

```bash
# 5) 개발 서버 실행 (Apache 없이)
C:/xampp/php/php.exe -S 0.0.0.0:8080 -t apps/php-api/public apps/php-api/public/index.php
```

`http://localhost:8080/api/health` 가 `{"status":"ok","db":true}` 를 돌려주면 준비 완료입니다.

### Apache(XAMPP)로 서비스할 때

`C:/xampp/apache/conf/httpd.conf` 끝에 다음을 추가하고 Apache를 재시작합니다. (`mod_rewrite` 는 XAMPP 기본 활성화)

```apache
Alias /api "C:/경로/TaskCanvas/apps/php-api/public"
<Directory "C:/경로/TaskCanvas/apps/php-api/public">
    AllowOverride All
    Require all granted
</Directory>
```

`.htaccess` 가 `/api/...` 요청을 `index.php` 로 넘깁니다.

## 호출 규칙

- 상태 변경 요청(`POST`)은 `Content-Type: application/json` 과 **`X-TaskCanvas: 1`** 헤더가 필요합니다. 브라우저가 교차 사이트에서 이 헤더를 붙일 수 없으므로 CSRF 방어 역할을 합니다.
- 입장 성공 시 세션 토큰은 **HttpOnly·SameSite=Strict 쿠키(`tc_session`)** 로만 전달됩니다. 응답 JSON에는 토큰이 없습니다.
- 실시간 티켓(`POST /api/realtime-ticket`)은 60초 유효, DB에는 해시만 저장되며 Node.js 서버가 `realtime_tickets` 테이블로 검증합니다(2단계).
- 같은 프로젝트에 같은 표시 이름으로 다시 입장하면 기존 게스트와 역할을 재사용합니다(MVP 단순화).

## 수동 테스트 예시

```bash
curl -c cookies.txt -X POST http://localhost:8080/api/guest/join -H "Content-Type: application/json" -H "X-TaskCanvas: 1" --data-binary @join.json
```

`join.json` 은 UTF-8 로 저장한 `{"display_name":"이름","invite_code":"발급받은코드"}` 입니다. (Windows 콘솔에서 `-d` 로 한글을 직접 넣으면 cp949 로 전송되어 JSON 오류가 납니다.)

```bash
curl -b cookies.txt http://localhost:8080/api/me
```

## 이미지 업로드 (5단계)

```bash
curl -b cookies.txt -X POST http://localhost:8080/api/images -H "X-TaskCanvas: 1" -F project_id=1 -F file=@sample.png
```

- PNG/JPG/WEBP, 파일당 10MB(`MAX_UPLOAD_BYTES`). 내용 기반 MIME(`finfo`)과 `getimagesize` 가 모두 통과해야 하며, 위장 확장자는 `INVALID_FILE`(415), 크기 초과는 `FILE_TOO_LARGE`(413).
- 저장 위치는 `UPLOAD_DIR`(기본 `storage/uploads`, 웹 루트 밖), 파일명은 랜덤 32자. 응답에는 경로 대신 `/api/images/{id}` URL 만 포함.
- `GET /api/images/{id}` 는 같은 프로젝트 참여자만 조회할 수 있고 ETag/304 를 지원합니다.

## 아직 없는 것 (다음 단계)

- `tasks` 관련 API — P1
- 이미지 참조가 사라졌을 때의 파일 정리 정책(미정 사항)
- 세션·티켓 만료 행 정리 작업(현재 티켓만 1시간 지난 것을 발급 시 정리)
