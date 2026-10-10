// project:join — 작업실 연결: 보드에 들어가지 않고 프로젝트 방에만 참여해 공유 업무를 보고 바꾼다
'use strict';

const auth = require('../auth'); // 티켓 검증
const { projectRoom } = require('./task'); // 프로젝트 방 이름
const { fail, ok } = require('./reply'); // 응답 헬퍼

function register(io, socket)
{
    socket.on('project:join', async (data, ack) =>
    {
        try
        {
            if (socket.data.boardId || socket.data.projectId)
            {
                return fail(ack, 'ALREADY_JOINED', '이미 보드나 작업실에 참여한 연결입니다.'); // 중복 참여 차단
            }
            const projectId = Number(data?.project_id); // 요청 프로젝트
            if (!Number.isInteger(projectId) || projectId <= 0)
            {
                return fail(ack, 'BAD_REQUEST', 'project_id 가 올바르지 않습니다.'); // 입력 검사
            }
            const guest = await auth.consumeProjectTicket(data?.ticket, projectId); // 일회성 작업실 티켓 검증
            if (!guest)
            {
                return fail(ack, 'INVALID_TICKET', '접속 티켓이 유효하지 않거나 만료되었습니다.'); // 티켓 거부
            }
            socket.data.workspace = true; // 작업실 연결 표시(보드 이벤트는 boardId 가 없어 모두 거부됨)
            socket.data.projectId = guest.project_id; // 연결의 프로젝트
            socket.data.guestId = guest.guest_id; // 게스트 ID
            socket.data.displayName = guest.display_name; // 표시 이름
            socket.data.role = guest.role; // 참여 시점 역할
            socket.join(projectRoom(guest.project_id)); // 프로젝트 방 참여(공유 업무 생성·변경 수신)
            ok(ack, { project_id: guest.project_id, you: { guest_id: guest.guest_id, display_name: guest.display_name, role: guest.role } }); // 참여 응답
        }
        catch (err)
        {
            console.error('project:join 오류', err); // 서버 로그
            fail(ack, 'INTERNAL_ERROR', '작업실 연결 처리 중 오류가 발생했습니다.'); // 오류 응답
        }
    });
}

module.exports = { register };
