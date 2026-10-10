// 보드 삭제·이름 변경과 작업실 삭제 감시: 웹 서버(HTTP)에서 바뀐 상태를 접속해 있는 참여자에게 알린다
'use strict';

const db = require('./db'); // DB 접근
const env = require('./env'); // 설정 값
const presence = require('./presence'); // 참여자가 있는 보드 목록
const { projectRoom } = require('./handlers/task'); // 프로젝트 방 이름

const titles = new Map(); // board_id → 마지막으로 확인한 보드 이름

// 누군가 보드에 참여할 때 그 시점의 이름을 기록해 두면, 직후의 이름 변경도 놓치지 않는다
function remember(boardId, title)
{
    if (!titles.has(boardId))
    {
        titles.set(boardId, title); // 처음 참여자가 들어올 때만 기록(이미 감시 중이면 유지)
    }
}

// 접속자가 있는 작업실 번호: 프로젝트 방(project:<번호>)에 연결이 하나라도 있는 것(보드 연결과 작업실 연결 모두 이 방에 들어 있음)
function activeProjectIds(io)
{
    const ids = []; // 작업실 번호
    for (const name of io.sockets.adapter.rooms.keys())
    {
        const m = /^project:(\d+)$/.exec(name); // 프로젝트 방 이름
        if (m)
        {
            ids.push(Number(m[1])); // 접속자가 있는 작업실
        }
    }
    return ids;
}

// 지워진 작업실을 찾아 접속자에게 알리고 연결을 정리한다. 지워진 작업실 번호들을 돌려준다
async function checkProjects(io)
{
    const gone = new Set(); // 지워진 작업실
    const ids = activeProjectIds(io); // 접속자가 있는 작업실
    if (ids.length === 0)
    {
        return gone; // 확인할 작업실 없음
    }
    const rows = await db.query('SELECT project_id FROM projects WHERE project_id IN (' + ids.map(() => '?').join(', ') + ')', ids); // 아직 있는 작업실
    const found = new Set(rows.map((r) => Number(r.project_id))); // 남아 있는 번호
    for (const id of ids)
    {
        if (!found.has(id))
        {
            const room = projectRoom(id); // 그 작업실의 모든 연결(보드·작업실)
            gone.add(id); // 지워진 작업실 기록
            io.to(room).emit('project:deleted', { project_id: id }); // 삭제 알림
            setTimeout(() => io.in(room).disconnectSockets(true), 300); // 알림이 전달된 뒤 연결 정리
        }
    }
    return gone;
}

// 그 보드에 들어와 있는 연결의 작업실 번호(연결이 없으면 null)
function projectOfBoardRoom(io, room)
{
    const members = io.sockets.adapter.rooms.get(room); // 보드 방의 연결들
    const first = members ? io.sockets.sockets.get([...members][0]) : null; // 그중 하나
    return first ? first.data.projectId ?? null : null; // 같은 보드의 연결은 모두 같은 작업실
}

async function check(io)
{
    const goneProjects = await checkProjects(io); // 지워진 작업실(그 접속자들은 project:deleted 를 받음)
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
            if (goneProjects.has(projectOfBoardRoom(io, room)))
            {
                continue; // 작업실째 지워진 보드: 이미 project:deleted 를 보냈고 연결도 그쪽에서 정리함
            }
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
