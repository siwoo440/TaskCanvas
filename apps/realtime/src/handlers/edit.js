// object:lock / preview / commit / delete / unlock — 선점 잠금 기반 객체 편집
'use strict';

const db = require('../db'); // DB 접근
const auth = require('../auth'); // 권한 검사
const locks = require('../locks'); // 잠금 관리
const presence = require('../presence'); // 방 이름
const note = require('../note'); // 메모 글·스타일 검증
const { ok, fail, joinedBoard } = require('./reply'); // 응답 헬퍼

const HEX = /^#[0-9a-fA-F]{6}$/; // 색상 형식

function parseJson(value)
{
    if (value === null || value === undefined)
    {
        return null; // 값 없음
    }
    return typeof value === 'string' ? JSON.parse(value) : value; // MariaDB 문자열·MySQL JSON 모두 처리
}

function rowToObject(row)
{
    return {
        object_id: row.object_id, // 객체 ID
        task_id: row.task_id, // 업무 참조
        type: row.type, // 유형
        x: Number(row.x), // X
        y: Number(row.y), // Y
        width: Number(row.width), // 너비
        height: Number(row.height), // 높이
        payload: parseJson(row.payload_json), // 본문
        style: parseJson(row.style_json), // 스타일
        version: Number(row.version), // 버전
    }; // 클라이언트 객체 형식
}

function cleanStyle(type, style)
{
    const s = style && typeof style === 'object' ? style : {}; // 객체 보정
    if (type === 'image' || type === 'video' || type === 'task')
    {
        return {}; // 이미지·영상·업무 블럭은 스타일 없음
    }
    if (type === 'note')
    {
        return note.cleanNoteStyle(style); // 메모: 배경·글자 색
    }
    if (type === 'stroke')
    {
        return {
            color: typeof s.color === 'string' && HEX.test(s.color) ? s.color : '#222222', // 선 색
            width: Math.min(50, Math.max(1, Number(s.width) || 3)), // 선 굵기
        }; // 획 스타일
    }
    return {
        stroke: typeof s.stroke === 'string' && HEX.test(s.stroke) ? s.stroke : '#222222', // 테두리 색
        fill: typeof s.fill === 'string' && HEX.test(s.fill) ? s.fill : null, // 채우기 색
        width: Math.min(50, Math.max(1, Number(s.width) || 2)), // 테두리 굵기
    }; // 도형 스타일
}

function cleanChanges(changes, type)
{
    const c = changes && typeof changes === 'object' ? changes : {}; // 객체 보정
    const out = {}; // 허용된 변경만
    for (const key of ['x', 'y'])
    {
        if (c[key] !== undefined)
        {
            const n = Number(c[key]); // 숫자 변환
            if (!Number.isFinite(n))
            {
                return null; // 좌표 오류
            }
            out[key] = n; // 좌표 변경
        }
    }
    if (type !== 'stroke')
    {
        for (const key of ['width', 'height'])
        {
            if (c[key] !== undefined)
            {
                const n = Number(c[key]); // 숫자 변환
                if (!Number.isFinite(n) || n < 1)
                {
                    return null; // 크기 오류
                }
                out[key] = n; // 크기 변경
            }
        }
    }
    if (c.style !== undefined)
    {
        out.style = cleanStyle(type, c.style); // 스타일 변경
    }
    if (c.text !== undefined && type === 'note')
    {
        const text = note.cleanText(c.text); // 메모 글 정리
        if (text === null)
        {
            return null; // 문자열이 아니거나 너무 긴 글
        }
        out.text = text; // 메모 글 변경(메모가 아닌 객체에 보내면 무시)
    }
    return out; // 정리된 변경
}

function requireLock(socket, data, ack)
{
    const objectId = Number(data?.object_id); // 대상 객체
    if (!Number.isInteger(objectId) || objectId <= 0)
    {
        fail(ack, 'BAD_REQUEST', 'object_id 가 올바르지 않습니다.'); // 입력 검사
        return null;
    }
    const lock = locks.verify(objectId, socket.id, data?.lock_token); // 본인 잠금 확인
    if (!lock)
    {
        const other = locks.holder(objectId); // 타인 잠금 여부
        if (other)
        {
            fail(ack, 'OBJECT_LOCKED', other.display_name + ' 님이 편집 중인 객체입니다.'); // 타인 잠금
        }
        else
        {
            fail(ack, 'LOCK_REQUIRED', '먼저 object:lock 으로 잠금을 획득해야 합니다.'); // 잠금 없음
        }
        return null;
    }
    return lock; // 유효한 잠금
}

function broadcastUnlock(socket, lock, reason)
{
    socket.to(presence.roomName(lock.board_id)).emit('object:unlocked', { object_id: lock.object_id, reason }); // 해제 알림
}

