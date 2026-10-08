@echo off
@chcp 65001 >nul
REM TaskCanvas 사전 점검: 학교 PC 에서 처음 한 번 실행해 PHP·Node·DB·포트·방화벽·LAN 주소를 확인합니다.
REM   scripts\check-env.bat          저장소 어디서든 더블클릭 또는 명령줄로 실행
REM 서버를 띄운 뒤(scripts\start-dev.bat) 다시 실행하면 LAN 주소로 응답하는지도 확인합니다.
cd /d "%~dp0.."
set TC_FAIL=0

echo === TaskCanvas 사전 점검 ===
echo.

if exist "C:\xampp\php\php.exe" goto php_found
echo [실패] PHP — C:\xampp\php\php.exe 가 없습니다. XAMPP 를 설치하세요.
set TC_FAIL=1
goto node_check

:php_found
if not exist "apps\php-api\.env" copy "apps\php-api\.env.example" "apps\php-api\.env" >nul
"C:\xampp\php\php.exe" apps\php-api\bin\check-env.php
if errorlevel 1 set TC_FAIL=1

:node_check
echo.
where node >nul 2>nul
if not errorlevel 1 goto node_found
echo [실패] Node.js — node 명령을 찾지 못했습니다. Node.js LTS 를 설치한 뒤 창을 새로 여세요.
set TC_FAIL=1
goto summary

:node_found
if not exist "apps\realtime\.env" copy "apps\realtime\.env.example" "apps\realtime\.env" >nul
node apps\realtime\scripts\check-env.js
if errorlevel 1 set TC_FAIL=1

:summary
echo.
if "%TC_FAIL%"=="0" echo 결과: 실패 항목이 없습니다. [주의] 항목이 있으면 내용을 읽어 보세요.
if "%TC_FAIL%"=="1" echo 결과: [실패] 항목을 먼저 해결하세요. 자세한 방법은 docs\15-deployment-school-pc.md 에 있습니다.
echo.
pause
exit /b %TC_FAIL%
