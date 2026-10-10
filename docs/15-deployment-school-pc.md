# 학교 PC 배포·시연 가이드

서버 PC 1대(XAMPP + Node.js)와 접속 PC 3대로 시연하는 절차입니다. 모든 명령은 저장소 루트에서 실행합니다.

---

## 1. 첫날 확인 목록

먼저 아래 한 줄로 서버 PC 를 점검합니다. PHP 버전·확장·업로드 한도, Node 버전·패키지, DB 연결·스키마, 두 포트, LAN 주소, 방화벽 규칙, 외부 영상 접속을 `[통과]`·`[주의]`·`[실패]` 로 보여 주고, 다른 PC 에서 열어 볼 주소를 출력합니다.

```bash
scripts\check-env.bat
```

`[실패]` 가 없어도 이 PC 안에서 볼 수 있는 것만 확인한 것입니다. 다른 PC 에서 실제로 닿는지는 서버를 띄운 뒤 각 접속 PC 의 브라우저에서 아래 주소를 열어 확인합니다.

```
http://<서버 IP>:8080/check.html
```

웹 서버, 실시간 서버 주소(3001), 웹소켓 연결, 왕복 시간, 외부 영상 접속을 표로 보여 줍니다. 입장하지 않아도 열리고 아무것도 저장하지 않습니다. 손으로 확인할 때의 기준은 아래 표와 같습니다.

| 항목 | 확인 방법 | 기준 |
|---|---|---|
| XAMPP 설치 | `C:\xampp\php\php.exe -v` | PHP 8.x (`pdo_mysql`, `fileinfo`, `mbstring` 포함) |
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

예전에 만든 DB 를 그대로 쓰는 경우, 나중에 바뀐 컬럼(초대 코드의 인원 제한, 작업실용 접속 티켓)은 `scripts\start-dev.bat` 이 서버를 띄우기 전에 자동으로 반영합니다(`apps/php-api/bin/migrate.php`, 기존 데이터는 그대로). `scripts\check-env.bat` 도 예전 스키마이면 `[실패]` 로 알려 줍니다.

### 2-2. 설정 파일

`apps/php-api/.env.example` → `apps/php-api/.env`, `apps/realtime/.env.example` → `apps/realtime/.env` 로 복사합니다. 기본값(root, 비밀번호 없음, 3306)은 XAMPP 기본 설치와 같습니다. 시연 후 DB 비밀번호를 설정했다면 두 파일의 `DB_PASS` 를 같이 바꿉니다. 접속한 사람이 소개 화면에서 작업실을 직접 만들지 못하게 하려면 `apps/php-api/.env` 에 `ALLOW_WORKSPACE_CREATE=0` 을 적습니다(기본은 허용).

`apps/realtime/.env` 의 `CORS_ORIGIN` 은 `auto`(기본)로 둡니다. 실시간 서버와 같은 주소(같은 IP)에서 열린 화면만 붙을 수 있고, 서버 IP 가 바뀌어도 고칠 필요가 없습니다.

### 2-3. 방화벽 (관리자 PowerShell)

```powershell
New-NetFirewallRule -DisplayName "TaskCanvas PHP 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
New-NetFirewallRule -DisplayName "TaskCanvas Realtime 3001" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow
```

학교 PC 에서 관리자 권한이 없으면 Windows 보안 → 방화벽 → 앱 허용에서 `node.exe`, `php.exe` 를 허용하거나, 담당 교사에게 요청합니다.

규칙이 들어갔는지는 `scripts\check-env.bat` 의 방화벽 줄로 확인합니다. 서버를 처음 띄울 때 뜨는 방화벽 알림에서 "취소"를 누른 적이 있으면 차단 규칙이 남아 허용 규칙보다 우선합니다. 이 경우도 `[실패]` 로 알려 줍니다.

### 2-4. 프로젝트·초대 코드

```bash
C:/xampp/php/php.exe apps/php-api/bin/create-project.php "시연 프로젝트" "기획 보드" "개발 보드"
```

`관리자 초대 코드` 가 한 번 출력됩니다. 이 코드로 입장한 사람이 관리자가 되고, 보드 선택 화면 아래 **초대 코드 관리**에서 역할(편집자·열람자)과 유효 기간을 골라 코드를 발급·취소합니다. 발급 직후에만 코드와 초대 링크가 표시되므로 바로 전달합니다. 인원 제한을 적으면 그 수만큼만 새로 입장할 수 있고, 비우면 제한이 없습니다. 열람자 시연용 코드도 하나 만들어 둡니다.

