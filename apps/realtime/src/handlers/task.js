// task:create / task:update — 보드와 독립된 공유 업무 원본. 변경은 프로젝트의 모든 보드와 작업실에 전파
'use strict';

const db = require('../db'); // DB 접근
const auth = require('../auth'); // 권한 검사
const { ok, fail, joinedProject } = require('./reply'); // 응답 헬퍼

const STATUSES = ['todo', 'doing', 'done']; // 허용 상태
const DATE = /^\d{4}-\d{2}-\d{2}$/; // 마감일 형식

function projectRoom(projectId)
{
    return 'project:' + projectId; // 프로젝트 단위 방 이름(모든 보드 참여자 포함)
}

function rowToTask(row)
{
    return {
        task_id: row.task_id, // 업무 ID
        project_id: row.project_id, // 프로젝트 ID
        title: row.title, // 제목
        description: row.description, // 설명
        status: row.status, // 상태
        assignee_id: row.assignee_id, // 담당 게스트
        assignee_name: row.assignee_name ?? null, // 담당자 이름
        due_at: row.due_at ? String(row.due_at).slice(0, 10) : null, // 마감일(YYYY-MM-DD)
        version: Number(row.version), // 버전
    }; // 클라이언트 업무 형식
}

async function loadTask(taskId, executor = db)
{
    const sql = `SELECT t.*, g.display_name AS assignee_name FROM tasks t LEFT JOIN guests g ON g.guest_id = t.assignee_id WHERE t.task_id = ?`; // 담당자 이름 포함 조회
    if (executor === db)
    {
        const row = await db.one(sql, [taskId]); // 풀로 조회
        return row ? rowToTask(row) : null;
    }
    const [rows] = await executor.execute(sql + ' FOR UPDATE', [taskId]); // 트랜잭션 연결로 행 잠금 조회
    return rows.length > 0 ? rowToTask(rows[0]) : null;
}

async function cleanFields(data, projectId, partial)
{
    const c = data && typeof data === 'object' ? data : {}; // 객체 보정
    const out = {}; // 정리된 필드
    if (!partial || c.title !== undefined)
    {
        const title = typeof c.title === 'string' ? c.title.trim() : ''; // 제목
        if (title === '' || title.length > 180)
        {
            return { error: '업무 제목은 1~180자여야 합니다.' }; // 제목 검사
        }
        out.title = title; // 제목 적용
    }
    if (c.description !== undefined)
    {
        out.description = typeof c.description === 'string' ? c.description.slice(0, 2000) : null; // 설명(선택)
    }
    if (!partial || c.status !== undefined)
    {
        const status = c.status === undefined ? 'todo' : c.status; // 상태(기본 todo)
        if (!STATUSES.includes(status))
        {
            return { error: '상태는 todo·doing·done 중 하나여야 합니다.' }; // 상태 검사
        }
        out.status = status; // 상태 적용
    }
    if (c.assignee_id !== undefined)
    {
        if (c.assignee_id === null || c.assignee_id === '')
        {
            out.assignee_id = null; // 담당자 해제
        }
        else
        {
            const guestId = Number(c.assignee_id); // 담당자 ID
            const member = Number.isInteger(guestId) ? await db.one('SELECT guest_id FROM project_members WHERE project_id = ? AND guest_id = ?', [projectId, guestId]) : null; // 프로젝트 참여자인지 확인
            if (!member)
            {
                return { error: '담당자는 이 프로젝트의 참여자여야 합니다.' }; // 담당자 검사
            }
            out.assignee_id = guestId; // 담당자 적용
        }
    }
    if (c.due_at !== undefined)
    {
        if (c.due_at === null || c.due_at === '')
        {
            out.due_at = null; // 마감일 해제
        }
        else if (typeof c.due_at === 'string' && DATE.test(c.due_at))
        {
            out.due_at = c.due_at + ' 00:00:00'; // 마감일 적용
        }
        else
        {
            return { error: '마감일은 YYYY-MM-DD 형식이어야 합니다.' }; // 마감일 검사
        }
    }
    return { fields: out }; // 정리 결과
}

