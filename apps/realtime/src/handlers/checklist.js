// checklist:add / update / delete — 공유 업무의 세부 항목(체크리스트). 바뀐 업무 전체를 task:updated 로 프로젝트의 모든 보드와 작업실에 전파
// 항목은 하나씩 따로 저장한다. 업무의 version 은 올리지 않으므로 서로 다른 항목을 동시에 고쳐도, 누가 제목·상태를 고치는 중이어도 충돌하지 않는다
'use strict';

const db = require('../db'); // DB 접근
const auth = require('../auth'); // 권한 검사
const { loadTask, projectRoom } = require('./task'); // 업무 조회·프로젝트 방 이름
const { ok, fail, joinedProject } = require('./reply'); // 응답 헬퍼

const MAX_ITEMS = 30; // 업무 하나에 둘 수 있는 항목 수
const MAX_TITLE = 120; // 항목 이름 길이

function isId(value)
{
    return Number.isInteger(value) && value > 0; // 업무·항목 번호는 양의 정수
}

// 항목 이름: 줄바꿈 같은 제어 문자는 빈칸으로 바꾸고 앞뒤 공백을 뗀다. 비었거나 너무 길면 null
function cleanTitle(value)
{
    if (typeof value !== 'string')
    {
        return null; // 글이 아님
    }
    const title = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim(); // 한 줄로 정리
    return title === '' || title.length > MAX_TITLE ? null : title; // 길이 검사
}

// 공통 검사: 참여한 보드·작업실인지, 편집 권한이 있는지, 업무가 이 프로젝트의 것인지. 통과하면 업무 번호, 아니면 거절 응답을 보내고 null
async function guard(socket, data, ack)
{
    if (!joinedProject(socket, data))
    {
        fail(ack, 'FORBIDDEN', '참여 중인 보드나 작업실이 아닙니다.'); // 미참여·보드 불일치
        return null;
    }
    if (!(await auth.hasRole(socket.data.guestId, socket.data.projectId, 'editor')))
    {
        fail(ack, 'FORBIDDEN', '편집 권한이 없습니다.'); // DB 기준 권한 재확인
        return null;
    }
    const taskId = data.task_id; // 대상 업무
    if (!isId(taskId))
    {
        fail(ack, 'BAD_REQUEST', 'task_id 가 올바르지 않습니다.'); // 입력 검사
        return null;
    }
    const owner = await db.one('SELECT project_id FROM tasks WHERE task_id = ?', [taskId]); // 업무가 속한 프로젝트
    if (!owner || Number(owner.project_id) !== socket.data.projectId)
    {
        fail(ack, 'NOT_FOUND', '업무를 찾을 수 없습니다.'); // 없음·타 프로젝트
        return null;
    }
    return taskId; // 검사 통과
}

// 저장한 뒤의 업무(체크리스트 포함)를 요청한 사람에게 돌려주고 나머지 참여자에게 알린다
async function publish(socket, ack, taskId, extra = {})
{
    const task = await loadTask(taskId); // 저장 결과
    ok(ack, { task, ...extra }); // 응답
    socket.to(projectRoom(socket.data.projectId)).emit('task:updated', { task, guest_id: socket.data.guestId }); // 같은 프로젝트의 모든 보드와 작업실에 전파
}

