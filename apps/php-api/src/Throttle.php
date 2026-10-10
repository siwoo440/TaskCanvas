<?php
// 입장·작업실 만들기 요청 제한: 같은 IP 의 최근 시도 횟수를 세어 너무 잦으면 막는다
declare(strict_types=1);

final class Throttle
{
    public static function check(string $ip): void
    {
        $row = Database::one(
            'SELECT COUNT(*) AS n FROM join_attempts WHERE client_ip = ? AND attempted_at > DATE_SUB(NOW(), INTERVAL ? SECOND)',
            [$ip, Env::int('RATE_WINDOW', 600)]
        ); // 최근 시도 횟수(성공·실패 모두)
        if ((int) $row['n'] >= Env::int('RATE_LIMIT', 20))
        {
            throw new ApiException(429, 'RATE_LIMITED', '입장 시도가 너무 많습니다. 잠시 후 다시 시도하세요.'); // 제한 초과
        }
    }

    public static function record(string $ip, bool $ok): void
    {
        Database::run('INSERT INTO join_attempts (client_ip, succeeded) VALUES (?, ?)', [$ip, $ok ? 1 : 0]); // 시도 기록
    }
}
