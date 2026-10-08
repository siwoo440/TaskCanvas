<?php
// 게스트 입장·퇴장·세션 조회
declare(strict_types=1);

final class GuestController
{
    public function join(Request $request): void
    {
        Auth::requireMutationHeader($request); // CSRF 헤더 검사
        $this->cleanupExpired(); // 만료 세션·오래된 시도 기록 정리
        $this->checkRateLimit($request->clientIp()); // 요청 제한 검사
        $name = $request->string('display_name', 60); // 표시 이름
        $code = $request->string('invite_code', 120); // 초대 코드 원문
        if ($name === '' || $code === '')
        {
            throw new ApiException(400, 'BAD_REQUEST', '이름과 초대 코드를 모두 입력해야 합니다.'); // 필수값 검사
        }

        $invite = Database::one(
            'SELECT invite_id, project_id, role FROM project_invites
              WHERE code_hash = ? AND expires_at > NOW() AND revoked_at IS NULL',
            [Auth::hash($code)]
        ); // 유효한 초대 조회
        if ($invite === null)
        {
            $this->recordAttempt($request->clientIp(), false); // 실패 기록
            throw new ApiException(401, 'INVALID_INVITE', '초대 코드가 올바르지 않거나 만료되었습니다.'); // 초대 거부
        }
        $projectId = (int) $invite['project_id']; // 입장 프로젝트

        $pdo = Database::pdo(); // 트랜잭션용 PDO
        $pdo->beginTransaction(); // 트랜잭션 시작
        try
        {
            $existing = Database::one(
                'SELECT g.guest_id, m.role FROM guests g
                   JOIN project_members m ON m.guest_id = g.guest_id
                  WHERE m.project_id = ? AND g.display_name = ?',
                [$projectId, $name]
            ); // 같은 이름의 기존 멤버 조회
            if ($existing !== null)
            {
                $guestId = (int) $existing['guest_id']; // 기존 게스트 재사용
                $role = $existing['role']; // 기존 역할 유지
            }
            else
            {
                Database::run('INSERT INTO guests (display_name) VALUES (?)', [$name]); // 게스트 생성
                $guestId = Database::lastId(); // 새 게스트 ID
                $role = $invite['role']; // 초대 코드의 역할 부여
                Database::run('INSERT INTO project_members (project_id, guest_id, role) VALUES (?, ?, ?)', [$projectId, $guestId, $role]); // 멤버십 생성
            }
            Auth::issueSession($guestId); // 세션 쿠키 발급
            $pdo->commit(); // 트랜잭션 확정
        }
        catch (Throwable $e)
        {
            $pdo->rollBack(); // 실패 시 되돌림
            throw $e;
        }
        $this->recordAttempt($request->clientIp(), true); // 성공 기록

        Response::ok([
            'guest' => ['guest_id' => $guestId, 'display_name' => $name],
            'project_id' => $projectId,
            'role' => $role,
        ], 201); // 입장 성공 응답(토큰은 쿠키에만 포함)
    }

    public function leave(Request $request): void
    {
        Auth::requireMutationHeader($request); // CSRF 헤더 검사
        Auth::destroySession($request); // 세션 삭제
        Response::ok(['left' => true]); // 퇴장 응답
    }

    public function me(Request $request): void
    {
        $guest = Auth::requireGuest($request); // 현재 게스트
        $projects = Database::all(
            'SELECT p.project_id, p.title, m.role FROM project_members m
               JOIN projects p ON p.project_id = m.project_id
              WHERE m.guest_id = ? ORDER BY m.joined_at',
            [(int) $guest['guest_id']]
        ); // 참여 프로젝트 목록
        Response::ok([
            'guest' => ['guest_id' => (int) $guest['guest_id'], 'display_name' => $guest['display_name']],
            'projects' => array_map(static fn(array $p) => ['project_id' => (int) $p['project_id'], 'title' => $p['title'], 'role' => $p['role']], $projects),
        ]); // 세션 정보 응답
    }

    private function checkRateLimit(string $ip): void
    {
        $row = Database::one(
            'SELECT COUNT(*) AS n FROM join_attempts WHERE client_ip = ? AND attempted_at > DATE_SUB(NOW(), INTERVAL ? SECOND)',
            [$ip, Env::int('RATE_WINDOW', 600)]
        ); // 최근 시도 횟수
        if ((int) $row['n'] >= Env::int('RATE_LIMIT', 20))
        {
            throw new ApiException(429, 'RATE_LIMITED', '입장 시도가 너무 많습니다. 잠시 후 다시 시도하세요.'); // 제한 초과
        }
    }

    private function cleanupExpired(): void
    {
        if (random_int(1, 20) !== 1)
        {
            return; // 입장 요청 20번 중 1번만 정리(부하 분산)
        }
        Database::run('DELETE FROM guest_sessions WHERE expires_at < DATE_SUB(NOW(), INTERVAL 1 DAY)', []); // 하루 지난 만료 세션 삭제
        Database::run('DELETE FROM join_attempts WHERE attempted_at < DATE_SUB(NOW(), INTERVAL 1 DAY)', []); // 하루 지난 시도 기록 삭제
        Database::run('DELETE FROM realtime_tickets WHERE expires_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)', []); // 한 시간 지난 티켓 삭제
    }

    private function recordAttempt(string $ip, bool $ok): void
    {
        Database::run('INSERT INTO join_attempts (client_ip, succeeded) VALUES (?, ?)', [$ip, $ok ? 1 : 0]); // 시도 기록
    }
}
