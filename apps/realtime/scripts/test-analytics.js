'use strict'; // 엄격한 자바스크립트 검사
const fs = require('fs'); // 스키마 읽기
const path = require('path'); // 경로 계산
const crypto = require('crypto'); // 임시 DB 이름과 해시
const { spawn } = require('child_process'); // 실제 PHP 서버
const mysql = require('mysql2/promise'); // 실제 MariaDB 연결
const net = require('net'); // 테스트 포트 사전 예약
const env = require('../src/env'); // 개발 DB 설정
const ROOT = path.resolve(__dirname, '../../..'); // 저장소 경로
const PHP = process.env.PHP_BIN || (process.platform === 'win32' ? 'C:/xampp/php/php.exe' : 'php'); // PHP 실행 파일
const PORT = Number(process.env.ANALYTICS_TEST_PORT || 0); // 기본값은 가용한 임의 포트
let BASE = ''; // 예약 이후 확정할 테스트 서버 주소
const DB_NAME = 'taskcanvas_d28_' + crypto.randomBytes(8).toString('hex'); // 이번 실행만 사용하는 DB
let passed = 0; // 통과 항목 수

async function availablePort() // 기존 서버를 건드리지 않는 포트 선택
{ // 포트 선택 시작
    if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) // 포트 설정 범위 검사
    { // 설정 오류 처리 시작
        throw new Error('ANALYTICS_TEST_PORT 범위 오류'); // 잘못된 포트 차단
    } // 설정 오류 처리 끝
    const reservation = net.createServer(); // 접속 가능한 포트 확인
    await new Promise((resolve, reject) => // 실제 포트 점유 검사
    { // 포트 검사 시작
        reservation.once('error', reject); // 점유된 포트는 즉시 실패
        reservation.listen(PORT, '127.0.0.1', resolve); // 임의 포트 또는 지정 포트 예약
    }); // 포트 검사 끝
    const port = reservation.address().port; // 예약된 포트 번호
    await new Promise((resolve) => reservation.close(resolve)); // PHP 서버에 포트 양도
    return port; // 사용할 포트 반환
} // 포트 선택 끝

function check(condition, message) // 검증 결과 처리
{ // 검증 시작
    if (!condition) // 실패 여부
    { // 실패 처리 시작
        throw new Error(message); // 실패 원인 전달
    } // 실패 처리 끝
    passed += 1; // 통과 수 집계
    console.log('PASS ' + message); // 결과 출력
} // 검증 끝

async function request(method, route, body, cookie = '', protectedHeader = true) // 실제 HTTP 요청
{ // 요청 시작
    const headers = { 'Content-Type': 'application/json', Cookie: cookie }; // 본문과 쿠키
    if (protectedHeader) // 정상 클라이언트 헤더 여부
    { // 보호 헤더 추가
        headers['X-TaskCanvas'] = '1'; // 요청 위조 방어 헤더
    } // 보호 헤더 끝
    const response = await fetch(BASE + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); // 실제 API 호출
    const text = await response.text(); // 응답 원문
    let data = null; // JSON 응답
    try // JSON 해석
    { // 해석 시작
        data = JSON.parse(text); // 응답 데이터
    } // 해석 끝
    catch (_) // 정적 페이지 응답
    { // 정적 응답 처리
        data = null; // JSON 없는 응답
    } // 정적 응답 처리 끝
    const cookies = response.headers.getSetCookie(); // 서버 발급 쿠키
    return { status: response.status, data, text, cookies, cookie: cookies.map((value) => value.split(';')[0]).join('; '), headers: response.headers }; // 검증용 응답
} // 요청 끝

