<?php
// JSON 응답 출력기
declare(strict_types=1);

final class Response
{
    public static function json(int $status, array $body): void
    {
        http_response_code($status); // 상태 코드 설정
        header('Content-Type: application/json; charset=utf-8'); // JSON 응답 헤더
        header('Cache-Control: no-store'); // 응답 캐시 금지
        echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); // 본문 출력
    }

    public static function ok(array $body, int $status = 200): void
    {
        self::json($status, $body); // 성공 응답
    }

    public static function error(int $status, string $code, string $message): void
    {
        self::json($status, ['error' => ['code' => $code, 'message' => $message]]); // 오류 응답 계약 형식
    }
}
