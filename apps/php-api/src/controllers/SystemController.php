<?php
// 서버 상태 확인
declare(strict_types=1);

final class SystemController
{
    public function health(Request $request): void
    {
        $dbOk = true; // DB 연결 상태
        try
        {
            Database::one('SELECT 1'); // 연결 확인 쿼리
        }
        catch (Throwable $e)
        {
            $dbOk = false; // 연결 실패
        }
        Response::ok(['status' => $dbOk ? 'ok' : 'degraded', 'db' => $dbOk, 'time' => date('c')]); // 상태 응답
    }
}
