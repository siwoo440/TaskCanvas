# 학교 PC 배포·시연 가이드

서버 PC 1대(XAMPP + Node.js)와 접속 PC 3대로 시연하는 절차입니다. 모든 명령은 저장소 루트에서 실행합니다.

---

## 1. 첫날 확인 목록

| 항목 | 확인 방법 | 기준 |
|---|---|---|
| XAMPP 설치 | `C:\xampp\php\php.exe -v` | PHP 8.x (`pdo_mysql`, `fileinfo` 포함) |
| Node.js 설치 | `node -v` | 18 이상 (24 LTS 확인됨) |
| MariaDB 실행 | XAMPP Control Panel 의 MySQL Start | 포트 3306 |
| 방화벽 | 아래 2절 명령 | 8080(또는 80), 3001 인바운드 허용 |
| LAN 연결 | 접속 PC 에서 `ping <서버 IP>` | 응답 있음 (학교 LAN 이 PC 간 통신을 막으면 핫스팟 등 대안 필요) |
| 외부 영상 | 접속 PC 브라우저에서 youtube.com 열기 | 차단되어 있으면 영상 시연은 생략 |

서버 PC 의 IP 는 `ipconfig` 의 IPv4 주소입니다. 브라우저의 `localhost` 는 **각 PC 자신**이므로 접속 PC 는 반드시 서버 IP 로 접속합니다.

---

## 2. 서버 PC 준비

### 2-1. DB

```bash
C:/xampp/mysql/bin/mysql.exe -u root < database/schema.sql
```

### 2-2. 설정 파일

`apps/php-api/.env.example` → `apps/php-api/.env`, `apps/realtime/.env.example` → `apps/realtime/.env` 로 복사합니다. 기본값(root, 비밀번호 없음, 3306)은 XAMPP 기본 설치와 같습니다. 시연 후 DB 비밀번호를 설정했다면 두 파일의 `DB_PASS` 를 같이 바꿉니다.

### 2-3. 방화벽 (관리자 PowerShell)

```powershell
New-NetFirewallRule -DisplayName "TaskCanvas PHP 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
New-NetFirewallRule -DisplayName "TaskCanvas Realtime 3001" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow
```

학교 PC 에서 관리자 권한이 없으면 Windows 보안 → 방화벽 → 앱 허용에서 `node.exe`, `php.exe` 를 허용하거나, 담당 교사에게 요청합니다.

### 2-4. 프로젝트·초대 코드

```bash
C:/xampp/php/php.exe apps/php-api/bin/create-project.php "시연 프로젝트" "기획 보드" "개발 보드"
```

`관리자 초대 코드` 가 한 번 출력됩니다. 이 코드로 입장한 사람이 관리자가 되고, 보드 선택 화면 아래 **초대 코드 관리**에서 역할(편집자·열람자)과 유효 기간을 골라 코드를 발급·취소합니다. 발급 직후에만 코드와 초대 링크가 표시되므로 바로 전달합니다. 열람자 시연용 코드도 하나 만들어 둡니다.

초대 링크는 `http://<서버 IP>:8080/#code=<초대 코드>` 형식입니다. 링크를 열면 코드가 입력란에 채워지고 주소창에서는 바로 지워지므로 이름만 입력하면 됩니다. 서버 PC 에서 `localhost` 로 접속해 발급한 링크는 다른 PC 에 보내기 전에 `localhost` 를 서버 IP 로 바꿉니다.

명령줄로 발급하려면:

```bash
C:/xampp/php/php.exe apps/php-api/bin/create-invite.php 1 editor 7
```

초대 코드는 팀원에게 직접 전달하고 저장소·문서에 기록하지 않습니다.

### 2-5. 시연 직전 초기화 (선택)

개발·테스트 중 쌓인 데이터와 업로드 이미지를 지우고 깨끗한 시연 프로젝트로 시작하려면:

```bash
scripts\reset-demo.bat --dry-run
```

지워질 내용만 보여 줍니다. 확인했으면 `--dry-run` 없이 다시 실행하고 DB 이름을 입력합니다. **모든 프로젝트·보드·객체·업로드 이미지가 지워지며 되돌릴 수 없습니다.** 끝나면 관리자·편집자·열람자 초대 코드가 새로 출력됩니다. 2-4 의 `create-project.php` 는 따로 실행하지 않아도 됩니다.

