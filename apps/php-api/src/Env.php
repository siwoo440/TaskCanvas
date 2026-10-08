<?php
// .env 파일 로더와 설정 접근자
declare(strict_types=1);

final class Env
{
    private static array $values = []; // 로드된 설정 값

    private const DEFAULTS = [ // .env 가 없을 때의 기본값
        'DB_HOST' => '127.0.0.1',
        'DB_PORT' => '3306',
        'DB_NAME' => 'taskcanvas',
        'DB_USER' => 'root',
        'DB_PASS' => '',
        'SESSION_COOKIE' => 'tc_session',
        'SESSION_TTL' => '43200',
        'TICKET_TTL' => '60',
        'RATE_LIMIT' => '20',
        'RATE_WINDOW' => '600',
        'COOKIE_SECURE' => '0',
        'APP_DEBUG' => '0',
        'UPLOAD_DIR' => 'storage/uploads',
        'MAX_UPLOAD_BYTES' => '10485760',
    ];

    public static function load(string $path): void
    {
        self::$values = self::DEFAULTS; // 기본값 적용
        if (!is_file($path))
        {
            return;
        }
        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES); // 파일 줄 단위 읽기
        foreach ($lines as $line)
        {
            $line = trim($line); // 공백 제거
            if ($line === '' || $line[0] === '#' || !str_contains($line, '='))
            {
                continue; // 주석·빈 줄·형식 오류 건너뜀
            }
            [$key, $value] = explode('=', $line, 2); // 키와 값 분리
            self::$values[trim($key)] = trim($value, " \t\"'"); // 따옴표 제거 후 저장
        }
    }

    public static function get(string $key, string $default = ''): string
    {
        return self::$values[$key] ?? $default; // 문자열 설정 조회
    }

    public static function int(string $key, int $default = 0): int
    {
        return (int) (self::$values[$key] ?? $default); // 정수 설정 조회
    }

    public static function bool(string $key): bool
    {
        return in_array(strtolower(self::get($key, '0')), ['1', 'true', 'yes', 'on'], true); // 불리언 설정 조회
    }
}
