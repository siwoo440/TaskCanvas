<?php
// 게스트 입장·퇴장·세션 조회
declare(strict_types=1);

final class GuestController
{
    public function join(Request $request): void
    {
        Auth::requireMutationHeader($request); // CSRF 헤더 검사
        $this->cleanupExpired(); // 만료 세션·오래된 시도 기록 정리
        Throttle::check($request->clientIp()); // 요청 제한 검사
        $name = $request->string('display_name', 60); // 표시 이름
        $code = $request->string('invite_code', 120); // 초대 코드 원문
        if ($name === '' || $code === '')
        {
            throw new ApiException(400, 'BAD_REQUEST', '이름과 초대 코드를 모두 입력해야 합니다.'); // 필수값 검사
        }

        $invite = Database::one(
            'SELECT invite_id, project_id, role, max_uses FROM project_invites
              WHERE code_hash = ? AND expires_at > NOW() AND revoked_at IS NULL',
            [Auth::hash($code)]
        ); // 유효한 초대 조회
        if ($invite === null)
        {
            Throttle::record($request->clientIp(), false); // 실패 기록
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
                if (Auth::rank($invite['role']) < Auth::rank($existing['role']))
                {
                    throw new ApiException(403, 'NAME_IN_USE', '이 이름은 이 작업실에서 더 높은 권한의 참여자가 쓰고 있습니다. 다른 이름으로 입장하세요.'); // 낮은 권한의 코드로 높은 권한 참여자의 이름을 써서 권한을 가로채는 것을 막음
                }
                $guestId = (int) $existing['guest_id']; // 기존 게스트 재사용
                $role = $existing['role']; // 기존 역할 유지
            }
            else
            {
                $taken = Database::run(
                    'UPDATE project_invites SET used_count = used_count + 1 WHERE invite_id = ? AND (max_uses IS NULL OR used_count < max_uses)',
                    [(int) $invite['invite_id']]
                )->rowCount(); // 새 참여자 한 명만큼 사용 횟수 차감(확인과 증가를 한 문장으로 해서 동시에 들어와도 한도를 넘지 않음)
                if ($taken === 0 && $invite['max_uses'] !== null && (int) $invite['max_uses'] === 0)
                {
                    throw new ApiException(401, 'REENTRY_ONLY', '이 코드는 이미 참여한 사람이 같은 이름으로 다시 들어올 때만 쓸 수 있습니다. 이름을 확인하세요.'); // 재입장 전용 코드에 새 이름
                }
                if ($taken === 0)
                {
                    throw new ApiException(401, 'INVITE_EXHAUSTED', '이 초대 코드는 정해진 인원이 모두 입장했습니다. 관리자에게 새 코드를 요청하세요.'); // 인원 마감(이미 입장한 이름으로는 다시 들어올 수 있음)
                }
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
            if ($e instanceof ApiException)
            {
                Throttle::record($request->clientIp(), false); // 거부된 입장도 시도로 셈(이름·코드를 바꿔 가며 찔러 보는 것을 제한)
            }
            throw $e;
        }
        Throttle::record($request->clientIp(), true); // 성공 기록

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
}