function register(io, socket)
{
    socket.on('object:lock', async (data, ack) =>
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
            const objectId = Number(data.object_id); // 대상 객체
            if (!Number.isInteger(objectId) || objectId <= 0)
            {
                return fail(ack, 'BAD_REQUEST', 'object_id 가 올바르지 않습니다.'); // 입력 검사
            }
            const row = await db.one('SELECT object_id FROM board_objects WHERE object_id = ? AND board_id = ?', [objectId, boardId]); // 보드 내 객체 확인
            if (!row)
            {
                return fail(ack, 'NOT_FOUND', '객체를 찾을 수 없습니다.'); // 객체 없음
            }
            const result = locks.acquire(objectId, boardId, socket); // 잠금 시도
            if (!result.ok)
            {
                if (typeof ack === 'function')
                {
                    ack({ ok: false, error: { code: 'OBJECT_LOCKED', message: result.lock.display_name + ' 님이 편집 중인 객체입니다.', locked_by: locks.publicInfo(result.lock) } }); // 잠금 실패 응답
                }
                return;
            }
            socket.to(presence.roomName(boardId)).emit('object:locked', locks.publicInfo(result.lock)); // 잠금 알림
            ok(ack, { object_id: objectId, lock_token: result.lock.token, expires_in: Math.round(locks.TTL_MS / 1000) }); // 잠금 응답
        }
        catch (err)
        {
            console.error('object:lock 오류', err); // 서버 로그
            fail(ack, 'INTERNAL_ERROR', '잠금 처리 중 오류가 발생했습니다.'); // 오류 응답
        }
    });

    socket.on('object:preview', (data) =>
    {
        const boardId = joinedBoard(socket, data); // 참여 보드 확인
        if (!boardId)
        {
            return; // 미참여 무시
        }
        const lock = locks.verify(Number(data.object_id), socket.id, data.lock_token); // 본인 잠금 확인
        const x = Number(data.x); // 미리보기 X
        const y = Number(data.y); // 미리보기 Y
        if (!lock || !Number.isFinite(x) || !Number.isFinite(y))
        {
            return; // 잠금 없음·좌표 오류 무시
        }
        const preview = { object_id: lock.object_id, guest_id: socket.data.guestId, x, y }; // 이동 중 위치
        const width = Number(data.width); // 크기 조절 중 너비(선택)
        const height = Number(data.height); // 크기 조절 중 높이(선택)
        if (Number.isFinite(width) && Number.isFinite(height) && width >= 1 && height >= 1)
        {
            preview.width = width; // 크기 조절 미리보기 너비
            preview.height = height; // 크기 조절 미리보기 높이
        }
        socket.to(presence.roomName(boardId)).volatile.emit('object:preview', preview); // 이동·크기 조절 중 상태 중계
    });

    socket.on('object:commit', async (data, ack) =>
    {
        let conn = null; // 트랜잭션 연결
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
            const lock = requireLock(socket, data, ack); // 잠금 확인
            if (!lock)
            {
                return;
            }
            const version = Number(data.version); // 클라이언트가 아는 버전
            if (!Number.isInteger(version) || version < 1)
            {
                return fail(ack, 'BAD_REQUEST', 'version 이 올바르지 않습니다.'); // 버전 검사
            }
            conn = await db.pool.getConnection(); // 연결 확보
            await conn.beginTransaction(); // 트랜잭션 시작
            const [rows] = await conn.execute('SELECT * FROM board_objects WHERE object_id = ? AND board_id = ? FOR UPDATE', [lock.object_id, boardId]); // 행 잠금 조회
            if (rows.length === 0)
            {
                await conn.rollback(); // 되돌림
                locks.release(lock.object_id, socket.id); // 잠금 해제
                broadcastUnlock(socket, lock, 'missing'); // 해제 알림
                return fail(ack, 'NOT_FOUND', '객체가 이미 삭제되었습니다.'); // 객체 없음
            }
            const current = rowToObject(rows[0]); // 현재 객체
            if (current.version !== version)
            {
                await conn.rollback(); // 되돌림
                locks.release(lock.object_id, socket.id); // 잠금 해제(재동기화 유도)
                broadcastUnlock(socket, lock, 'conflict'); // 해제 알림
                if (typeof ack === 'function')
                {
                    ack({ ok: false, error: { code: 'VERSION_CONFLICT', message: '다른 사용자가 먼저 수정했습니다. 최신 상태를 다시 불러옵니다.' }, object: current }); // 충돌 응답(최신 객체 포함)
                }
                return;
            }
            const changes = cleanChanges(data.changes, current.type); // 변경 정리
            if (!changes)
            {
                await conn.rollback(); // 되돌림
                return fail(ack, 'BAD_REQUEST', 'changes 가 올바르지 않습니다.'); // 형식 오류
            }
            const { text, ...fields } = changes; // 메모 글은 본문(payload)으로, 나머지는 객체 필드로 적용
            const next = { ...current, ...fields, version: current.version + 1 }; // 적용 결과
            if (text !== undefined)
            {
                next.payload = { ...(current.payload || {}), text }; // 메모 글 갱신
            }
            if (current.type === 'stroke' && (changes.x !== undefined || changes.y !== undefined))
            {
                const dx = next.x - current.x; // X 이동량
                const dy = next.y - current.y; // Y 이동량
                const points = ((current.payload && current.payload.points) || []).map(([px, py]) => [px + dx, py + dy]); // 획 좌표 평행 이동
                next.payload = { ...(current.payload || {}), points }; // 본문 갱신
            }
            await conn.execute(
                'UPDATE board_objects SET x = ?, y = ?, width = ?, height = ?, payload_json = ?, style_json = ?, version = ? WHERE object_id = ? AND version = ?',
                [next.x, next.y, next.width, next.height, JSON.stringify(next.payload ?? {}), JSON.stringify(next.style ?? {}), next.version, lock.object_id, current.version]
            ); // 변경 저장
            await conn.commit(); // 트랜잭션 확정
            locks.release(lock.object_id, socket.id); // 잠금 해제
            ok(ack, { request_id: data.request_id ?? null, object_id: lock.object_id, new_version: next.version, persisted: true, object: next }); // 저장 성공 응답
            socket.to(presence.roomName(boardId)).emit('object:updated', { board_id: boardId, guest_id: socket.data.guestId, object: next }); // 변경 전파
            broadcastUnlock(socket, lock, 'committed'); // 해제 알림
        }
        catch (err)
        {
            if (conn)
            {
                await conn.rollback().catch(() => {}); // 실패 시 되돌림
            }
            console.error('object:commit 오류', err); // 서버 로그
            fail(ack, 'SAVE_FAILED', '객체 저장에 실패했습니다.'); // 저장 실패 응답
        }
        finally
        {
            if (conn)
            {
                conn.release(); // 연결 반환
            }
        }
    });

    socket.on('object:delete', async (data, ack) =>
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
            const lock = requireLock(socket, data, ack); // 잠금 확인
            if (!lock)
            {
                return;
            }
            const version = Number(data.version); // 클라이언트가 아는 버전
            const result = await db.query('DELETE FROM board_objects WHERE object_id = ? AND board_id = ? AND version = ?', [lock.object_id, boardId, version]); // 버전 일치 시 삭제
            locks.release(lock.object_id, socket.id); // 잠금 해제
            broadcastUnlock(socket, lock, 'deleted'); // 해제 알림
            if (result.affectedRows !== 1)
            {
                const exists = await db.one('SELECT version FROM board_objects WHERE object_id = ?', [lock.object_id]); // 존재 여부
                return fail(ack, exists ? 'VERSION_CONFLICT' : 'NOT_FOUND', exists ? '다른 사용자가 먼저 수정했습니다. 최신 상태를 다시 불러옵니다.' : '객체가 이미 삭제되었습니다.'); // 충돌·없음
            }
            ok(ack, { request_id: data.request_id ?? null, object_id: lock.object_id, persisted: true }); // 삭제 성공 응답
            socket.to(presence.roomName(boardId)).emit('object:deleted', { board_id: boardId, guest_id: socket.data.guestId, object_id: lock.object_id }); // 삭제 전파
        }
        catch (err)
        {
            console.error('object:delete 오류', err); // 서버 로그
            fail(ack, 'SAVE_FAILED', '객체 삭제에 실패했습니다.'); // 실패 응답
        }
    });

    socket.on('object:unlock', (data, ack) =>
    {
        const boardId = joinedBoard(socket, data); // 참여 보드 확인
        if (!boardId)
        {
            return fail(ack, 'FORBIDDEN', '참여 중인 보드가 아닙니다.'); // 보드 불일치
        }
        const lock = locks.verify(Number(data.object_id), socket.id, data.lock_token); // 본인 잠금 확인
        if (lock)
        {
            locks.release(lock.object_id, socket.id); // 잠금 해제
            broadcastUnlock(socket, lock, 'released'); // 해제 알림
        }
        ok(ack, { object_id: Number(data.object_id) }); // 해제 응답(이미 없어도 성공)
    });

    socket.on('disconnect', () =>
    {
        for (const lock of locks.releaseAllBySocket(socket.id))
        {
            io.to(presence.roomName(lock.board_id)).emit('object:unlocked', { object_id: lock.object_id, reason: 'disconnected' }); // 연결 종료 시 잠금 해제 알림
        }
    });
}

module.exports = { register };