function register(io, socket)
{
    socket.on('checklist:add', async (data, ack) =>
    {
        let conn = null; // 트랜잭션 연결
        try
        {
            const taskId = await guard(socket, data, ack); // 공통 검사
            if (taskId === null)
            {
                return;
            }
            const title = cleanTitle(data.title); // 항목 이름
            if (title === null)
            {
                return fail(ack, 'BAD_REQUEST', '항목 이름은 1~' + MAX_TITLE + '자여야 합니다.'); // 입력 오류
            }
            conn = await db.pool.getConnection(); // 연결 확보
            await conn.beginTransaction(); // 트랜잭션 시작
            await conn.execute('SELECT task_id FROM tasks WHERE task_id = ? FOR UPDATE', [taskId]); // 업무 행을 잠가 개수 검사와 추가를 한 사람씩 처리
            const [counted] = await conn.execute('SELECT COUNT(*) AS n FROM task_items WHERE task_id = ?', [taskId]); // 지금 항목 수
            if (Number(counted[0].n) >= MAX_ITEMS)
            {
                await conn.rollback(); // 되돌림
                return fail(ack, 'BAD_REQUEST', '체크리스트 항목은 업무마다 ' + MAX_ITEMS + '개까지 둘 수 있습니다.'); // 개수 제한
            }
            const [inserted] = await conn.execute('INSERT INTO task_items (task_id, title) VALUES (?, ?)', [taskId, title]); // 항목 추가(완료하지 않은 상태로)
            await conn.commit(); // 트랜잭션 확정
            conn.release(); // 결과를 다시 읽기 전에 연결을 돌려줌(연결을 쥔 채 풀에서 하나를 더 기다리면 요청이 한꺼번에 몰릴 때 서로 막힘)
            conn = null; // finally 에서 다시 돌려주지 않게
            await publish(socket, ack, taskId, { item_id: inserted.insertId }); // 응답·전파
        }
        catch (err)
        {
            if (conn)
            {
                await conn.rollback().catch(() => {}); // 실패 시 되돌림
            }
            console.error('checklist:add 오류', err); // 서버 로그
            fail(ack, 'SAVE_FAILED', '항목을 추가하지 못했습니다.'); // 실패 응답
        }
        finally
        {
            if (conn)
            {
                conn.release(); // 연결 반환
            }
        }
    });

    socket.on('checklist:update', async (data, ack) =>
    {
        try
        {
            const taskId = await guard(socket, data, ack); // 공통 검사
            if (taskId === null)
            {
                return;
            }
            const changes = data.changes && typeof data.changes === 'object' ? data.changes : {}; // 바꿀 내용
            const sets = []; // SET 절
            const values = []; // 바인딩 값
            if (changes.title !== undefined)
            {
                const title = cleanTitle(changes.title); // 새 이름
                if (title === null)
                {
                    return fail(ack, 'BAD_REQUEST', '항목 이름은 1~' + MAX_TITLE + '자여야 합니다.'); // 입력 오류
                }
                sets.push('title = ?'); // 이름 변경
                values.push(title);
            }
            if (changes.done !== undefined)
            {
                if (typeof changes.done !== 'boolean')
                {
                    return fail(ack, 'BAD_REQUEST', 'done 은 true 또는 false 여야 합니다.'); // 입력 오류
                }
                sets.push('is_done = ?'); // 체크·해제
                values.push(changes.done ? 1 : 0);
            }
            if (!isId(data.item_id) || sets.length === 0)
            {
                return fail(ack, 'BAD_REQUEST', '항목 번호나 바꿀 내용이 올바르지 않습니다.'); // 입력 검사
            }
            const item = await db.one('SELECT item_id FROM task_items WHERE item_id = ? AND task_id = ?', [data.item_id, taskId]); // 이 업무의 항목인지
            if (!item)
            {
                return fail(ack, 'NOT_FOUND', '항목을 찾을 수 없습니다. 다른 사람이 지웠을 수 있습니다.'); // 없음·다른 업무의 항목
            }
            await db.query('UPDATE task_items SET ' + sets.join(', ') + ' WHERE item_id = ? AND task_id = ?', [...values, data.item_id, taskId]); // 항목 저장
            await publish(socket, ack, taskId); // 응답·전파
        }
        catch (err)
        {
            console.error('checklist:update 오류', err); // 서버 로그
            fail(ack, 'SAVE_FAILED', '항목을 저장하지 못했습니다.'); // 실패 응답
        }
    });

    socket.on('checklist:delete', async (data, ack) =>
    {
        try
        {
            const taskId = await guard(socket, data, ack); // 공통 검사
            if (taskId === null)
            {
                return;
            }
            if (!isId(data.item_id))
            {
                return fail(ack, 'BAD_REQUEST', 'item_id 가 올바르지 않습니다.'); // 입력 검사
            }
            const result = await db.query('DELETE FROM task_items WHERE item_id = ? AND task_id = ?', [data.item_id, taskId]); // 항목 삭제
            if (result.affectedRows === 0)
            {
                return fail(ack, 'NOT_FOUND', '항목을 찾을 수 없습니다. 다른 사람이 이미 지웠을 수 있습니다.'); // 없음·다른 업무의 항목
            }
            await publish(socket, ack, taskId); // 응답·전파
        }
        catch (err)
        {
            console.error('checklist:delete 오류', err); // 서버 로그
            fail(ack, 'SAVE_FAILED', '항목을 지우지 못했습니다.'); // 실패 응답
        }
    });
}

module.exports = { register, MAX_ITEMS, MAX_TITLE };
