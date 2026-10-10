<?php
// 게스트 세션 쿠키와 프로젝트 권한 검사
declare(strict_types=1);

final class Auth
{
    public const ROLES = ['admin', 'editor', 'viewer']; // 허용 역할 목록
    private const RANK = ['viewer' => 1, 'editor' => 2, 'admin' => 3]; // 역할 우선순위

    public static function rank(string $role): int
    {
        return self::RANK[$role] ?? 0; // 역할의 높낮이(모르는 역할은 0)
    }

    public static function hash(string $secret): string
    {
        return hash('sha256', $secret); // 토큰·코드 해시(원문 저장 금지)
    }

    public static function newSecret(): string
    {
        return bin2hex(random_bytes(24)); // 48자 랜덤 16진수 비밀값
    }

    public static function issueSession(int $guestId): void
    {
        $token = self::newSecret(); // 세션 토큰 원문
        $ttl = Env::int('SESSION_TTL', 43200); // 세션 유효 시간
        Database::run(
            'INSERT INTO guest_sessions (guest_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
            [$guestId, self::hash($token), $ttl]
        ); // 세션 해시 저장
        setcookie(Env::get('SESSION_COOKIE'), $token, [
            'expires' => time() + $ttl, // 쿠키 만료
            'path' => '/', // 사이트 전체 경로
            'httponly' => true, // 스크립트 접근 차단
            'samesite' => 'Strict', // 교차 사이트 전송 차단
            'secure' => Env::bool('COOKIE_SECURE'), // HTTPS 전용 여부
        ]); // HttpOnly 세션 쿠키 발급
    }

    public static function destroySession(Request $request): void
    {
        $token = $request->cookie(Env::get('SESSION_COOKIE')); // 쿠키의 토큰 원문
        if ($token !== null)
        {
            Database::run('DELETE FROM guest_sessions WHERE token_hash = ?', [self::hash($token)]); // 세션 행 삭제
        }
        setcookie(Env::get('SESSION_COOKIE'), '', ['expires' => time() - 3600, 'path' => '/', 'httponly' => true, 'samesite' => 'Strict']); // 쿠키 제거
    }

    public static function currentGuest(Request $request): ?array
    {
        $token = $request->cookie(Env::get('SESSION_COOKIE')); // 쿠키의 토큰 원문
        if ($token === null)
        {
            return null; // 세션 없음
        }
        return Database::one(
            'SELECT g.guest_id, g.display_name, s.session_id
               FROM guest_sessions s
               JOIN guests g ON g.guest_id = s.guest_id
              WHERE s.token_hash = ? AND s.expires_at > NOW()',
            [self::hash($token)]
        ); // 유효 세션의 게스트 조회
    }

    public static function requireGuest(Request $request): array
    {
        $guest = self::currentGuest($request); // 현재 게스트
        if ($guest === null)
        {
            throw new ApiException(401, 'UNAUTHORIZED', '게스트 세션이 없거나 만료되었습니다.'); // 미인증
        }
        return $guest; // 게스트 반환
    }

    public static function requireMutationHeader(Request $request): void
    {
        if ($request->header('X-TaskCanvas') !== '1')
        {
            throw new ApiException(403, 'FORBIDDEN', 'X-TaskCanvas 헤더가 필요합니다.'); // CSRF 방어용 헤더 검사
        }
    }

    public static function memberRole(int $guestId, int $projectId): ?string
    {
        $row = Database::one('SELECT role FROM project_members WHERE project_id = ? AND guest_id = ?', [$projectId, $guestId]); // 멤버십 조회
        return $row['role'] ?? null; // 역할 또는 null
    }

    public static function requireRole(int $guestId, int $projectId, string $minimumRole): string
    {
        $role = self::memberRole($guestId, $projectId); // 현재 역할
        if ($role === null || (self::RANK[$role] ?? 0) < (self::RANK[$minimumRole] ?? 99))
        {
            throw new ApiException(403, 'FORBIDDEN', '프로젝트 또는 보드에 대한 권한이 없습니다.'); // 권한 부족
        }
        return $role; // 확인된 역할 반환
    }

    public static function boardProject(int $boardId): int
    {
        $row = Database::one('SELECT project_id FROM boards WHERE board_id = ?', [$boardId]); // 보드의 프로젝트 조회
        if ($row === null)
        {
            throw new ApiException(404, 'NOT_FOUND', '보드를 찾을 수 없습니다.'); // 보드 없음
        }
        return (int) $row['project_id']; // 프로젝트 ID 반환
    }
}