function register(io, socket)
{
    socket.on('task:create', async (data, ack) =>
    {
        try
        {
            if (!joinedProject(socket, data))
            {
                return fail(ack, 'FORBIDDEN', '참여 중인 보드나 작업실이 아닙니다.'); // 미참여·보드 불일치
            }
            if (!(await auth.hasRole(socket.data.guestId, socket.data.projectId, 'editor')))
            {
                return fail(ack, 'FORBIDDEN', '편집 권한이 없습니다.'); // DB 기준 권한 재확인
            }
            const cleaned = await cleanFields(data, socket.data.projectId, false); // 필드 검사
            if (cleaned.error)
            {
                return fail(ack, 'BAD_REQUEST', cleaned.error); // 입력 오류
            }
            const f = cleaned.fields; // 정리된 필드
            const result = await db.query(
                'INSERT INTO tasks (project_id, title, description, status, assignee_id, due_at) VALUES (?, ?, ?, ?, ?, ?)',
                [socket.data.projectId, f.title, f.description ?? null, f.status, f.assignee_id ?? null, f.due_at ?? null]
            ); // 업무 원본 생성
            const task = await loadTask(result.insertId); // 생성 결과
            ok(ack, { request_id: data.request_id ?? null, task }); // 생성 응답
            socket.to(projectRoom(socket.data.projectId)).emit('task:created', { task, guest_id: socket.data.guestId }); // 프로젝트의 모든 보드와 작업실에 전파
        }
        catch (err)
        {
            console.error('task:create 오류', err); // 서버 로그
            fail(ack, 'SAVE_FAILED', '업무 생성에 실패했습니다.'); // 실패 응답
        }
    });

    socket.on('task:update', async (data, ack) =>
    {
        let conn = null; // 트랜잭션 연결
        try
        {
            if (!joinedProject(socket, data))
            {
                return fail(ack, 'FORBIDDEN', '참여 중인 보드나 작업실이 아닙니다.'); // 미참여·보드 불일치
            }
            if (!(await auth.hasRole(socket.data.guestId, socket.data.projectId, 'editor')))
            {
                return fail(ack, 'FORBIDDEN', '편집 권한이 없습니다.'); // DB 기준 권한 재확인
            }
            const taskId = Number(data.task_id); // 대상 업무
            const version = Number(data.version); // 클라이언트가 아는 버전
            if (!Number.isInteger(taskId) || taskId <= 0 || !Number.isInteger(version) || version < 1)
            {
                return fail(ack, 'BAD_REQUEST', 'task_id 또는 version 이 올바르지 않습니다.'); // 입력 검사
            }
            const cleaned = await cleanFields(data.changes, socket.data.projectId, true); // 변경 필드 검사
            if (cleaned.error)
            {
                return fail(ack, 'BAD_REQUEST', cleaned.error); // 입력 오류
            }
            if (Object.keys(cleaned.fields).length === 0)
            {
                return fail(ack, 'BAD_REQUEST', '변경할 내용이 없습니다.'); // 빈 변경
            }
            conn = await db.pool.getConnection(); // 연결 확보
            await conn.beginTransaction(); // 트랜잭션 시작
            const current = await loadTask(taskId, conn); // 현재 업무(행 잠금)
            if (!current || current.project_id !== socket.data.projectId)
            {
                await conn.rollback(); // 되돌림
                return fail(ack, 'NOT_FOUND', '업무를 찾을 수 없습니다.'); // 없음·타 프로젝트
            }
            if (current.version !== version)
            {
                await conn.rollback(); // 되돌림
                if (typeof ack === 'function')
                {
                    ack({ ok: false, error: { code: 'VERSION_CONFLICT', message: '다른 사용자가 먼저 수정했습니다. 최신 업무 상태를 다시 불러옵니다.' }, task: current }); // 충돌 응답(최신 업무 포함)
                }
                return;
            }
            const f = cleaned.fields; // 변경 필드
            const sets = Object.keys(f).map((k) => k + ' = ?'); // SET 절
            await conn.execute('UPDATE tasks SET ' + sets.join(', ') + ', version = version + 1 WHERE task_id = ? AND version = ?', [...Object.values(f), taskId, version]); // 변경 저장
            await conn.commit(); // 트랜잭션 확정
            const task = await loadTask(taskId); // 저장 결과
            ok(ack, { request_id: data.request_id ?? null, task }); // 변경 응답
            socket.to(projectRoom(socket.data.projectId)).emit('task:updated', { task, guest_id: socket.data.guestId }); // 같은 프로젝트의 모든 보드와 작업실에 전파
        }
        catch (err)
        {
            if (conn)
            {
                await conn.rollback().catch(() => {}); // 실패 시 되돌림
            }
            console.error('task:update 오류', err); // 서버 로그
            fail(ack, 'SAVE_FAILED', '업무 저장에 실패했습니다.'); // 실패 응답
        }
        finally
        {
            if (conn)
            {
                conn.release(); // 연결 반환
            }
        }
    });
}

module.exports = { register, projectRoom, STATUSES };
