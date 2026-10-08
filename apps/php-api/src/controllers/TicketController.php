<?php
// Socket.IO 단기 접속 티켓 발급
declare(strict_types=1);

final class TicketController
{
    public function issue(Request $request): void
    {
        Auth::requireMutationHeader($request); // CSRF 헤더 검사
        $guest = Auth::requireGuest($request); // 현재 게스트
        $boardId = $request->int('board_id'); // 참여할 보드
        $projectId = Auth::boardProject($boardId); // 보드의 프로젝트
        $role = Auth::requireRole((int) $guest['guest_id'], $projectId, 'viewer'); // 참여자 확인
        $ticket = Auth::newSecret(); // 티켓 원문
        $ttl = Env::int('TICKET_TTL', 60); // 티켓 유효 시간
        Database::run(
            'INSERT INTO realtime_tickets (ticket_hash, guest_id, board_id, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
            [Auth::hash($ticket), (int) $guest['guest_id'], $boardId, $ttl]
        ); // 티켓 해시 저장
        Database::run('DELETE FROM realtime_tickets WHERE expires_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)', []); // 오래된 티켓 정리
        Response::ok(['ticket' => $ticket, 'board_id' => $boardId, 'role' => $role, 'expires_in' => $ttl], 201); // 티켓 응답(원문은 이 응답에만 노출)
    }
}
