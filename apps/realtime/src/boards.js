// 보드 삭제·이름 변경 감시: 작업실(HTTP)에서 바뀐 보드 상태를 그 보드에 들어와 있는 참여자에게 알린다
'use strict';

const db = require('./db'); // DB 접근
const env = require('./env'); // 설정 값
const presence = require('./presence'); // 참여자가 있는 보드 목록

const titles = new Map(); // board_id → 마지막으로 확인한 보드 이름

// 누군가 보드에 참여할 때 그 시점의 이름을 기록해 두면, 직후의 이름 변경도 놓치지 않는다
function remember(boardId, title)
{
    if (!titles.has(boardId))
    {
        titles.set(boardId, title); // 처음 참여자가 들어올 때만 기록(이미 감시 중이면 유지)
    }
}

async function check(io)
{
    const ids = presence.activeBoardIds(); // 참여자가 있는 보드
    for (const id of [...titles.keys()])
    {
        if (!ids.includes(id))
        {
            titles.delete(id); // 아무도 없는 보드는 감시 대상에서 제외
        }
    }
    if (ids.length === 0)
    {
        return; // 감시할 보드 없음
    }
    const rows = await db.query('SELECT board_id, title FROM boards WHERE board_id IN (' + ids.map(() => '?').join(', ') + ')', ids); // 현재 상태 조회
    const found = new Map(rows.map((r) => [Number(r.board_id), r.title])); // board_id → 이름
    for (const id of ids)
    {
        const room = presence.roomName(id); // 보드 방
        if (!found.has(id))
        {
            titles.delete(id); // 감시 종료
            io.to(room).emit('board:deleted', { board_id: id }); // 삭제 알림
            setTimeout(() => io.in(room).disconnectSockets(true), 300); // 알림이 전달된 뒤 연결 정리(참여자·잠금은 disconnect 처리에서 해제)
            continue;
        }
        const title = found.get(id); // 현재 이름
        if (titles.has(id) && titles.get(id) !== title)
        {
            io.to(room).emit('board:renamed', { board_id: id, title }); // 이름 변경 알림
        }
        titles.set(id, title); // 마지막 이름 기록
    }
}

function startWatcher(io)
{
    setInterval(() =>
    {
        check(io).catch((err) => console.error('보드 감시 오류', err)); // 일시적 DB 오류는 다음 주기에 다시 시도
    }, env.int('BOARD_SWEEP_MS') || 5000); // 기본 5초 주기
}

module.exports = { startWatcher, remember };
