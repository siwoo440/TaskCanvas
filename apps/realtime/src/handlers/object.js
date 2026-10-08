// object:create — 도형·이미지·영상·업무 블럭·메모 새 객체 확정 생성 (이동·크기·글 수정·삭제·잠금은 edit.js)
'use strict';

const db = require('../db'); // DB 접근
const auth = require('../auth'); // 권한 검사
const presence = require('../presence'); // 방 이름
const video = require('../video'); // 영상 URL 검증
const note = require('../note'); // 메모 글·스타일 검증
const { ok, fail, joinedBoard } = require('./reply'); // 응답 헬퍼

const TYPES = ['rect', 'ellipse', 'image', 'video', 'task', 'note']; // 생성 허용 객체 유형

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
            let style = cleanShapeStyle(data.style); // 스타일 정리
            let payload = {}; // 도형은 본문 없음
            let taskId = null; // 공유 업무 참조(task 유형만)
            if (data.type === 'image')
            {
                const assetId = Number(data.payload?.asset_id); // 업로드된 이미지 ID
                const asset = Number.isInteger(assetId) && assetId > 0
                    ? await db.one('SELECT asset_id, mime_type FROM media_assets WHERE asset_id = ? AND project_id = ?', [assetId, socket.data.projectId]) // 같은 프로젝트의 이미지인지 확인
                    : null;
                if (!asset)
                {
                    return fail(ack, 'BAD_REQUEST', '이 프로젝트에 업로드된 이미지가 아닙니다.'); // 이미지 검사
                }
                payload = { asset_id: asset.asset_id, url: '/api/images/' + asset.asset_id, mime_type: asset.mime_type }; // 이미지 본문(경로는 API 경유)
                style = {}; // 이미지는 스타일 없음
            }
            else if (data.type === 'video')
            {
                const parsed = video.parse(data.payload?.source_url); // 허용 서비스 URL 해석
                if (!parsed)
                {
                    return fail(ack, 'BAD_REQUEST', '허용된 영상 서비스(YouTube, Vimeo)의 URL 이 아닙니다.'); // URL 검사
                }
                payload = parsed; // provider, video_id, embed_url, source_url
                style = {}; // 영상은 스타일 없음
            }
            else if (data.type === 'task')
            {
                const id = Number(data.payload?.task_id); // 참조할 업무 ID
                const task = Number.isInteger(id) && id > 0 ? await db.one('SELECT task_id FROM tasks WHERE task_id = ? AND project_id = ?', [id, socket.data.projectId]) : null; // 같은 프로젝트의 업무인지 확인
                if (!task)
                {
                    return fail(ack, 'BAD_REQUEST', '이 프로젝트의 업무가 아닙니다.'); // 업무 검사
                }
                taskId = id; // 업무 참조 저장
                payload = {}; // 업무 내용은 tasks 원본에서 가져옴
                style = {}; // 업무 블럭은 스타일 없음
            }
            else if (data.type === 'note')
            {
                const text = note.cleanText(data.payload?.text); // 메모 글(제어 문자 제거, 길이 제한)
                if (text === null)
                {
                    return fail(ack, 'BAD_REQUEST', '메모 글은 ' + note.MAX_TEXT + '자 이하의 문자열이어야 합니다.'); // 글 검사
                }
                payload = { text }; // 메모 본문
                style = note.cleanNoteStyle(data.style); // 배경·글자 색
            }
            const result = await db.query(
                'INSERT INTO board_objects (board_id, task_id, type, x, y, width, height, payload_json, style_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [boardId, taskId, data.type, x, y, width, height, JSON.stringify(payload), JSON.stringify(style)]
            ); // 객체 저장
            const object = { object_id: result.insertId, task_id: taskId, type: data.type, x, y, width, height, payload, style, version: 1 }; // 저장된 객체
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
