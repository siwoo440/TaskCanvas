'use strict'; // 엄격한 검사
const fs = require('fs'); // 스키마 읽기
const path = require('path'); // 저장소 경로
const crypto = require('crypto'); // 고유 DB 이름
const assert = require('assert/strict'); // 실제 기대값
const mysql = require('mysql2/promise'); // 실제 DB 연결
const settings = require('../src/env'); // 개발 접속 설정
const databaseName = 'taskcanvas_d33_' + crypto.randomBytes(8).toString('hex'); // 이번 실행의 임시 DB
async function main() // 실시간 업무 이력 통합 검사
{ // 검사 시작
    const options = { host: settings.get('DB_HOST'), port: settings.int('DB_PORT'), user: settings.get('DB_USER'), password: settings.get('DB_PASS'), multipleStatements: true }; // 관리 연결 설정
    const admin = await mysql.createConnection(options); // 임시 DB 전용 관리 연결
    let created = false; // 정리 대상 여부
    let db = null; // 제품 연결
    const originalError = console.error; // 기대 실패 로그 복구점
    try // 임시 환경 수명
    { // 환경 준비
        await admin.query('CREATE DATABASE ' + databaseName + ' CHARACTER SET utf8mb4'); // 고유 DB 생성
        created = true; // 정리 등록
        await admin.query('USE ' + databaseName); // 이번 DB 선택
        const schema = fs.readFileSync(path.resolve(__dirname, '../../../database/schema.sql'), 'utf8').replace(/^(?:CREATE DATABASE IF NOT EXISTS taskcanvas\b.*|USE taskcanvas;.*)$/gm, ''); // 개발 DB 선택문 제거
        await admin.query(schema); // 실제 제품 스키마
        process.env.DB_NAME = databaseName; // 제품 연결 대상
        delete require.cache[require.resolve('../src/env')]; // 테스트 설정 재로딩
        db = require('../src/db'); // 실제 풀과 쿼리
        db.pool.on('connection', (connection) => // 신규 DB 연결 설정
        { // 시간 경계 준비
            connection.query("SET time_zone = '+00:00'"); // UTC 세션 재현
            connection.query('SET timestamp = ' + Date.parse('2026-10-20T15:30:00Z') / 1000); // 서울 자정 경계
        }); // 시간 경계 준비 끝
        assert.equal((await db.one('SELECT DATABASE() AS name')).name, databaseName); // 운영 DB 보호
        await admin.query("INSERT INTO guests (display_name) VALUES ('행위자'); INSERT INTO users (login_id,display_name,password_hash) VALUES ('history33','행위자','test'); INSERT INTO user_sessions (user_id,token_hash,expires_at) VALUES (1,REPEAT('a',64),'2030-01-01'); INSERT INTO projects (title,created_by) VALUES ('이력 검증',1),('다른 작업실',1); INSERT INTO project_members (project_id,guest_id,role) VALUES (1,1,'admin'); INSERT INTO tasks (project_id,title) VALUES (1,'업무 A'),(1,'업무 B'),(2,'외부 업무')"); // 검사 전용 자료
        const events = new Map(); // 전송 경계만 대체
        const socket = { data: { workspace: true, projectId: 1, guestId: 1, userSessionId: 1 }, on: (name, handler) => events.set(name, handler), to: () => ({ emit() {} }) }; // 실제 핸들러 입력
        require('../src/handlers/task').register({}, socket); // 제품 핸들러 연결
        const update = async (id, version, changes, requestId) => // 실제 상태 변경 호출
        { // 호출 시작
            let response = null; // ACK 결과
            await events.get('task:update')({ task_id: id, version, changes, request_id: requestId }, (reply) => response = reply); // 실제 DB·권한·트랜잭션
            return response; // 저장 결과
        }; // 호출 끝
        assert.equal((await update(1, 1, { status: 'done' }, 'request-1')).ok, true); // 최초 상태 변경
        const history = await db.one('SELECT * FROM task_status_history'); // 실제 저장 이력
        assert.equal(history.changed_at, '2026-10-21 00:30:00'); // UTC 서버에서도 서울 자정 보존
        assert.equal(Number(history.actor_user_id), 1); // 회원 행위자
        assert.equal((await update(1, 1, { status: 'done' }, 'request-1')).error.code, 'VERSION_CONFLICT'); // 동일 요청 재전송
        assert.equal((await db.one('SELECT COUNT(*) AS n FROM task_status_history')).n, 1); // 재시도 중복 없음
        assert.equal((await update(1, 2, { title: '이름 변경' }, 'title-1')).ok, true); // 상태 외 변경
        assert.equal((await db.one('SELECT COUNT(*) AS n FROM task_status_history')).n, 1); // 불필요한 이력 없음
        console.error = () => {}; // 의도한 충돌 로그 생략
        assert.equal((await update(2, 1, { status: 'done' }, 'request-1')).ok, false); // 타 업무 키 충돌 거부
        assert.equal((await db.one('SELECT status FROM tasks WHERE task_id=2')).status, 'todo'); // 업무 변경도 롤백
        assert.equal((await update(1, 3, { status: 'todo' }, 'request-2')).ok, true); // 정상 상태 복귀
        assert.equal((await update(1, 4, { status: 'done' }, 'request-1')).ok, false); // 같은 전환의 오래된 키 재사용 거부
        assert.equal((await db.one('SELECT status FROM tasks WHERE task_id=1')).status, 'todo'); // 순환 변경의 누락 방지
        assert.equal((await update(3, 1, { status: 'done' }, 'foreign')).error.code, 'NOT_FOUND'); // 다른 작업실 업무 차단
        const replies = await Promise.all([update(2, 1, { status: 'doing' }, 'parallel-a'), update(2, 1, { status: 'done' }, 'parallel-b')]); // 같은 버전의 동시 수정
        assert.equal(replies.filter((reply) => reply.ok).length, 1); // 한 변경만 저장
        assert.equal((await db.one('SELECT COUNT(*) AS n FROM task_status_history')).n, 3); // 성공한 세 변경만 기록
        console.log('PASS 실시간 이력: 재시도·키 충돌·순환 재사용·동시 수정·롤백·권한·서울 자정'); // 검증 결과
    } // 환경 검사 끝
    finally // 정확한 임시 자원 정리
    { // 정리 시작
        console.error = originalError; // 로그 복구
        if (db) // 제품 풀 생성 여부
        { // 풀 종료
            await db.pool.end(); // 연결 해제
        } // 풀 종료 끝
        if (created) // 이번에 생성한 DB만
        { // 임시 DB 정리
            await admin.query('DROP DATABASE ' + databaseName); // 고유 이름의 검사 자료 삭제
        } // 임시 DB 정리 끝
        await admin.end(); // 관리 연결 해제
    } // 정리 끝
} // 검사 끝
main().catch((error) => // 최종 실패 보고
{ // 오류 처리
    console.error(error); process.exitCode = 1; // 오류와 종료 코드
}); // 오류 처리 끝
