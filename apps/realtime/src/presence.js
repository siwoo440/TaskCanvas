// 보드별 참여자 목록과 커서 색상 관리 (메모리, DB 기록 없음)
'use strict';

const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1', '#6d4c41', '#c0ca33']; // 참여자 구분 색상
const rooms = new Map(); // board_id → Map(socket.id → participant)

function roomName(boardId)
{
    return `board:${boardId}`; // Socket.IO 방 이름
}

function add(boardId, socketId, guest)
{
    if (!rooms.has(boardId))
    {
        rooms.set(boardId, new Map()); // 보드 방 생성
    }
    const members = rooms.get(boardId); // 보드 참여자 목록
    const used = new Set([...members.values()].map((p) => p.color)); // 사용 중인 색상
    const color = COLORS.find((c) => !used.has(c)) ?? COLORS[members.size % COLORS.length]; // 비어 있는 색상 선택
    const participant = { socket_id: socketId, guest_id: guest.guest_id, display_name: guest.display_name, role: guest.role, color }; // 참여자 정보
    members.set(socketId, participant); // 목록 등록
    return participant; // 등록된 참여자
}

function remove(boardId, socketId)
{
    const members = rooms.get(boardId); // 보드 참여자 목록
    if (!members)
    {
        return;
    }
    members.delete(socketId); // 목록 제거
    if (members.size === 0)
    {
        rooms.delete(boardId); // 빈 방 정리
    }
}

function list(boardId)
{
    const members = rooms.get(boardId); // 보드 참여자 목록
    return members ? [...members.values()].map(({ socket_id, ...rest }) => rest) : []; // socket_id 를 뺀 공개 정보
}

module.exports = { roomName, add, remove, list };
