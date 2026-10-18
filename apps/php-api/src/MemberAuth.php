<?php // 정식 회원의 인증과 세션
declare(strict_types=1); // 엄격한 자료형 검사

final class MemberAuth // 게스트와 분리된 회원 인증
{ // 회원 인증 시작
    private const DUMMY_HASH = '$2y$10$rOq2uvTwgEr9n0vKx62rT.HVm2OrJZLXZDfmcSU35y64O6lZZaPmK'; // 없는 회원도 같은 해시 검증 비용

    public static function verifyPassword(string $password, ?array $user): bool // 회원 비밀번호 확인
    { // 비밀번호 확인 시작
        $matches = password_verify($password, $user['password_hash'] ?? self::DUMMY_HASH); // 계정 유무와 무관한 해시 검사
        return $user !== null && $matches; // 존재하는 회원의 일치 여부
    } // 비밀번호 확인 끝

    private static function cookieName(): string // 독립된 회원 쿠키 이름
    { // 쿠키 설정 검사 시작
        $name = Env::get('USER_SESSION_COOKIE', 'tc_user_session'); // 회원 쿠키 설정
        if ($name === Env::get('SESSION_COOKIE')) // 게스트 쿠키 충돌 확인
        { // 충돌 처리 시작
            throw new RuntimeException('회원 쿠키와 게스트 쿠키 이름은 달라야 합니다.'); // 세션 덮어쓰기 차단
        } // 충돌 처리 끝
        return $name; // 회원 쿠키 이름
    } // 쿠키 설정 검사 끝

    private static function token(Request $request): ?string // 회원 세션 토큰 확인
    { // 토큰 검사 시작
        $token = $request->cookie(self::cookieName()); // HttpOnly 쿠키 값
        return $token !== null && preg_match('/\A[0-9a-f]{48}\z/D', $token) === 1 ? $token : null; // 서버 발급 형식만 허용
    } // 토큰 검사 끝

    public static function currentUser(Request $request): ?array // 유효한 회원 세션 조회
    { // 회원 조회 시작
        $token = self::token($request); // 현재 회원 토큰
        if ($token === null) // 쿠키 없음 또는 형식 오류
        { // 비인증 결과 시작
            return null; // 로그인하지 않은 상태
        } // 비인증 결과 끝
        return Database::one('SELECT u.user_id, u.login_id, u.display_name, u.created_at, s.session_id AS user_session_id FROM user_sessions s JOIN users u ON u.user_id = s.user_id WHERE s.token_hash = ? AND s.expires_at > NOW() AND s.revoked_at IS NULL', [Auth::hash($token)]); // 만료·폐기되지 않은 회원과 내부 세션
    } // 회원 조회 끝

    public static function publicUser(array $user): array // 비밀값 없는 회원 응답
    { // 응답 구성 시작
        return [ // 공개 회원 필드
            'user_id' => (int) $user['user_id'], // 회원 식별자
            'login_id' => $user['login_id'], // 로그인 ID
            'display_name' => $user['display_name'], // 표시 이름
            'created_at' => $user['created_at'], // 가입 시각
        ]; // 회원 정보 반환
    } // 응답 구성 끝

    private static function cookieOptions(int $expires): array // 발급·삭제에 같은 쿠키 속성 사용
    { // 쿠키 속성 시작
        return [ // 보호 속성
            'expires' => $expires, // 브라우저 만료 시각
            'path' => '/', // 사이트 전체 경로
            'httponly' => true, // 자바스크립트의 토큰 접근 차단
            'samesite' => 'Strict', // 외부 사이트의 쿠키 전송 차단
            'secure' => Env::bool('COOKIE_SECURE'), // HTTPS 환경의 전용 전송
        ]; // 쿠키 속성 반환
    } // 쿠키 속성 끝

    public static function issueSession(Request $request, int $userId): int // 재로그인 시 현재 브라우저 세션 교체
    { // 세션 발급 시작
        $name = self::cookieName(); // 쿠키 충돌 사전 검사
        $oldToken = self::token($request); // 교체할 기존 세션
        $token = Auth::newSecret(); // 예측할 수 없는 새 토큰
        $ttl = max(60, Env::int('USER_SESSION_TTL', 43200)); // 회원 세션 유효 시간
        $pdo = Database::pdo(); // 원자적 교체용 연결
        $pdo->beginTransaction(); // 교체 트랜잭션
        try // 기존 세션 폐기와 새 세션 저장
        { // 저장 시작
            if ($oldToken !== null) // 이전 회원 쿠키 존재
            { // 기존 세션 폐기 시작
                Database::run('UPDATE user_sessions SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL', [Auth::hash($oldToken)]); // 현재 브라우저의 이전 세션만 폐기
            } // 기존 세션 폐기 끝
            Database::run('INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))', [$userId, Auth::hash($token), $ttl]); // 토큰 원문 없는 새 세션
            $sessionId = Database::lastId(); // 새 회원 세션 번호
            $pdo->commit(); // 세션 교체 확정
        } // 저장 끝
        catch (Throwable $error) // 세션 저장 실패
        { // 실패 복구 시작
            $pdo->rollBack(); // 기존 세션 보존
            throw $error; // 오류 전달
        } // 실패 복구 끝
        setcookie($name, $token, self::cookieOptions(time() + $ttl)); // 저장 확정 후 쿠키 발급
        return $sessionId; // 내부 게스트 결합용 번호
    } // 세션 발급 끝

    public static function destroySession(Request $request): void // 현재 회원 세션만 폐기
    { // 로그아웃 시작
        $token = self::token($request); // 현재 회원 토큰
        if ($token !== null) // 유효한 토큰 형식
        { // 서버 세션 폐기 시작
            Database::run('DELETE g FROM guest_sessions g JOIN user_sessions u ON u.session_id = g.user_session_id WHERE u.token_hash = ?', [Auth::hash($token)]); // 현재 회원 세션의 게스트·티켓 정리
            Database::run('UPDATE user_sessions SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL', [Auth::hash($token)]); // 서버에서 재사용 차단
        } // 서버 세션 폐기 끝
        setcookie(self::cookieName(), '', self::cookieOptions(time() - 3600)); // 회원 쿠키만 제거
    } // 로그아웃 끝
} // 회원 인증 끝