async function main() // 인증 통합 검증
{ // 검증 실행 시작
    const port = await availablePort(); // DB 변경 전에 포트 충돌 차단
    BASE = 'http://127.0.0.1:' + port; // 실제 검사 주소
    const options = { host: env.get('DB_HOST'), port: env.int('DB_PORT'), user: env.get('DB_USER'), password: env.get('DB_PASS'), charset: 'utf8mb4', multipleStatements: true }; // 개발용 서버 접속
    const admin = await mysql.createConnection(options); // DB 생성 전용 연결
    let db = null; // 테스트 DB 연결
    let server = null; // 테스트 PHP 프로세스
    let created = false; // DB 생성 여부
    const nonce = crypto.randomBytes(20).toString('hex'); // 이번 PHP 서버의 식별값
    const routerPath = path.join(ROOT, 'tmp', DB_NAME + '-router.php'); // 실행별 전용 테스트 라우터
    let routerCreated = false; // 정리할 라우터 파일 여부
    try // 테스트 환경 준비와 검사
    { // 테스트 본문 시작
        await admin.query('CREATE DATABASE `' + DB_NAME + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); // 고유 임시 DB 생성
        created = true; // 정리 대상 표시
        db = await mysql.createConnection({ ...options, database: DB_NAME }); // 운영 DB와 분리
        const schema = fs.readFileSync(path.join(ROOT, 'database/schema.sql'), 'utf8').replace(/^(?:CREATE DATABASE IF NOT EXISTS taskcanvas\b.*|USE taskcanvas;.*)$/gm, ''); // 운영 DB 선택문 제외
        await db.query(schema); // 임시 DB에 전체 스키마 설치
        fs.mkdirSync(path.dirname(routerPath), { recursive: true }); // 제외된 테스트 파일 폴더 준비
        const productionRouter = path.join(ROOT, 'apps/php-api/public/index.php').replace(/\\/g, '/').replace(/'/g, "\\'"); // PHP 문자열에 안전한 라우터 경로
        fs.writeFileSync(routerPath, "<?php // 임시 인증 테스트 라우터\nheader('X-TaskCanvas-Test: ' . getenv('TC_AUTH_TEST_NONCE')); // 테스트 서버 식별\nreturn require '" + productionRouter + "'; // 실제 앱 라우터 위임\n"); // 제품 코드를 바꾸지 않는 서버 식별
        routerCreated = true; // 실행별 파일 정리 예약
        let startupError = null; // 서버 시작 오류
        server = spawn(PHP, ['-S', '127.0.0.1:' + port, '-t', 'apps/frontend/public', routerPath], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, TC_AUTH_TEST_NONCE: nonce, DB_NAME, DB_HOST: options.host, DB_PORT: String(options.port), DB_USER: options.user, DB_PASS: options.password, USER_SESSION_COOKIE: 'tc_user_session', USER_SESSION_TTL: '3600', COOKIE_SECURE: '0', RATE_LIMIT: '1000', RATE_WINDOW: '600' } }); // 실제 PHP 테스트 서버
        server.once('error', (error) => // 실행 파일 또는 프로세스 오류 감시
        { // 실행 오류 기록 시작
            startupError = error; // 준비 확인 전 오류 보관
        }); // 실행 오류 감시 끝
        server.once('exit', (code) => // PHP 조기 종료 감시
        { // 종료 기록 시작
            startupError = new Error('PHP 테스트 서버 종료: ' + code); // 포트 양도 경쟁 등 시작 실패
        }); // 종료 감시 끝
        let ready = false; // 서버 준비 상태
        for (let attempt = 0; attempt < 50; attempt += 1) // 짧은 준비 확인
        { // 준비 검사 시작
            if (startupError) // 시작 실패 여부
            { // 시작 오류 처리
                throw startupError; // 기존 서버 검사로 넘어가지 않고 중단
            } // 시작 오류 처리 끝
            let foreignServer = false; // 다른 서버 응답 여부
            try // 서버 상태 요청
            { // 상태 확인 시작
                const probe = await request('GET', '/api/health'); // 읽기 전용 준비 요청
                foreignServer = probe.status === 200 && probe.headers.get('x-taskcanvas-test') !== nonce; // 기존 서버 오인 차단
                ready = probe.status === 200 && !foreignServer; // 이번 서버만 준비 완료 처리
            } // 상태 확인 끝
            catch (_) // 시작 중 연결 거부
            { // 재확인 준비
                ready = false; // 아직 준비되지 않은 상태
            } // 재확인 준비 끝
            if (foreignServer || startupError) // 잘못된 서버 또는 조기 종료
            { // 검사 대상 오류 처리
                throw startupError || new Error('다른 서버의 응답 감지: 테스트 중단'); // 인증 쓰기 요청 차단
            } // 검사 대상 오류 처리 끝
            if (ready) // 준비 완료 여부
            { // 대기 종료
                break; // 검사 진행
            } // 대기 종료 끝
            await new Promise((resolve) => setTimeout(resolve, 100)); // 시작 대기
        } // 준비 검사 끝
        check(ready, '격리된 PHP·DB 서버 시작'); // 환경 검사
        const route = (id, query = '') => '/api/projects/' + id + '/analytics/summary' + query; // 통계 경로
        check((await request('GET', route(1))).status === 401, '통계 조회 비인증 거부'); // 구현 전 실패 기준
        const password = 'Analytics-test-28!'; // 가상 비밀번호
        await request('POST', '/api/auth/register', { login_id: 'stats28', display_name: '통계 관리자', password, password_confirm: password }); // 테스트 회원
        const login = await request('POST', '/api/auth/login', { login_id: 'stats28', password }); // 회원 로그인
        const made = await request('POST', '/api/projects', { display_name: '통계 관리자', title: '통계 작업실' }, login.cookie); // 회원 소유 프로젝트
        const memberCookie = login.cookies.find((value) => value.startsWith('tc_user_session=')).split(';')[0]; // 회원 쿠키
        const cookie = memberCookie + '; ' + made.cookie; // 활성 회원·게스트 결합
        const id = made.data.project.project_id; // 통계 대상
        const owner = made.data.guest.guest_id; // 담당자 A
        const invited = await request('POST', '/api/projects/' + id + '/invites', { role: 'viewer', days: 1 }, cookie); // 조회 권한 초대
        const viewer = await request('POST', '/api/guest/join', { display_name: '통계 열람자', invite_code: invited.data.code }); // 비회원 열람자
        const assignee = viewer.data.guest.guest_id; // 담당자 B
        const foreign = await request('POST', '/api/projects', { display_name: '다른 작업실 관리자', title: '통계 격리' }); // 타 작업실
        check((await request('GET', route(id), undefined, foreign.cookie)).status === 403, '다른 작업실 통계 접근 거부'); // 역할 경계
        check((await request('GET', route(id), undefined, made.cookie)).status === 401, '회원 쿠키 없는 연결 게스트 거부'); // 27일차 인증 유지
        const empty = await request('GET', route(id), undefined, viewer.cookie); // 열람자 조회
        check(empty.status === 200 && empty.data.tasks.total === 0 && empty.data.tasks.completion_rate === 0, '열람자 조회와 빈 업무 완료율 0'); // 빈 결과
        check(empty.data.checklist.total === 0 && empty.data.checklist.completion_rate === 0 && empty.data.assignees.length === 0, '빈 체크리스트·담당자 목록'); // 분모 0
        check(empty.headers.get('cache-control').includes('no-store'), '통계 응답 캐시 금지'); // 최신 집계
        const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0,10); // 서울 기준 오늘
        const day = (offset) => new Date(Date.parse(today + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0,10); // 날짜 단위 경계
        const fixtures = [ // 업무 원본과 고정 생성일
            ['todo',owner,day(-1),'2026-02-01 00:00:00'], // 마감 초과
            ['doing',assignee,today,'2026-02-01 23:59:59'], // 오늘 마감
            ['done',assignee,day(-1),'2026-02-02 00:00:00'], // 완료 마감
            ['todo',null,day(3),'2026-02-03 12:00:00'], // 3일 임박 끝
            ['done',null,null,'2026-02-04 12:00:00'], // 마감 없는 완료
            ['doing',owner,day(4),'2026-02-05 12:00:00'], // 여유 시작
            ['todo',owner,day(1),'2026-02-06 12:00:00'], // 임박 시작
        ]; // 업무 목록 끝
        const ids = []; // 생성 업무 식별자
        for (const [status, person, due, created] of fixtures) // 가상 자료 저장
        { // 업무 생성
            const [stored] = await db.query('INSERT INTO tasks (project_id,title,status,assignee_id,due_at,created_at) VALUES (?,?,?,?,?,?)', [id,'통계 업무 ' + ids.length,status,person,due === null ? null : due + ' 00:00:00',created]); // 날짜 시간 명시
            ids.push(stored.insertId); // 실제 ID 보관
        } // 저장 끝
        for (const [index, flags] of [[0,[1,1,0]],[1,[0,0]],[2,[1]],[5,[1,1]],[6,[0]]]) // 체크리스트 9개
        { // 항목 준비
            for (const done of flags) // 완료 상태별
            { // 항목 저장
                await db.query('INSERT INTO task_items (task_id,title,is_done) VALUES (?,?,?)', [ids[index],'검사 항목',done]); // 실제 항목
            } // 항목 저장 끝
        } // 준비 끝
        const [secondBoard] = await db.query('INSERT INTO boards (project_id,title) VALUES (?,?)', [id,'복제 참조 보드']); // 두 번째 보드
        await db.query("INSERT INTO board_objects (board_id,task_id,type,payload_json) VALUES (?,?,'task','{}'), (?,?,'task','{}')", [made.data.board.board_id,ids[0],secondBoard.insertId,ids[0]]); // 같은 업무의 두 보드 참조
        await db.query("INSERT INTO tasks (project_id,title,status) VALUES (?, '다른 프로젝트 업무', 'done')", [foreign.data.project.project_id]); // 집계 제외 자료
        const stats = (await request('GET', route(id), undefined, cookie)).data; // 전체 통계
        check(stats.project_id === id && stats.time_zone === 'Asia/Seoul' && stats.as_of_date === today, '작업실·서울 기준 집계 날짜'); // 날짜 계약
        check(stats.tasks.total === 7 && stats.tasks.todo === 3 && stats.tasks.doing === 2 && stats.tasks.done === 2, '여러 보드 참조 중복 없이 업무 원본 집계'); // 원본 기준
        check(stats.tasks.completion_rate === 28.6, '업무 완료율 소수 첫째 자리'); // 비율 계산
        check(stats.checklist.total === 9 && stats.checklist.done === 5 && stats.checklist.completion_rate === 55.6, '체크리스트 조인으로 업무 중복 없는 합계'); // 집계 곱셈 방지
        check(stats.due.overdue === 1 && stats.due.today === 1 && stats.due.soon === 2 && stats.due.later === 1 && stats.due.closed === 1 && stats.due.none === 1, '미완료 마감 경계와 마감 없음·완료 구분'); // 배타적 구간
        const groups = stats.assignees; // 실제 담당자별 목록
        check(groups.length === 3 && groups.find((row) => row.assignee_id === owner).total === 3 && groups.find((row) => row.assignee_id === assignee).done === 1, '담당 게스트별 업무·완료 수'); // 사람별 집계
        check(groups.find((row) => row.assignee_id === null).total === 2 && groups.find((row) => row.assignee_id === null).done === 1, '미배정 업무 별도 집계'); // 미배정 보존
        const completed = (await request('GET', route(id,'?status=done'), undefined, cookie)).data; // 완료 필터
        check(completed.tasks.total === 2 && completed.tasks.completion_rate === 100 && completed.checklist.total === 1 && completed.checklist.done === 1, '상태 필터를 업무와 체크리스트에 동일 적용'); // 공통 조건
        const own = (await request('GET', route(id,'?assignee_id=' + owner), undefined, cookie)).data; // 담당자 필터
        check(own.tasks.total === 3 && own.checklist.total === 6 && own.checklist.done === 4 && own.assignees.length === 1, '담당자 필터를 모든 집계에 적용'); // 조건 일치
        const unassigned = (await request('GET', route(id,'?assignee_id=unassigned'), undefined, cookie)).data; // 미배정 필터
        check(unassigned.tasks.total === 2 && unassigned.checklist.total === 0 && unassigned.checklist.completion_rate === 0, '미배정 필터·항목 없는 업무'); // 빈 분모
        const period = (await request('GET', route(id,'?created_from=2026-02-01&created_to=2026-02-01'), undefined, cookie)).data; // 하루 범위
        check(period.tasks.total === 2 && period.checklist.total === 5 && period.checklist.done === 2, '생성일 시작·종료 날짜 양끝 포함'); // 00시와 23시59분59초
        const combined = (await request('GET', route(id,'?created_from=2026-02-01&created_to=2026-02-03&status=doing&assignee_id=' + assignee), undefined, cookie)).data; // 다중 필터
        check(combined.tasks.total === 1 && combined.due.today === 1 && combined.checklist.total === 2 && combined.filters.assignee_id === assignee, '기간·상태·담당자 교집합과 필터 응답'); // 같은 대상 집계
        const none = (await request('GET', route(id,'?created_from=2026-03-01'), undefined, cookie)).data; // 선택 결과 없음
        check(none.tasks.total === 0 && none.tasks.completion_rate === 0 && none.assignees.length === 0 && Object.values(none.due).every((value) => value === 0), '필터 결과 없음도 안정적인 0 응답'); // 빈 필터
        const invalids = ['created_from=2026-02-30','created_to=2026-13-01','created_from=26-02-01','created_from[]=2026-02-01','created_from=2026-02-03&created_to=2026-02-01','status=invalid','status[]=todo','assignee_id=0','assignee_id=-1','assignee_id=1e2','assignee_id=9999999999999999999999','assignee_id[]=1','unexpected=1',"status=todo%27%20OR%201%3D1"]; // 잘못된 조건
        for (const query of invalids) // 입력 거부
        { // 필터 검사
            check((await request('GET', route(id,'?' + query), undefined, cookie)).status === 400, '잘못된 필터 400: ' + query); // 바인딩과 검증
        } // 거부 검사 끝
        const noPerson = (await request('GET', route(id,'?assignee_id=' + foreign.data.guest.guest_id), undefined, cookie)).data; // 타 작업실 담당자 ID
        check(noPerson.tasks.total === 0 && noPerson.assignees.length === 0, '담당자 조건으로 타 프로젝트 정보 노출 없음'); // 범위 유지
        const [[direct]] = await db.query("SELECT COUNT(*) AS total, SUM(status='done') AS done FROM tasks WHERE project_id = ?", [id]); // 독립 직접 SQL
        check(stats.tasks.total === direct.total && stats.tasks.done === Number(direct.done), '응답과 독립 SQL 집계 일치'); // 기준 비교
        await db.query("UPDATE tasks SET status='done' WHERE task_id = ?", [ids[0]]); // 실제 업무 변경
        const updated = (await request('GET', route(id), undefined, cookie)).data; // 변경 후 재집계
        check(updated.tasks.done === 3 && updated.due.overdue === 0, '업무 변경 즉시 재집계'); // 캐시 오염 없음
        await db.query('DELETE FROM tasks WHERE task_id = ?', [ids[6]]); // 업무와 항목 삭제
        const removed = (await request('GET', route(id), undefined, cookie)).data; // 삭제 후 집계
        check(removed.tasks.total === 6 && removed.checklist.total === 8 && removed.tasks.completion_rate === 50, '업무·체크리스트 삭제 즉시 재집계'); // 삭제 반영
        await db.query("INSERT INTO tasks (project_id,title,status) VALUES (?, '기존 알 수 없는 상태', 'legacy')", [id]); // 과거 DB 자료
        const legacy = (await request('GET', route(id), undefined, cookie)).data; // 누락 없는 집계
        check(legacy.tasks.other === 1 && legacy.tasks.total === 7, '기존 알 수 없는 상태도 전체에서 누락 없음'); // 데이터 보존
        await request('POST', '/api/auth/logout', {}, cookie); // 회원 세션 폐기
        check((await request('GET', route(id), undefined, cookie)).status === 401, '로그아웃 후 통계 조회 거부'); // 세션 경계
        console.log('업무 통계 ' + passed + '개 통과'); // 검증 집계
    } // 테스트 본문 끝
    finally // 전용 자원 정리
    { // 정리 시작
        if (server && server.pid && server.exitCode === null && server.signalCode === null) // 실제 실행 중인 테스트 서버
        { // 서버 정리 시작
            const stopped = new Promise((resolve) => server.once('exit', resolve)); // 종료 완료 대기
            server.kill(); // 테스트 PHP만 종료
            await stopped; // DB 연결 종료 확인
        } // 서버 정리 끝
        if (db) // 테스트 DB 연결 존재
        { // 연결 정리 시작
            await db.end(); // 연결 종료
        } // 연결 정리 끝
        if (created) // 이번 테스트가 생성한 DB
        { // 임시 DB 정리 시작
            await admin.query('DROP DATABASE `' + DB_NAME + '`'); // 이번 가상 데이터만 삭제
        } // 임시 DB 정리 끝
        if (routerCreated) // 이번 실행이 생성한 라우터
        { // 파일 정리 시작
            fs.unlinkSync(routerPath); // 정확히 그 임시 파일만 정리
        } // 파일 정리 끝
        await admin.end(); // 관리 연결 종료
    } // 정리 끝
} // 검증 실행 끝

main().catch((error) => // 최종 실패 처리
{ // 오류 보고 시작
    console.error('FAIL ' + error.message); // 실패 원인
    process.exitCode = 1; // 실패 종료 코드
}); // 오류 보고 끝