초대 링크는 `http://<서버 IP>:8080/#code=<초대 코드>` 형식입니다. 링크를 열면 코드가 입력란에 채워지고 주소창에서는 바로 지워지므로 이름만 입력하면 됩니다. 서버 PC 에서 `localhost` 로 접속해 발급한 링크는 다른 PC 에 보내기 전에 `localhost` 를 서버 IP 로 바꿉니다.

명령줄로 발급하려면:

```bash
C:/xampp/php/php.exe apps/php-api/bin/create-invite.php 1 editor 7
```

초대 코드는 팀원에게 직접 전달하고 저장소·문서에 기록하지 않습니다.

명령줄을 쓰지 않고 화면에서 시작할 수도 있습니다. 소개 페이지의 **새 작업실 만들기**에서 이름과 작업실 이름을 넣으면 그 사람이 관리자인 작업실이 첫 보드와 함께 만들어집니다. 만든 직후 보이는 **내 코드**는 그 사람이 다시 들어올 때 쓰는 재입장 전용 코드이므로 팀원에게 주지 말고, 팀원용 코드는 초대 코드 관리에서 따로 발급합니다. 시연에는 예시 내용이 채워진 프로젝트(2-5)를 쓰는 편이 준비가 쉽습니다.

### 2-5. 시연 직전 초기화 (선택)

개발·테스트 중 쌓인 데이터와 업로드 이미지를 지우고 깨끗한 시연 프로젝트로 시작하려면:

```bash
scripts\reset-demo.bat --dry-run
```

지워질 내용만 보여 줍니다. 확인했으면 `--dry-run` 없이 다시 실행하고 DB 이름을 입력합니다. **모든 프로젝트·보드·객체·업로드 이미지가 지워지며 되돌릴 수 없습니다.** 끝나면 관리자·편집자·열람자 초대 코드가 새로 출력됩니다. 2-4 의 `create-project.php` 는 따로 실행하지 않아도 됩니다.

빈 보드 대신 예시가 채워진 보드로 시작하려면 `--seed` 를 붙입니다.

```bash
scripts\reset-demo.bat --seed
```

"기획 보드"에 메모·도형·펜 획·연결선과 공유 업무 블럭 3개가, "개발 보드"에 같은 업무를 가리키는 블럭 1개가 들어갑니다. 보드에 놓지 않은 업무가 하나 더 있어 작업실의 업무 현황판에는 카드 4장이 보이고, 그중 두 장에는 마감 임박·지남 표시가 붙습니다. 초기화 없이 이미 있는 프로젝트의 빈 보드에만 채우려면:

```bash
C:/xampp/php/php.exe apps/php-api/bin/seed-demo.php 1
```

객체가 이미 있는 보드에는 넣지 않습니다(`--force` 를 주면 기존 내용 위에 추가).

### 2-6. 업로드 정리 (선택)

보드에서 이미지를 지워도 파일은 서버에 남습니다. 오래 쓰는 서버라면 아무도 편집하지 않을 때 정리합니다. 시연만 한다면 2-5 의 초기화로 충분합니다.

```bash
C:/xampp/php/php.exe apps/php-api/bin/clean-uploads.php
```

어느 보드에서도 쓰지 않고 올린 지 24시간이 지난 이미지를 보여 주기만 합니다. `--apply` 를 붙이면 실제로 지우며 되돌릴 수 없습니다. 최근 30분 안에 보드 접속 기록이 있으면 멈춥니다.

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

PHP 8081·실시간 3002 포트로 임시 서버를 띄워 AC01~AC14, AC16~AC23 과 보안 점검 SEC01(접속 출처 제한), 운영 점검 OPS01(업로드 정리)을 자동 검사하고 표를 출력합니다. 실행 중인 시연 서버에는 영향이 없지만 테스트용 프로젝트("AC Project …")가 DB 에 남으므로, 점검 뒤 2-5 의 초기화를 실행해 시연용 상태로 되돌립니다. (점검 → 초기화 → 시연 순서)

이어서 시연 대본의 순서를 브라우저 네 개로 그대로 돌려 봅니다(Chrome 필요, 약 30초).

```bash
npm run rehearsal
```

