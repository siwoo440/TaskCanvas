// selection:set — 내가 선택한 객체·연결선을 다른 참여자에게 알림 (표시용, DB 기록 없음)
'use strict';

const presence = require('../presence'); // 참여자 목록(선택 기억)·방 이름
const { ok, fail, joinedBoard } = require('./reply'); // 응답 헬퍼

const MAX_IDS = 200; // 한 번에 알릴 수 있는 객체 수(영역 선택으로 한꺼번에 고르는 경우를 넉넉히 덮음)

function isId(value)
{
    return Number.isInteger(value) && value > 0; // 객체·연결선 번호는 양의 정수
}

function register(io, socket)
{
    socket.on('selection:set', (data, ack) =>
    {
        const boardId = joinedBoard(socket, data); // 참여 보드 확인
        if (!boardId)
        {
            return fail(ack, 'FORBIDDEN', '참여 중인 보드가 아닙니다.'); // 보드 불일치
        }
        const ids = data.object_ids; // 선택한 객체 번호들
        const linkId = data.link_id ?? null; // 선택한 연결선 번호(없으면 null)
        if (!Array.isArray(ids) || ids.length > MAX_IDS || !ids.every(isId) || (linkId !== null && !isId(linkId)))
        {
            return fail(ack, 'BAD_REQUEST', '선택 정보가 올바르지 않습니다.'); // 형식 검사(번호 목록과 연결선 번호만 받음)
        }
        const selection = { object_ids: [...new Set(ids)], link_id: linkId }; // 중복을 뺀 선택(이 보드에 없는 번호는 받는 화면에서 그려지지 않음)
        presence.setSelection(boardId, socket.id, selection); // 나중에 들어온 사람도 볼 수 있게 참여자 목록에 기억
        socket.to(presence.roomName(boardId)).emit('selection:update', {
            guest_id: socket.data.guestId, // 선택한 사람
            display_name: socket.data.displayName, // 표시 이름
            color: socket.data.color, // 그 사람의 색(커서와 같음)
            ...selection, // 선택한 객체들과 연결선
        }); // 다른 참여자에게 전달
        ok(ack, {}); // 처리 완료
    });
}

module.exports = { register, MAX_IDS };