---

## 3. 실행 방법

### 방법 A — PHP 내장 서버 (권장, 설정 변경 없음)

```bash
scripts\start-dev.bat
```

MariaDB 가 꺼져 있으면 켜고, 실시간 서버(3001)와 PHP 서버(8080)를 각각 창으로 띄웁니다. 접속 PC 는 `http://<서버 IP>:8080`.

### 방법 B — Apache (XAMPP 기본 80 포트)

1. `apps/frontend/public` 의 내용을 `C:\xampp\htdocs\` 로 복사(기존 `index.php` 는 삭제 또는 백업).
2. `C:\xampp\apache\conf\httpd.conf` 끝에 추가 후 Apache 재시작:

```apache
Alias /api "C:/경로/TaskCanvas/apps/php-api/public"
<Directory "C:/경로/TaskCanvas/apps/php-api/public">
    AllowOverride All
    Require all granted
</Directory>
```

3. 실시간 서버는 그대로 `node apps/realtime/src/server.js`. 접속은 `http://<서버 IP>/`.

프론트엔드의 `js/config.js` 는 접속한 호스트의 3001 포트로 실시간 서버를 찾으므로 두 방법 모두 추가 설정이 없습니다.

---

## 4. 시연 전 점검 (서버 PC)

```bash
cd apps/realtime && npm run test:acceptance
```

PHP 8081·실시간 3002 포트로 임시 서버를 띄워 AC01~AC14, AC16~AC21 을 자동 검사하고 표를 출력합니다. 실행 중인 시연 서버에는 영향이 없지만 테스트용 프로젝트("AC Project …")가 DB 에 남으므로, 점검 뒤 2-5 의 초기화를 실행해 시연용 상태로 되돌립니다. (점검 → 초기화 → 시연 순서)

---

## 5. 시연 순서 (docs/11 최종 시연 흐름)

1. 서버 PC 에서 `scripts\start-dev.bat` 실행, `http://localhost:8080/api/health` 가 `"db":true` 인지 확인.
2. PC 4대가 소개 페이지의 "입장하기"(또는 초대 링크)로 입장 → 작업실에서 같은 보드 열기 → 상단 참여자 4명 확인.
3. A 가 펜으로 그리는 동안 다른 PC 에서 선이 따라 그려지는지 확인.
4. B 가 도형을 선택해 이동, 그 사이 A 가 같은 도형을 클릭하면 "B 님이 편집 중" 안내 확인.
5. C 가 PNG 를 드래그해 올리고, D 가 ▶ 버튼으로 YouTube URL 추가.
6. 모두 새로고침 → 그대로 복원되는지, 다른 보드로 전환하면 내용이 섞이지 않는지 확인.
7. 열람자 코드로 입장한 PC 는 도구가 비활성화되고 이동만 되는지 확인.

---

## 6. 자주 겪는 문제

| 증상 | 원인·조치 |
|---|---|
| 접속 PC 에서 페이지가 안 열림 | 방화벽 8080 미허용, 서버 IP 오타, LAN 격리. 서버 PC 에서 `http://localhost:8080` 은 되는지 먼저 확인 |
| 페이지는 열리는데 `연결 끊김` | 3001 포트 미허용 또는 실시간 서버 창이 닫힘. 접속 PC 에서 `http://<서버 IP>:3001/health` 확인 |
| `"db":false` | MariaDB 가 꺼져 있음. XAMPP Control Panel 에서 MySQL Start |
| 초대 코드 거부 | 만료(기본 7일)·취소·오타. 관리자 화면의 초대 코드 관리 또는 `create-invite.php` 로 재발급 |
| 이미지 업로드 실패 | 10MB 초과 또는 PNG/JPG/WEBP 가 아님. `apps/php-api/storage/uploads` 쓰기 권한 확인 |
| 영상이 검게만 보임 | 학교 네트워크에서 YouTube 차단. 영상 시연 생략 |
| 입장 시도가 많다는 안내(429) | 같은 PC 에서 10분에 20회 초과. 잠시 후 재시도 |
