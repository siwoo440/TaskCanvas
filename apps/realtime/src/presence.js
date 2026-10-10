// 보드별 참여자 목록과 커서 색상·마지막 커서 위치·선택 관리 (메모리, DB 기록 없음)
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
    const participant = { socket_id: socketId, guest_id: guest.guest_id, display_name: guest.display_name, role: guest.role, color, cursor: null, selection: { object_ids: [], link_id: null } }; // 참여자 정보(cursor: 마지막으로 알려 온 커서 위치, selection: 지금 선택한 객체·연결선)
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

// 참여자의 마지막 커서 위치를 기억한다(뒤늦게 들어온 사람도 "따라가기"로 그 자리를 찾아갈 수 있게)
function setCursor(boardId, socketId, x, y)
{
    const participant = rooms.get(boardId)?.get(socketId); // 해당 참여자
    if (participant)
    {
        participant.cursor = { x, y }; // 마지막 위치
    }
}

// 참여자가 지금 선택한 객체·연결선을 기억한다(뒤늦게 들어온 사람의 화면에도 누가 무엇을 골랐는지 보이게)
function setSelection(boardId, socketId, selection)
{
    const participant = rooms.get(boardId)?.get(socketId); // 해당 참여자
    if (participant)
    {
        participant.selection = selection; // 현재 선택
    }
}

function list(boardId)
{
    const members = rooms.get(boardId); // 보드 참여자 목록
    return members ? [...members.values()].map(({ socket_id, ...rest }) => rest) : []; // socket_id 를 뺀 공개 정보
}

function activeBoardIds()
{
    return [...rooms.keys()]; // 참여자가 한 명이라도 있는 보드 ID
}

module.exports = { roomName, add, remove, list, activeBoardIds, setCursor, setSelection };
