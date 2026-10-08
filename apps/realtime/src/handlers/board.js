// board:join — 티켓 검증 후 보드 방 참여, 참여자 목록 공유
'use strict';

const auth = require('../auth'); // 티켓 검증
const presence = require('../presence'); // 참여자 관리
const locks = require('../locks'); // 현재 잠금 목록
const boards = require('../boards'); // 보드 이름 감시
const { projectRoom } = require('./task'); // 프로젝트 방 이름
const { fail, ok } = require('./reply'); // 응답 헬퍼

function register(io, socket)
{
    socket.on('board:join', async (data, ack) =>
    {
        try
        {
            if (socket.data.boardId)
            {
                return fail(ack, 'ALREADY_JOINED', '이미 보드에 참여한 연결입니다.'); // 중복 참여 차단
            }
            const boardId = Number(data?.board_id); // 요청 보드
            if (!Number.isInteger(boardId) || boardId <= 0)
            {
                return fail(ack, 'BAD_REQUEST', 'board_id 가 올바르지 않습니다.'); // 입력 검사
            }
            const guest = await auth.consumeTicket(data?.ticket, boardId); // 일회성 티켓 검증
            if (!guest)
            {
                return fail(ack, 'INVALID_TICKET', '접속 티켓이 유효하지 않거나 만료되었습니다.'); // 티켓 거부
            }
            socket.data.boardId = boardId; // 연결의 보드 고정
            socket.data.projectId = guest.project_id; // 연결의 프로젝트
            socket.data.guestId = guest.guest_id; // 게스트 ID
            socket.data.displayName = guest.display_name; // 표시 이름
            socket.data.role = guest.role; // 참여 시점 역할
            socket.data.lastCursorAt = 0; // 커서 중계 시각
            boards.remember(boardId, guest.board_title); // 이름 변경 감지를 위한 기준 이름 기록

            const me = presence.add(boardId, socket.id, guest); // 참여자 등록
            socket.data.color = me.color; // 커서 색상
            socket.join(presence.roomName(boardId)); // Socket.IO 방 참여
            socket.join(projectRoom(guest.project_id)); // 프로젝트 방 참여(공유 업무 변경 수신용)
            socket.to(presence.roomName(boardId)).emit('presence:update', { board_id: boardId, participants: presence.list(boardId) }); // 다른 참여자에게 목록 전송
            ok(ack, { board_id: boardId, you: { guest_id: me.guest_id, display_name: me.display_name, role: me.role, color: me.color }, participants: presence.list(boardId), locks: locks.listForBoard(boardId), board_title: guest.board_title }); // 참여 응답(현재 잠금·보드 이름 포함)
        }
        catch (err)
        {
            console.error('board:join 오류', err); // 서버 로그
            fail(ack, 'INTERNAL_ERROR', '보드 참여 처리 중 오류가 발생했습니다.'); // 오류 응답
        }
    });

    socket.on('disconnect', () =>
    {
        const boardId = socket.data.boardId; // 참여했던 보드
        if (!boardId)
        {
            return;
        }
        presence.remove(boardId, socket.id); // 참여자 제거
        io.to(presence.roomName(boardId)).emit('presence:update', { board_id: boardId, participants: presence.list(boardId) }); // 남은 참여자에게 목록 전송
    });
}

module.exports = { register };
