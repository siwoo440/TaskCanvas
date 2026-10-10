// ack 콜백 응답 형식 (HTTP API 의 오류 계약과 동일한 모양)
'use strict';

function ok(ack, body)
{
    if (typeof ack === 'function')
    {
        ack({ ok: true, ...body }); // 성공 응답
    }
}

function fail(ack, code, message)
{
    if (typeof ack === 'function')
    {
        ack({ ok: false, error: { code, message } }); // 오류 응답
    }
}

function joinedBoard(socket, data)
{
    const boardId = socket.data.boardId; // 연결의 보드
    return boardId && Number(data?.board_id) === boardId ? boardId : null; // 참여 보드와 일치할 때만 허용
}

// 공유 업무는 프로젝트 단위: 보드에 참여한 연결은 그 보드 번호를 함께 보내야 하고, 작업실 연결은 참여한 프로젝트면 된다
function joinedProject(socket, data)
{
    if (socket.data.workspace)
    {
        return socket.data.projectId ?? null; // 작업실 연결의 프로젝트
    }
    return joinedBoard(socket, data) ? socket.data.projectId : null; // 보드 연결은 보드 번호가 맞을 때만
}

module.exports = { ok, fail, joinedBoard, joinedProject };
