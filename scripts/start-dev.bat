@echo off
@chcp 65001 >nul
REM TaskCanvas 개발 서버 한 번에 실행 (Windows + XAMPP). 저장소 루트의 scripts\ 폴더에서 실행합니다.
cd /d "%~dp0.."

if not exist "apps\php-api\.env" copy "apps\php-api\.env.example" "apps\php-api\.env" >nul
if not exist "apps\realtime\.env" copy "apps\realtime\.env.example" "apps\realtime\.env" >nul
if not exist "apps\realtime\node_modules" (
    echo [1/3] 실시간 서버 패키지 설치 중...
    pushd apps\realtime
    call npm install
    popd
)

tasklist /FI "IMAGENAME eq mysqld.exe" | find /I "mysqld.exe" >nul
if errorlevel 1 (
    echo [2/3] MariaDB 시작
    start "TaskCanvas MariaDB" /MIN "C:\xampp\mysql\bin\mysqld.exe" --defaults-file=C:\xampp\mysql\bin\my.ini --standalone
    timeout /t 3 >nul
) else (
    echo [2/3] MariaDB 이미 실행 중
)

echo [3/3] 실시간 서버(3001)와 PHP 서버(8080) 시작
start "TaskCanvas Realtime :3001" cmd /k "cd /d apps\realtime && node src\server.js"
start "TaskCanvas PHP :8080" cmd /k "C:\xampp\php\php.exe -S 0.0.0.0:8080 -t apps\frontend\public apps\php-api\public\index.php"

echo.
echo 이 PC:     http://localhost:8080
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do echo 다른 PC:   http://%%a:8080  (방화벽에서 8080, 3001 허용 필요)
echo 초대 코드:  C:\xampp\php\php.exe apps\php-api\bin\create-invite.php ^<project_id^> editor
echo.
pause
