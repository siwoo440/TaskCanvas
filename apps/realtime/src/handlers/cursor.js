// cursor:move — 커서 위치 중계 (빈도 제한, DB 기록 없음)
'use strict';

const env = require('../env'); // 설정 값
const presence = require('../presence'); // 방 이름
const { joinedBoard } = require('./reply'); // 보드 검사

const INTERVAL = env.int('CURSOR_INTERVAL_MS'); // 최소 중계 간격

function register(io, socket)
{
    socket.on('cursor:move', (data) =>
    {
        const boardId = joinedBoard(socket, data); // 참여 보드 확인
        if (!boardId)
        {
            return; // 미참여·보드 불일치 무시
        }
        const now = Date.now(); // 현재 시각
        if (now - socket.data.lastCursorAt < INTERVAL)
        {
            return; // 빈도 제한
        }
        const x = Number(data.x); // X 좌표
        const y = Number(data.y); // Y 좌표
        if (!Number.isFinite(x) || !Number.isFinite(y))
        {
            return; // 좌표 검사
        }
        socket.data.lastCursorAt = now; // 중계 시각 갱신
        socket.to(presence.roomName(boardId)).volatile.emit('cursor:move', {
            guest_id: socket.data.guestId, // 커서 주인
            display_name: socket.data.displayName, // 표시 이름
            color: socket.data.color, // 커서 색상
            x, // X 좌표
            y, // Y 좌표
        }); // 다른 참여자에게 중계(유실 허용)
    });
}

module.exports = { register };
