<?php
// Socket.IO 단기 접속 티켓 발급: 보드에 참여하는 티켓(board_id)과 작업실 연결용 티켓(project_id) 두 가지
declare(strict_types=1);

final class TicketController
{
    public function issue(Request $request): void
    {
        Auth::requireMutationHeader($request); // CSRF 헤더 검사
        $guest = Auth::requireGuest($request); // 현재 게스트
        $body = $request->json(); // 요청 본문
        $forBoard = array_key_exists('board_id', $body); // 보드 티켓 요청인지
        $forProject = array_key_exists('project_id', $body); // 작업실 티켓 요청인지
        if ($forBoard === $forProject)
        {
            throw new ApiException(400, 'BAD_REQUEST', 'board_id 와 project_id 중 하나만 보내야 합니다.'); // 둘 다 없거나 둘 다 있음
        }
        $boardId = $forBoard ? $request->int('board_id') : null; // 참여할 보드(작업실 티켓이면 null)
        $projectId = $forBoard ? Auth::boardProject($boardId) : $request->int('project_id'); // 대상 프로젝트
        $role = Auth::requireRole((int) $guest['guest_id'], $projectId, 'viewer'); // 참여자 확인
        $ticket = Auth::newSecret(); // 티켓 원문
        $ttl = Env::int('TICKET_TTL', 60); // 티켓 유효 시간
        Database::run(
            'INSERT INTO realtime_tickets (ticket_hash, guest_id, board_id, project_id, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
            [Auth::hash($ticket), (int) $guest['guest_id'], $boardId, $forBoard ? null : $projectId, $ttl]
        ); // 티켓 해시 저장(보드 티켓은 board_id 만, 작업실 티켓은 project_id 만 채움)
        Database::run('DELETE FROM realtime_tickets WHERE expires_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)', []); // 오래된 티켓 정리
        $scope = $forBoard ? ['board_id' => $boardId] : ['project_id' => $projectId]; // 티켓을 쓸 수 있는 범위
        Response::ok(['ticket' => $ticket] + $scope + ['role' => $role, 'expires_in' => $ttl], 201); // 티켓 응답(원문은 이 응답에만 노출)
    }
}
