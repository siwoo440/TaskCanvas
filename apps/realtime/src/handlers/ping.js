// net:ping — 접속 PC 점검 화면이 실시간 연결의 왕복 시간을 잴 때 쓰는 응답 (보드 참여 전에도 가능, DB 기록 없음)
'use strict';

function register(io, socket)
{
    socket.on('net:ping', (data, ack) =>
    {
        if (typeof ack === 'function')
        {
            ack({ ok: true }); // 받은 즉시 빈 응답(내용을 돌려주지 않음)
        }
    });
}

module.exports = { register };
