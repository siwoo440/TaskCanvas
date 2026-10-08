// 객체 선점 잠금 (메모리, TTL 만료·연결 종료 시 해제, DB 기록 없음)
'use strict';

const crypto = require('crypto'); // 토큰 생성
const env = require('./env'); // 설정 값
const presence = require('./presence'); // 방 이름

const TTL_MS = env.int('LOCK_TTL_MS') || 30000; // 잠금 유효 시간
const locks = new Map(); // object_id → {object_id, board_id, socket_id, guest_id, display_name, color, token, expires_at}

function publicInfo(lock)
{
    return { object_id: lock.object_id, guest_id: lock.guest_id, display_name: lock.display_name, color: lock.color }; // 다른 참여자에게 공개할 정보
}

function acquire(objectId, boardId, socket)
{
    const now = Date.now(); // 현재 시각
    const current = locks.get(objectId); // 기존 잠금
    if (current && current.expires_at > now && current.socket_id !== socket.id)
    {
        return { ok: false, lock: current }; // 다른 연결이 보유 중
    }
    const lock = current && current.socket_id === socket.id && current.expires_at > now
        ? current // 본인 잠금 재사용
        : {
            object_id: objectId, // 객체 ID
            board_id: boardId, // 보드 ID
            socket_id: socket.id, // 소유 연결
            guest_id: socket.data.guestId, // 소유 게스트
            display_name: socket.data.displayName, // 소유자 이름
            color: socket.data.color, // 소유자 색상
            token: crypto.randomBytes(16).toString('hex'), // 잠금 토큰
        }; // 새 잠금
    lock.expires_at = now + TTL_MS; // 만료 시각 갱신
    locks.set(objectId, lock); // 잠금 저장
    return { ok: true, lock }; // 획득 성공
}

function verify(objectId, socketId, token)
{
    const lock = locks.get(objectId); // 현재 잠금
    if (!lock || lock.socket_id !== socketId || lock.token !== token || lock.expires_at <= Date.now())
    {
        return null; // 없음·타인·토큰 불일치·만료
    }
    lock.expires_at = Date.now() + TTL_MS; // 사용 시 만료 연장
    return lock; // 유효한 본인 잠금
}

function holder(objectId)
{
    const lock = locks.get(objectId); // 현재 잠금
    return lock && lock.expires_at > Date.now() ? lock : null; // 유효한 잠금만
}

function release(objectId, socketId)
{
    const lock = locks.get(objectId); // 현재 잠금
    if (!lock || (socketId && lock.socket_id !== socketId))
    {
        return null; // 없거나 타인 소유
    }
    locks.delete(objectId); // 잠금 제거
    return lock; // 해제된 잠금
}

function releaseAllBySocket(socketId)
{
    const released = []; // 해제 목록
    for (const [objectId, lock] of locks)
    {
        if (lock.socket_id === socketId)
        {
            locks.delete(objectId); // 잠금 제거
            released.push(lock); // 목록 추가
        }
    }
    return released; // 해제된 잠금들
}

function listForBoard(boardId)
{
    const now = Date.now(); // 현재 시각
    return [...locks.values()].filter((l) => l.board_id === boardId && l.expires_at > now).map(publicInfo); // 보드의 유효 잠금
}

function startSweeper(io)
{
    setInterval(() =>
    {
        const now = Date.now(); // 현재 시각
        for (const [objectId, lock] of locks)
        {
            if (lock.expires_at <= now)
            {
                locks.delete(objectId); // 만료 잠금 제거
                io.to(presence.roomName(lock.board_id)).emit('object:unlocked', { object_id: objectId, reason: 'expired' }); // 해제 알림
            }
        }
    }, 5000); // 5초마다 만료 검사
}

module.exports = { TTL_MS, publicInfo, acquire, verify, holder, release, releaseAllBySocket, listForBoard, startSweeper };
