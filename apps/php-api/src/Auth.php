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

    public static function prepareSession(int $guestId, ?int $userSessionId = null): array // DB 저장과 쿠키 전송 분리
    { // 세션 준비 시작
        $token = self::newSecret(); // 비밀 토큰
        $ttl = Env::int('SESSION_TTL', 43200); // 게스트 유효 시간
        Database::run('INSERT INTO guest_sessions (guest_id, token_hash, expires_at, user_session_id) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), ?)', [$guestId, self::hash($token), $ttl, $userSessionId]); // 트랜잭션에 포함할 저장
        return ['session_id' => Database::lastId(), 'token' => $token, 'expires' => time() + $ttl]; // 응답에 노출하지 않을 내부 발급 자료
    } // 준비 끝
    public static function publishSession(array $session): void // 저장 확정 후 쿠키 전송
    { // 쿠키 전송 시작
        setcookie(Env::get('SESSION_COOKIE'), $session['token'], [ // 보호 쿠키
            'expires' => $session['expires'], // 브라우저 만료
            'path' => '/', // 사이트 전체 경로
            'httponly' => true, // 스크립트 접근 차단
            'samesite' => 'Strict', // 외부 요청 쿠키 차단
            'secure' => Env::bool('COOKIE_SECURE'), // HTTPS 설정
        ]); // 쿠키 전송 끝
    } // 전송 끝
    public static function issueSession(int $guestId, ?int $userSessionId = null): int // 단일 발급 편의 경로
    { // 발급 시작
        $session = self::prepareSession($guestId, $userSessionId); // 실제 세션 저장
        self::publishSession($session); // 성공한 세션 쿠키
        return $session['session_id']; // 티켓 결합 번호
    } // 발급 끝

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
        $guest = Database::one('SELECT g.guest_id, g.display_name, s.session_id, s.user_session_id, l.user_id FROM guest_sessions s JOIN guests g ON g.guest_id = s.guest_id LEFT JOIN guest_user_links l ON l.guest_id = g.guest_id WHERE s.token_hash = ? AND s.expires_at > NOW()', [self::hash($token)]); // 현재 게스트와 소유 연결
        if ($guest === null) // 없는 세션
        { // 조회 실패
            return null; // 미인증
        } // 조회 실패 끝
        if ($guest['user_id'] !== null || $guest['user_session_id'] !== null) // 회원 소유 또는 결합 세션
        { // 회원 인증 검사
            $user = MemberAuth::currentUser($request); // 실제 로그인 세션
            if ($user === null || (int) $guest['user_id'] !== (int) $user['user_id'] || (int) $guest['user_session_id'] !== (int) $user['user_session_id']) // 소유와 발급 세션 일치
            { // 결합 불일치
                return null; // 게스트 쿠키만의 접근 차단
            } // 결합 검사 끝
        } // 회원 검사 끝
        return $guest; // 검증된 게스트
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
