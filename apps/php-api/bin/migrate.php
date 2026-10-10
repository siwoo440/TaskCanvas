<?php
// DB 스키마 보정 CLI: 예전에 만든 DB 에 나중에 더한 표와 바뀐 컬럼(추가·NULL 허용)을 반영한다. 여러 번 실행해도 안전하고 데이터는 지우지 않는다
// 사용법: php bin/migrate.php   (scripts\start-dev.bat 가 서버를 띄우기 전에 자동으로 실행)
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php'; // 공통 초기화

if (PHP_SAPI !== 'cli')
{
    exit("CLI 전용 스크립트입니다.\n"); // 웹 실행 차단
}

try
{
    $applied = Schema::upgrade(); // 반영되지 않은 변경 적용
}
catch (Throwable $e)
{
    fwrite(STDERR, 'DB 스키마를 보정하지 못했습니다: ' . $e->getMessage() . "\n"); // DB 꺼짐·스키마 미적용 등
    exit(1); // 실패
}
echo $applied === []
    ? "DB 스키마: 최신 상태입니다.\n"
    : 'DB 스키마: 변경 ' . count($applied) . '건을 반영했습니다 (' . implode(', ', $applied) . ").\n"; // 결과
