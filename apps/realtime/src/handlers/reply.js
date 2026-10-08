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

module.exports = { ok, fail, joinedBoard };
