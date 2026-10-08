// link:create / update / delete — 객체 사이의 관계 연결선(화살표·라벨). 잠금 없이 편집자 권한만 검사
'use strict';

const db = require('../db'); // DB 접근
const auth = require('../auth'); // 권한 검사
const presence = require('../presence'); // 방 이름
const { ok, fail, joinedBoard } = require('./reply'); // 응답 헬퍼

function rowToLink(row)
{
    return { link_id: row.link_id, board_id: row.board_id, from_object_id: row.from_object_id, to_object_id: row.to_object_id, label: row.label ?? null }; // 클라이언트 연결선 형식
}

function cleanLabel(value)
{
    if (value === undefined || value === null)
    {
        return null; // 라벨 없음
    }
    if (typeof value !== 'string')
    {
        return undefined; // 형식 오류
    }
    const text = value.trim(); // 공백 제거
    return text === '' ? null : text.slice(0, 100); // 최대 100자
}

async function requireEditor(socket, data, ack)
{
    const boardId = joinedBoard(socket, data); // 참여 보드 확인
    if (!boardId)
    {
        fail(ack, 'FORBIDDEN', '참여 중인 보드가 아닙니다.'); // 보드 불일치
        return null;
    }
    if (!(await auth.hasRole(socket.data.guestId, socket.data.projectId, 'editor')))
    {
        fail(ack, 'FORBIDDEN', '편집 권한이 없습니다.'); // DB 기준 권한 재확인
        return null;
    }
    return boardId; // 검사 통과
}

function register(io, socket)
{
    socket.on('link:create', async (data, ack) =>
    {
        try
        {
            const boardId = await requireEditor(socket, data, ack); // 보드·권한 검사
            if (!boardId)
            {
                return;
            }
            const from = Number(data.from_object_id); // 출발 객체
            const to = Number(data.to_object_id); // 도착 객체
            if (!Number.isInteger(from) || !Number.isInteger(to) || from <= 0 || to <= 0 || from === to)
            {
                return fail(ack, 'BAD_REQUEST', '서로 다른 두 객체를 지정해야 합니다.'); // 입력 검사
            }
            const rows = await db.query('SELECT object_id FROM board_objects WHERE board_id = ? AND object_id IN (?, ?)', [boardId, from, to]); // 같은 보드의 객체인지 확인
            if (rows.length !== 2)
            {
                return fail(ack, 'BAD_REQUEST', '같은 보드에 있는 객체만 연결할 수 있습니다.'); // 보드 일치 검사
            }
            const label = cleanLabel(data.label); // 라벨 정리
            if (label === undefined)
            {
                return fail(ack, 'BAD_REQUEST', '라벨은 문자열이어야 합니다.'); // 라벨 검사
            }
            const result = await db.query('INSERT INTO board_links (board_id, from_object_id, to_object_id, label) VALUES (?, ?, ?, ?)', [boardId, from, to, label]); // 연결선 저장
            const link = rowToLink({ link_id: result.insertId, board_id: boardId, from_object_id: from, to_object_id: to, label }); // 저장 결과
            ok(ack, { request_id: data.request_id ?? null, link }); // 생성 응답
            socket.to(presence.roomName(boardId)).emit('link:created', { board_id: boardId, guest_id: socket.data.guestId, link }); // 전파
        }
        catch (err)
        {
            console.error('link:create 오류', err); // 서버 로그
            fail(ack, 'SAVE_FAILED', '연결선 저장에 실패했습니다.'); // 실패 응답
        }
    });

    socket.on('link:update', async (data, ack) =>
    {
        try
        {
            const boardId = await requireEditor(socket, data, ack); // 보드·권한 검사
            if (!boardId)
            {
                return;
            }
            const linkId = Number(data.link_id); // 대상 연결선
            const label = cleanLabel(data.label); // 라벨 정리
            if (!Number.isInteger(linkId) || linkId <= 0 || label === undefined)
            {
                return fail(ack, 'BAD_REQUEST', 'link_id 또는 라벨이 올바르지 않습니다.'); // 입력 검사
            }
            await db.query('UPDATE board_links SET label = ? WHERE link_id = ? AND board_id = ?', [label, linkId, boardId]); // 라벨 저장
            const row = await db.one('SELECT * FROM board_links WHERE link_id = ? AND board_id = ?', [linkId, boardId]); // 저장 결과
            if (!row)
            {
                return fail(ack, 'NOT_FOUND', '연결선을 찾을 수 없습니다.'); // 없음
            }
            const link = rowToLink(row); // 응답 형식
            ok(ack, { request_id: data.request_id ?? null, link }); // 변경 응답
            socket.to(presence.roomName(boardId)).emit('link:updated', { board_id: boardId, guest_id: socket.data.guestId, link }); // 전파
        }
        catch (err)
        {
            console.error('link:update 오류', err); // 서버 로그
            fail(ack, 'SAVE_FAILED', '연결선 저장에 실패했습니다.'); // 실패 응답
        }
    });

    socket.on('link:delete', async (data, ack) =>
    {
        try
        {
            const boardId = await requireEditor(socket, data, ack); // 보드·권한 검사
            if (!boardId)
            {
                return;
            }
            const linkId = Number(data.link_id); // 대상 연결선
            if (!Number.isInteger(linkId) || linkId <= 0)
            {
                return fail(ack, 'BAD_REQUEST', 'link_id 가 올바르지 않습니다.'); // 입력 검사
            }
            const result = await db.query('DELETE FROM board_links WHERE link_id = ? AND board_id = ?', [linkId, boardId]); // 연결선 삭제
            if (result.affectedRows !== 1)
            {
                return fail(ack, 'NOT_FOUND', '연결선을 찾을 수 없습니다.'); // 없음
            }
            ok(ack, { request_id: data.request_id ?? null, link_id: linkId, persisted: true }); // 삭제 응답
            socket.to(presence.roomName(boardId)).emit('link:deleted', { board_id: boardId, guest_id: socket.data.guestId, link_id: linkId }); // 전파
        }
        catch (err)
        {
            console.error('link:delete 오류', err); // 서버 로그
            fail(ack, 'SAVE_FAILED', '연결선 삭제에 실패했습니다.'); // 실패 응답
        }
    });
}

module.exports = { register };