PHP 8083·실시간 3004 포트의 임시 서버에서 접속 점검 화면, 입장부터 열람자 장면까지 10개 장면, 화면 사이 전달 지연을 확인합니다. 네 화면이 모두 서버 PC 안에서 돌기 때문에 다른 PC 의 접속과 LAN 구간은 확인하지 못합니다. "리허설 프로젝트"가 DB 에 남으므로 이것도 2-5 의 초기화 전에 실행합니다.

---

## 5. 시연 순서 (docs/11 최종 시연 흐름)

누가 어느 PC 에서 무엇을 누르는지까지 적은 진행표는 [시연 대본](16-demo-script.md)에 있습니다. 아래는 요약입니다.

1. 서버 PC 에서 `scripts\start-dev.bat` 실행, `http://localhost:8080/api/health` 가 `"db":true` 인지 확인.
2. PC 4대가 소개 페이지의 "입장하기"(또는 초대 링크)로 입장 → 작업실에서 같은 보드 열기 → 상단 참여자 4명 확인.
3. A 가 펜으로 그리는 동안 다른 PC 에서 선이 따라 그려지는지 확인.
4. B 가 도형을 선택해 이동, 그 사이 A 가 같은 도형을 클릭하면 "B 님이 편집 중" 안내 확인.
5. C 가 PNG 를 빈 곳에 드래그해 올리고, D 가 ▶ 버튼으로 YouTube URL 추가(영상은 화면 가운데에 생기므로 D 는 먼저 빈 곳으로 화면을 옮김).
6. 모두 새로고침 → 보던 보드가 그대로 다시 열리는지, 다른 보드로 전환하면 내용이 섞이지 않는지 확인.
7. 열람자 코드로 입장한 PC 는 도구가 비활성화되고 이동만 되는지 확인.

---

## 6. 자주 겪는 문제

| 증상 | 원인·조치 |
|---|---|
| 접속 PC 에서 페이지가 안 열림 | 방화벽 8080 미허용, 서버 IP 오타, LAN 격리. 서버 PC 에서 `http://localhost:8080` 은 되는지 먼저 확인 |
| 페이지는 열리는데 `연결 끊김` | 3001 포트 미허용 또는 실시간 서버 창이 닫힘. 접속 PC 에서 `http://<서버 IP>:3001/health` 확인 |
| 보드를 열면 "실시간 서버에 연결하지 못했습니다" 안내 | 그 PC 에서 `http://<서버 IP>:8080/check.html` 을 열면 어느 단계에서 막히는지 나옴. 위와 같은 원인이거나 접속 출처가 허용되지 않음. 실시간 서버 창의 시작 줄에 `접속 출처 목록 …` 이 보이면 `apps/realtime/.env` 의 `CORS_ORIGIN` 을 `auto` 로 되돌리고 서버를 다시 띄움 |
| `"db":false` | MariaDB 가 꺼져 있음. XAMPP Control Panel 에서 MySQL Start |
| 초대 코드 거부 | 만료(기본 7일)·취소·오타. 관리자 화면의 초대 코드 관리 또는 `create-invite.php` 로 재발급 |
| "더 높은 권한의 참여자가 쓰고 있습니다" 안내 | 그 이름은 이미 관리자나 편집자가 쓰는 이름입니다. 다른 이름으로 입장하거나, 본인이라면 그 권한의 코드를 씁니다 |
| 직접 만든 작업실에 다시 못 들어감 | 이름과 내 코드가 모두 맞아야 합니다. 코드를 잃어버렸으면 서버 PC 에서 `create-invite.php <project_id> admin 30 0` 으로 재입장 전용 코드를 새로 발급 |
| "저장 실패: 요청이 너무 잦습니다" 안내 | 한 화면이 짧은 시간에 저장 요청을 300개 넘게 보냈을 때 뜹니다(객체를 150개 넘게 한꺼번에 옮기는 경우 등). 잠시 뒤 다시 하면 됩니다. 계속 뜨면 `apps/realtime/.env` 의 `RATE_SAVE_BURST`·`RATE_SAVE_PER_SEC` 를 올리고 실시간 서버를 다시 띄웁니다 |
| 이미지 업로드 실패 | 10MB 초과 또는 PNG/JPG/WEBP 가 아님. `apps/php-api/storage/uploads` 쓰기 권한 확인 |
| 영상이 검게만 보임 | 학교 네트워크에서 YouTube 차단. 영상 시연 생략 |
| 입장 시도가 많다는 안내(429) | 같은 PC 에서 10분에 20회 초과. 잠시 후 재시도 |
