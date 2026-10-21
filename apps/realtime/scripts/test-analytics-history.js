'use strict'; // 엄격한 검사
const path = require('path'); // 실제 검사 경로
const { spawnSync } = require('child_process'); // PHP 실제 서비스 검사
const php = process.env.PHP_BIN || (process.platform === 'win32' ? 'C:/xampp/php/php.exe' : 'php'); // PHP 실행 파일
const result = spawnSync(php, [path.resolve(__dirname, '../../php-api/tests/analytics-completion.php'), 'history'], { stdio: 'inherit' }); // 격리 DB·이력·필터·보드 범위
if (result.error) // 실행 실패
{ // 오류 보고
    console.error(result.error.message); // 실패 원인
} // 오류 보고 끝
process.exitCode = result.status ?? 1; // 실제 검사 종료 코드
