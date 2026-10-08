// 실시간 티켓 검증과 보드 권한 조회
'use strict';

const crypto = require('crypto'); // 해시 계산
const db = require('./db'); // DB 접근

const RANK = { viewer: 1, editor: 2, admin: 3 }; // 역할 우선순위

function hash(secret)
{
    return crypto.createHash('sha256').update(secret).digest('hex'); // PHP 와 동일한 SHA-256 해시
}

async function consumeTicket(ticket, boardId)
{
    if (typeof ticket !== 'string' || ticket.length < 16)
    {
        return null; // 형식 오류
    }
    const ticketHash = hash(ticket); // 티켓 해시
    const result = await db.query(
        'UPDATE realtime_tickets SET used_at = NOW() WHERE ticket_hash = ? AND board_id = ? AND expires_at > NOW() AND used_at IS NULL',
        [ticketHash, boardId]
    ); // 일회성 사용 처리(원자적 갱신)
    if (result.affectedRows !== 1)
    {
        return null; // 없음·만료·재사용
    }
    return db.one(
        `SELECT t.guest_id, g.display_name, b.board_id, b.project_id, m.role
           FROM realtime_tickets t
           JOIN guests g ON g.guest_id = t.guest_id
           JOIN boards b ON b.board_id = t.board_id
           JOIN project_members m ON m.project_id = b.project_id AND m.guest_id = t.guest_id
          WHERE t.ticket_hash = ?`,
        [ticketHash]
    ); // 티켓 주인의 게스트·보드·역할 조회
}

async function currentRole(guestId, projectId)
{
    const row = await db.one('SELECT role FROM project_members WHERE project_id = ? AND guest_id = ?', [projectId, guestId]); // 최신 멤버십 조회
    return row ? row.role : null; // 역할 또는 null
}

async function hasRole(guestId, projectId, minimumRole)
{
    const role = await currentRole(guestId, projectId); // 현재 역할
    return role !== null && (RANK[role] ?? 0) >= (RANK[minimumRole] ?? 99); // 권한 충족 여부
}

module.exports = { hash, consumeTicket, currentRole, hasRole };
