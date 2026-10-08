// stroke:preview / stroke:commit — 펜 미리보기 중계와 확정 저장
'use strict';

const env = require('../env'); // 설정 값
const db = require('../db'); // DB 접근
const auth = require('../auth'); // 권한 검사
const presence = require('../presence'); // 방 이름
const { ok, fail, joinedBoard } = require('./reply'); // 응답 헬퍼

const MAX_POINTS = env.int('MAX_STROKE_POINTS'); // 획당 최대 좌표 수

function cleanPoints(points, limit)
{
    if (!Array.isArray(points) || points.length === 0 || points.length > limit)
    {
        return null; // 배열·길이 검사
    }
    const out = []; // 정리된 좌표
    for (const p of points)
    {
        const x = Number(p?.[0]); // X 좌표
        const y = Number(p?.[1]); // Y 좌표
        if (!Number.isFinite(x) || !Number.isFinite(y))
        {
            return null; // 숫자 검사
        }
        out.push([x, y]); // 좌표 추가
    }
    return out; // 정리 결과
}

function cleanStyle(style)
{
    const s = style && typeof style === 'object' ? style : {}; // 객체 보정
    const color = typeof s.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : '#222222'; // 색상 검사
    const width = Math.min(50, Math.max(1, Number(s.width) || 3)); // 굵기 범위 제한
    return { color, width }; // 허용 스타일만 반환
}

function bounds(points)
{
    let minX = Infinity; // 최소 X
    let minY = Infinity; // 최소 Y
    let maxX = -Infinity; // 최대 X
    let maxY = -Infinity; // 최대 Y
    for (const [x, y] of points)
    {
        minX = Math.min(minX, x); // 최소 X 갱신
        minY = Math.min(minY, y); // 최소 Y 갱신
        maxX = Math.max(maxX, x); // 최대 X 갱신
        maxY = Math.max(maxY, y); // 최대 Y 갱신
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }; // 경계 사각형
}

function register(io, socket)
{
    socket.on('stroke:preview', (data) =>
    {
        const boardId = joinedBoard(socket, data); // 참여 보드 확인
        if (!boardId || socket.data.role === 'viewer')
        {
            return; // 미참여·열람자 무시
        }
        const points = cleanPoints(data.points_delta, 200); // 부분 좌표 검사
        if (!points || typeof data.stroke_id !== 'string')
        {
            return; // 형식 오류 무시
        }
        socket.to(presence.roomName(boardId)).emit('stroke:preview', {
            guest_id: socket.data.guestId, // 그리는 사람
            stroke_id: data.stroke_id.slice(0, 64), // 임시 획 ID
            points_delta: points, // 추가된 좌표
            style: cleanStyle(data.style), // 선 스타일
        }); // 다른 참여자에게 중계
    });

    socket.on('stroke:commit', async (data, ack) =>
    {
        try
        {
            const boardId = joinedBoard(socket, data); // 참여 보드 확인
            if (!boardId)
            {
                return fail(ack, 'FORBIDDEN', '참여 중인 보드가 아닙니다.'); // 보드 불일치
            }
            if (!(await auth.hasRole(socket.data.guestId, socket.data.projectId, 'editor')))
            {
                return fail(ack, 'FORBIDDEN', '편집 권한이 없습니다.'); // DB 기준 권한 재확인
            }
            const points = cleanPoints(data.points, MAX_POINTS); // 전체 좌표 검사
            if (!points)
            {
                return fail(ack, 'BAD_REQUEST', 'points 가 올바르지 않습니다.'); // 형식 오류
            }
            const style = cleanStyle(data.style); // 스타일 정리
            const box = bounds(points); // 경계 계산
            const payload = { stroke_id: typeof data.stroke_id === 'string' ? data.stroke_id.slice(0, 64) : null, points }; // 저장 본문
            const result = await db.query(
                'INSERT INTO board_objects (board_id, type, x, y, width, height, payload_json, style_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [boardId, 'stroke', box.x, box.y, box.width, box.height, JSON.stringify(payload), JSON.stringify(style)]
            ); // 확정 획 저장
            const object = { object_id: result.insertId, task_id: null, type: 'stroke', ...box, payload, style, version: 1 }; // 저장된 객체
            ok(ack, { request_id: data.request_id ?? null, object_id: object.object_id, new_version: 1, persisted: true }); // 저장 성공 응답
            socket.to(presence.roomName(boardId)).emit('object:created', { board_id: boardId, guest_id: socket.data.guestId, object }); // 다른 참여자에게 확정 객체 전송
        }
        catch (err)
        {
            console.error('stroke:commit 오류', err); // 서버 로그
            fail(ack, 'SAVE_FAILED', '획 저장에 실패했습니다.'); // 저장 실패 응답
        }
    });
}

module.exports = { register };
