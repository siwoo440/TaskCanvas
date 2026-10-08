@echo off
@chcp 65001 >nul
REM TaskCanvas 시연 초기화: DB 데이터와 업로드 이미지를 지우고 시연 프로젝트·초대 코드를 새로 만듭니다.
REM   scripts\reset-demo.bat --dry-run   지울 대상만 확인
REM   scripts\reset-demo.bat             확인 질문(DB 이름 입력) 후 초기화
REM   scripts\reset-demo.bat --seed      초기화 후 보드에 시연용 예시 내용까지 채움
cd /d "%~dp0.."

if not exist "apps\php-api\.env" copy "apps\php-api\.env.example" "apps\php-api\.env" >nul
"C:\xampp\php\php.exe" apps\php-api\bin\reset-demo.php %*
echo.
pause
