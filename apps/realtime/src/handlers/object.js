// object:create — 도형 등 새 객체 확정 생성 (이동·삭제·잠금은 4단계)
'use strict';

const db = require('../db'); // DB 접근
const auth = require('../auth'); // 권한 검사
const presence = require('../presence'); // 방 이름
const { ok, fail, joinedBoard } = require('./reply'); // 응답 헬퍼

const TYPES = ['rect', 'ellipse']; // 생성 허용 객체 유형

function cleanNumber(value, fallback = 0)
{
    const n = Number(value); // 숫자 변환
    return Number.isFinite(n) ? n : fallback; // 유한수만 허용
}

function cleanShapeStyle(style)
{
    const s = style && typeof style === 'object' ? style : {}; // 객체 보정
    const hex = /^#[0-9a-fA-F]{6}$/; // 색상 형식
    return {
        stroke: typeof s.stroke === 'string' && hex.test(s.stroke) ? s.stroke : '#222222', // 테두리 색
        fill: typeof s.fill === 'string' && hex.test(s.fill) ? s.fill : null, // 채우기 색(없으면 투명)
        width: Math.min(50, Math.max(1, cleanNumber(s.width, 2))), // 테두리 굵기
    }; // 허용 스타일만 반환
}

function register(io, socket)
{
    socket.on('object:create', async (data, ack) =>
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
            if (!TYPES.includes(data?.type))
            {
                return fail(ack, 'BAD_REQUEST', '지원하지 않는 객체 유형입니다.'); // 유형 검사
            }
            const width = Math.abs(cleanNumber(data.width)); // 너비(양수 보정)
            const height = Math.abs(cleanNumber(data.height)); // 높이(양수 보정)
            if (width < 1 || height < 1)
            {
                return fail(ack, 'BAD_REQUEST', '크기가 너무 작습니다.'); // 크기 검사
            }
            const x = cleanNumber(data.x); // X 좌표
            const y = cleanNumber(data.y); // Y 좌표
            const style = cleanShapeStyle(data.style); // 스타일 정리
            const payload = {}; // 도형은 본문 없음
            const result = await db.query(
                'INSERT INTO board_objects (board_id, type, x, y, width, height, payload_json, style_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [boardId, data.type, x, y, width, height, JSON.stringify(payload), JSON.stringify(style)]
            ); // 객체 저장
            const object = { object_id: result.insertId, task_id: null, type: data.type, x, y, width, height, payload, style, version: 1 }; // 저장된 객체
            ok(ack, { request_id: data.request_id ?? null, object_id: object.object_id, new_version: 1, persisted: true, object }); // 저장 성공 응답
            socket.to(presence.roomName(boardId)).emit('object:created', { board_id: boardId, guest_id: socket.data.guestId, object }); // 다른 참여자에게 전송
        }
        catch (err)
        {
            console.error('object:create 오류', err); // 서버 로그
            fail(ack, 'SAVE_FAILED', '객체 저장에 실패했습니다.'); // 저장 실패 응답
        }
    });
}

module.exports = { register };
