<?php // 회원과 기존 게스트 작업실의 연결
declare(strict_types=1); // 엄격한 자료형
final class MemberWorkspace // 회원 작업실 서비스
{ // 서비스 시작
    public static function requireUser(Request $request): array // 현재 회원 필수 검사
    { // 회원 검사
        $user = MemberAuth::currentUser($request); // 유효한 로그인
        if ($user === null) // 로그인 없음
        { // 미인증 처리
            throw new ApiException(401, 'UNAUTHORIZED', '로그인이 필요합니다.'); // 로그인 안내
        } // 미인증 끝
        return $user; // 내부 회원 정보
    } // 회원 검사 끝
    private static function locked(array $user, callable $operation): mixed // 회원별 작업 직렬화
    { // 트랜잭션 시작
        $pdo = Database::pdo(); // 공통 연결
        $pdo->beginTransaction(); // 원자적 처리
        try // 회원과 활성 세션 재확인
        { // 작업 범위
            Database::one('SELECT user_id FROM users WHERE user_id = ? FOR UPDATE', [(int) $user['user_id']]); // 회원별 잠금
            $session = Database::one('SELECT session_id FROM user_sessions WHERE session_id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > NOW() FOR UPDATE', [(int) $user['user_session_id'], (int) $user['user_id']]); // 최신 세션 확인
            if ($session === null) // 대기 중 만료 또는 폐기
            { // 무효 세션
                throw new ApiException(401, 'UNAUTHORIZED', '로그인이 만료되었습니다.'); // 재로그인 안내
            } // 세션 검사 끝
            $result = $operation(); // 검증된 작업 실행
            $pdo->commit(); // 변경 확정
            return $result; // 작업 결과
        } // 작업 끝
        catch (Throwable $error) // 저장 실패
        { // 복구 시작
            $pdo->rollBack(); // 미완료 변경 취소
            throw $error; // 원인 전달
        } // 복구 끝
    } // 트랜잭션 끝
    public static function ownedGuest(array $user): array // 회원의 대표 게스트 확보
    { // 대표 선택
        $guest = Database::one('SELECT g.guest_id, g.display_name FROM guests g JOIN guest_user_links l ON l.guest_id = g.guest_id WHERE l.user_id = ? ORDER BY g.guest_id LIMIT 1', [(int) $user['user_id']]); // 본인 연결만 조회
        if ($guest === null) // 첫 회원 게스트
        { // 신규 생성
            Database::run('INSERT INTO guests (display_name) VALUES (?)', [$user['display_name']]); // 동명이인과 다른 식별자
            $guest = ['guest_id' => Database::lastId(), 'display_name' => $user['display_name']]; // 새 게스트
            Database::run('INSERT INTO guest_user_links (guest_id, user_id) VALUES (?, ?)', [$guest['guest_id'], (int) $user['user_id']]); // 신규 소유 연결
        } // 신규 생성 끝
        $guest['guest_id'] = (int) $guest['guest_id']; // 정수 식별자
        return $guest; // 본인 게스트
    } // 대표 선택 끝
    public static function workspaces(array $user): array // 회원 작업실 목록
    { // 목록 조회
        $rows = Database::all("SELECT p.project_id, p.title, m.role, m.guest_id FROM guest_user_links l JOIN project_members m ON m.guest_id = l.guest_id JOIN projects p ON p.project_id = m.project_id WHERE l.user_id = ? ORDER BY p.project_id, FIELD(m.role, 'admin','editor','viewer'), m.guest_id", [(int) $user['user_id']]); // 보유 역할 우선 정렬
        $projects = []; // 중복 없는 목록
        foreach ($rows as $row) // 멤버십 순회
        { // 작업실 선택
            $id = (int) $row['project_id']; // 작업실 번호
            if (!isset($projects[$id])) // 첫 최고 역할
            { // 목록 추가
                $row['project_id'] = $id; // 정수 번호
                $row['guest_id'] = (int) $row['guest_id']; // 정수 게스트
                $projects[$id] = $row; // 해당 작업실 대표 멤버십
            } // 목록 추가 끝
        } // 순회 끝
        return array_values($projects); // 공개 작업실 목록
    } // 목록 끝
    public static function restore(Request $request, array $user): void // 로그인 후 활성 게스트 복원
    { // 복원 시작
        $current = Auth::currentGuest($request); // 기존 브라우저 게스트
        if ($current !== null && $current['user_id'] === null && $current['user_session_id'] === null) // 미연결 게스트 보유
        { // 소유 이전 보류
            return; // 명시적 연결 선택 보존
        } // 보류 끝
        $session = self::locked($user, static function () use ($user): array // 대표 생성과 발급의 원자성
        { // 복원 트랜잭션
            $guest = self::ownedGuest($user); // 본인 게스트 확보
            return Auth::prepareSession((int) $guest['guest_id'], (int) $user['user_session_id']); // 같은 트랜잭션의 세션 저장
        }); // 복원 저장 끝
        Auth::publishSession($session); // 저장 확정 후 쿠키
    } // 복원 끝
    public static function linkGuest(Request $request): array // 기존 게스트의 명시적 연결
    { // 연결 시작
        $user = self::requireUser($request); // 인증된 회원
        Throttle::check($request->clientIp()); // 비밀번호 시도 제한
        Throttle::record($request->clientIp(), false); // 실패도 시도 기록
        $password = $request->json()['password'] ?? null; // 재확인 비밀번호
        $stored = Database::one('SELECT password_hash FROM users WHERE user_id = ?', [(int) $user['user_id']]); // 실제 회원 해시
        if (!is_string($password) || strlen($password) > 72 || str_contains($password, "\0") || !MemberAuth::verifyPassword($password, $stored)) // 입력과 비밀번호 검사
        { // 확인 거부
            throw new ApiException(401, 'INVALID_CREDENTIALS', '회원 비밀번호를 확인하세요.'); // 안전한 오류
        } // 확인 끝
        $result = self::locked($user, static function () use ($request, $user): array // 소유 연결 직렬화
        { // 연결 트랜잭션
            $guest = Auth::requireGuest($request); // 잠금 후 세션 재조회
            Database::one('SELECT guest_id FROM guests WHERE guest_id = ? FOR UPDATE', [(int) $guest['guest_id']]); // 이름 재입장과 공통 잠금
            $session = Database::one('SELECT session_id FROM guest_sessions WHERE session_id = ? AND guest_id = ? AND expires_at > NOW() FOR UPDATE', [(int) $guest['session_id'], (int) $guest['guest_id']]); // 스냅샷 대신 잠금 후 최신 세션
            if ($session === null) // 다른 연결 요청에서 폐기
            { // 동시 소유 확인 거부
                throw new ApiException(401, 'UNAUTHORIZED', '게스트 세션이 만료되었거나 이미 연결되었습니다.'); // 재확인 안내
            } // 최신 세션 검사 끝
            $link = Database::one('SELECT user_id FROM guest_user_links WHERE guest_id = ? FOR UPDATE', [(int) $guest['guest_id']]); // 잠금 후 최신 소유
            if ($link !== null && (int) $link['user_id'] !== (int) $user['user_id']) // 다른 회원 소유
            { // 소유 충돌
                throw new ApiException(409, 'GUEST_ALREADY_LINKED', '다른 회원에 연결된 참여자입니다.'); // 변경 거부
            } // 소유 충돌 끝
            $session = null; // 중복 연결의 추가 발급 없음
            if ($link === null) // 최초 연결
            { // 소유 확정
                Database::run('INSERT INTO guest_user_links (guest_id, user_id) VALUES (?, ?)', [(int) $guest['guest_id'], (int) $user['user_id']]); // 본문 ID 없는 연결
                Database::run('DELETE FROM realtime_tickets WHERE guest_id = ?', [(int) $guest['guest_id']]); // 이전 티켓 폐기
                Database::run('DELETE FROM guest_sessions WHERE guest_id = ?', [(int) $guest['guest_id']]); // 이전 세션 전체 폐기
                $session = Auth::prepareSession((int) $guest['guest_id'], (int) $user['user_session_id']); // 연결과 함께 저장하거나 함께 롤백
            } // 소유 확정 끝
            return ['guest' => ['guest_id' => (int) $guest['guest_id'], 'display_name' => $guest['display_name']], 'session' => $session]; // 연결 결과
        }); // 연결 저장 끝
        if ($result['session'] !== null) // 최초 연결 저장 성공
        { // 새 쿠키 발급
            Auth::publishSession($result['session']); // 커밋 뒤 쿠키만 전송
        } // 쿠키 발급 끝
        unset($result['session']); // 내부 분기 제거
        return $result; // 연결된 게스트
    } // 연결 끝
    public static function selectWorkspace(Request $request, int $projectId): array // 본인 작업실 전환
    { // 전환 시작
        $user = self::requireUser($request); // 현재 회원
        foreach (self::workspaces($user) as $project) // 실제 멤버십 검색
        { // 작업실 선택
            if ($project['project_id'] === $projectId) // 요청 대상 일치
            { // 전환 확정
                Auth::issueSession($project['guest_id'], (int) $user['user_session_id']); // 현재 브라우저 세션 발급
                $guest = Database::one('SELECT guest_id, display_name FROM guests WHERE guest_id = ?', [$project['guest_id']]); // 본인 참여자
                $guest['guest_id'] = (int) $guest['guest_id']; // 정수 번호
                return ['guest' => $guest, 'project_id' => $projectId, 'role' => $project['role']]; // 기존 전환 응답
            } // 전환 끝
        } // 검색 끝
        throw new ApiException(403, 'FORBIDDEN', '참여한 작업실만 선택할 수 있습니다.'); // 타인 접근 거부
    } // 전환 끝
    public static function joinWorkspace(Request $request, string $code): array // 회원 초대 참여
    { // 참여 시작
        $user = self::requireUser($request); // 현재 회원
        Throttle::check($request->clientIp()); // 초대 시도 제한
        Throttle::record($request->clientIp(), false); // 거부 시도 포함
        $projectId = self::locked($user, static function () use ($user, $code): int // 중복 참여 직렬화
        { // 참여 트랜잭션
            $invite = Database::one('SELECT invite_id, project_id, role, max_uses, used_count FROM project_invites WHERE code_hash = ? AND expires_at > NOW() AND revoked_at IS NULL FOR UPDATE', [Auth::hash($code)]); // 유효 초대 잠금
            if ($invite === null) // 없거나 만료
            { // 초대 거부
                throw new ApiException(401, 'INVALID_INVITE', '초대 코드가 올바르지 않거나 만료되었습니다.'); // 초대 오류
            } // 초대 검사 끝
            $id = (int) $invite['project_id']; // 대상 작업실
            foreach (self::workspaces($user) as $project) // 기존 참여 확인
            { // 멤버십 검사
                if ($project['project_id'] === $id) // 이미 보유
                { // 멱등 재입장
                    return $id; // 역할과 횟수 유지
                } // 재입장 끝
            } // 멤버십 검사 끝
            $taken = Database::run('UPDATE project_invites SET used_count = used_count + 1 WHERE invite_id = ? AND expires_at > NOW() AND revoked_at IS NULL AND (max_uses IS NULL OR used_count < max_uses)', [(int) $invite['invite_id']])->rowCount(); // 한도 내 차감
            if ($taken !== 1) // 신규 참여 불가
            { // 한도 거부
                throw new ApiException(401, (int) $invite['max_uses'] === 0 ? 'REENTRY_ONLY' : 'INVITE_EXHAUSTED', '이 초대 코드로 새로 참여할 수 없습니다.'); // 한도 오류
            } // 한도 검사 끝
            $guest = self::ownedGuest($user); // 회원 소유 게스트
            Database::run('INSERT INTO project_members (project_id, guest_id, role) VALUES (?, ?, ?)', [$id, $guest['guest_id'], $invite['role']]); // 초대 역할만 부여
            return $id; // 참여 작업실
        }); // 참여 저장 끝
        return self::selectWorkspace($request, $projectId); // 참여한 작업실 활성화
    } // 참여 끝
} // 서비스 끝
