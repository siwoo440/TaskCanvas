<?php
// 공통 초기화: 클래스 로드, 환경 설정, 오류 처리
declare(strict_types=1);

spl_autoload_register(static function (string $class): void
{
    $candidates = [ // 클래스 파일 후보 경로
        __DIR__ . '/' . $class . '.php',
        __DIR__ . '/controllers/' . $class . '.php',
    ];
    foreach ($candidates as $path)
    {
        if (is_file($path))
        {
            require $path; // 클래스 파일 로드
            return;
        }
    }
}); // 단순 오토로더 등록

Env::load(dirname(__DIR__) . '/.env'); // .env 파일 로드(없으면 기본값 사용)

date_default_timezone_set('Asia/Seoul'); // 서버 시간대 고정
header_remove('X-Powered-By'); // PHP 버전 노출 제거

set_exception_handler(static function (Throwable $e): void
{
    if ($e instanceof ApiException)
    {
        Response::error($e->getCode() ?: 400, $e->errorCode, $e->getMessage()); // 정의된 API 오류 응답
        return;
    }
    error_log((string) $e); // 예상치 못한 오류 로그 기록
    $detail = Env::bool('APP_DEBUG') ? $e->getMessage() : '서버 내부 오류가 발생했습니다.'; // 디버그 여부에 따른 메시지
    Response::error(500, 'INTERNAL_ERROR', $detail); // 500 응답
}); // 전역 예외 처리기 등록

set_error_handler(static function (int $severity, string $message, string $file, int $line): bool
{
    if (!(error_reporting() & $severity))
    {
        return false; // @ 연산자로 억제된 경고는 무시
    }
    throw new ErrorException($message, 0, $severity, $file, $line); // PHP 경고를 예외로 승격
}); // 전역 오류 처리기 등록
