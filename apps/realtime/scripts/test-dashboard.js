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
const PORT = Number(process.env.DASHBOARD_TEST_PORT || 0); // 기본값은 가용한 임의 포트
let BASE = ''; // 예약 이후 확정할 테스트 서버 주소
const DB_NAME = 'taskcanvas_d29_' + crypto.randomBytes(8).toString('hex'); // 이번 실행만 사용하는 DB
let passed = 0; // 통과 항목 수

async function availablePort() // 기존 서버를 건드리지 않는 포트 선택
{ // 포트 선택 시작
    if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) // 포트 설정 범위 검사
    { // 설정 오류 처리 시작
        throw new Error('DASHBOARD_TEST_PORT 범위 오류'); // 잘못된 포트 차단
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
        server = spawn(PHP, ['-d', 'memory_limit=64M', '-S', '127.0.0.1:' + port, '-t', 'apps/frontend/public', routerPath], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, TC_AUTH_TEST_NONCE: nonce, DB_NAME, DB_HOST: options.host, DB_PORT: String(options.port), DB_USER: options.user, DB_PASS: options.password, USER_SESSION_COOKIE: 'tc_user_session', USER_SESSION_TTL: '3600', COOKIE_SECURE: '0', RATE_LIMIT: '1000', RATE_WINDOW: '600' } }); // 메모리 경계가 있는 실제 테스트 서버
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
        const route = (id, query = '') => '/api/projects/' + id + '/analytics/dashboard' + query; // 통계 경로
        check((await request('GET', route(1))).status === 401, '통계 조회 비인증 거부'); // 구현 전 실패 기준
        const csvRoute = (id, query = '') => '/api/projects/' + id + '/analytics/export' + query; // 전체 CSV 경로
        check((await request('GET', csvRoute(1))).status === 401, 'CSV 비인증 거부'); // 다운로드 인증
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
        check((await request('GET', csvRoute(id), undefined, foreign.cookie)).status === 403, '다른 작업실 CSV 접근 거부'); // 다운로드 범위
        check((await request('GET', route(id), undefined, made.cookie)).status === 401, '회원 쿠키 없는 연결 게스트 거부'); // 27일차 인증 유지
        const empty = await request('GET', route(id), undefined, viewer.cookie); // 열람자 접근
        check(empty.status === 200 && empty.data.summary.tasks.total === 0, '열람자와 빈 결과'); // 권한과 0건
        check(empty.data.rows.length === 0 && empty.data.pagination.page === 1 && empty.data.pagination.total_pages === 1, '빈 페이지 정규화'); // 0건 페이지
        check(empty.headers.get('cache-control').includes('no-store'), '캐시 금지'); // 개인정보 캐시 방지
        const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); // 서울 오늘
        const day = (offset) => new Date(Date.parse(today + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10); // 독립 날짜 계산
        check(empty.data.filters.created_from === day(-29) && empty.data.filters.created_to === today && empty.data.daily_created.length === 30, '기본 최근 30일'); // 기본 범위
        await db.query('UPDATE guests SET display_name=? WHERE guest_id IN (?,?)', ['동명 담당자', owner, assignee]); // 동명이인
        const ids = []; // 업무 식별자
        for (let i = 0; i < 21; i += 1) // 페이지 경계 데이터
        { // 업무 추가
            const [row] = await db.query('INSERT INTO tasks (project_id,title,status,assignee_id,created_at,due_at) VALUES (?,?,?,?,?,?)', [id, i === 1 ? '=2+2' : '<img src=x> 업무 ' + i, i === 0 ? 'legacy' : i % 2 === 0 ? 'done' : 'todo', i === 0 ? null : i % 2 === 0 ? owner : assignee, today + ' 12:00:00', day(-1) + ' 23:59:59']); // 안전 출력·CSV 수식과 마감
            ids.push(row.insertId); // ID 보관
        } // 업무 추가 끝
        await db.query('INSERT INTO task_items (task_id,title,is_done) VALUES (?, ?, 1), (?, ?, 0)', [ids[0], '완료 항목', ids[0], '미완료 항목']); // 항목 다건
        await db.query("INSERT INTO board_objects (board_id,task_id,type,payload_json) VALUES (?,?,'task','{}')", [made.data.board.board_id, ids[20]]); // 최신 업무의 원본 보드
        await db.query('INSERT INTO task_status_history (project_id,task_id,from_status,to_status,actor_guest_id,request_id,changed_at) VALUES (?,?,?,?,?,?,?)', [id, ids[2], 'todo', 'done', owner, 'dashboard-history-1', today + ' 13:00:00']); // 실제 완료 전환
        const stats = (await request('GET', route(id), undefined, cookie)).data; // 기본 조회
        check(stats.summary.tasks.total === 21 && stats.summary.tasks.done === 10 && stats.summary.tasks.other === 1, '원본 업무 상태 집계'); // 독립 기대값
        check(stats.summary.checklist.total === 2 && stats.summary.checklist.done === 1 && stats.summary.checklist.completion_rate === 50, '체크리스트 다건 집계'); // 조인 중복 방지
        check(stats.daily_created.reduce((sum, row) => sum + row.count, 0) === 21 && stats.pagination.total === 21, '카드·추이·표 건수 일치'); // 필터 정합성
        check(stats.rows.length === 20 && stats.rows[0].task_id === ids[20] && stats.rows[19].task_id === ids[1], '20건과 동일 시각 ID 역순'); // 안정 정렬
        check(stats.status_trend.reduce((sum, row) => sum + row.done, 0) === 1 && stats.rows[0].board_id === made.data.board.board_id, '실제 완료 이력과 원본 보드 연결'); // 추정 없는 추이
        const exported = await request('GET', '/api/projects/' + id + '/analytics/export?created_from=' + today + '&created_to=' + today, undefined, cookie); // 같은 조건 CSV
        check(exported.status === 200 && exported.headers.get('content-type').includes('text/csv'), 'CSV 다운로드 응답'); // 전용 자료형
        check(exported.text.trim().split(/\r?\n/).length === 22, 'CSV 머리·21건 전체 행'); // 화면 총계와 일치
        check(exported.text.includes("'=2+2"), 'CSV 수식 실행 기호 이스케이프'); // 스프레드시트 안전
        check(exported.headers.get('content-disposition').includes('taskcanvas-project-' + id), '안전한 CSV 파일명'); // 다운로드 헤더
        const doneCsv = await request('GET', csvRoute(id, '?status=done'), undefined, viewer.cookie); // 열람자와 상태 조건
        check(doneCsv.status === 200 && doneCsv.text.trim().split(/\r?\n/).length === 11, '열람자 CSV 완료 필터와 10개 업무'); // 지표·전체 CSV 대조
        check(stats.assignee_options.filter((row) => row.display_name === '동명 담당자').length === 2 && stats.summary.assignees.length === 3, '동명 담당자 ID별 구분과 미배정'); // 이름 병합 금지
        const last = (await request('GET', route(id, '?page=9223372036854775807'), undefined, cookie)).data; // 유효 최대 페이지
        check(last.pagination.page === 2 && last.rows.length === 1 && last.rows[0].task_id === ids[0], '큰 페이지 마지막 보정'); // 곱셈 오버플로 방지
        check(last.rows[0].checklist.total === 2 && last.rows[0].checklist.completion_rate === 50, '업무 행 체크리스트'); // 행 계약
        const done = (await request('GET', route(id, '?status=done'), undefined, cookie)).data; // 완료만
        check(done.summary.tasks.total === 10 && done.rows.length === 10 && done.daily_created.reduce((sum, row) => sum + row.count, 0) === 10, '상태 조건의 전체 일치'); // 동일 대상
        const own = (await request('GET', route(id, '?assignee_id=' + owner), undefined, cookie)).data; // 담당자만
        check(own.summary.tasks.total === 10 && own.rows.every((row) => row.assignee_id === owner), '담당자 필터'); // ID 범위
        const unassigned = (await request('GET', route(id, '?assignee_id=unassigned'), undefined, cookie)).data; // 미배정만
        check(unassigned.summary.tasks.total === 1 && unassigned.rows[0].assignee_id === null, '미배정 필터'); // NULL 범위
        await db.query('DELETE FROM project_members WHERE project_id=? AND guest_id=?', [id, assignee]); // 담당 업무 남긴 멤버
        const filtered = (await request('GET', route(id, '?status=done'), undefined, cookie)).data; // 다른 상태 조회
        check(filtered.assignee_options.some((row) => row.assignee_id === assignee), '탈퇴 담당자와 필터 독립 선택지'); // 기존 업무 참조 유지
        const foreignStats = (await request('GET', route(id, '?assignee_id=' + foreign.data.guest.guest_id), undefined, cookie)).data; // 다른 작업실 ID
        check(foreignStats.rows.length === 0 && !foreignStats.assignee_options.some((row) => row.assignee_id === foreign.data.guest.guest_id), '타 작업실 정보 미노출'); // 범위 제한
        const until = (await request('GET', route(id, '?created_to=2024-02-29'), undefined, cookie)).data; // 종료일 기본값
        check(until.filters.created_from === '2024-01-31' && until.daily_created.length === 30 && until.rows.length === 0, '윤일 종료일만과 0일 채우기'); // 달력 기준
        const since = (await request('GET', route(id, '?created_from=' + today), undefined, cookie)).data; // 시작일만
        check(since.filters.created_to === today && since.daily_created.length === 1, '시작일만 오늘까지'); // 자동 종료
        check((await request('GET', route(id, '?created_from=2024-01-01&created_to=2024-12-31'), undefined, cookie)).data.daily_created.length === 366, '366일 허용'); // 윤년 전체
        const upper = await request('GET', route(id, '?created_from=9999-12-31&created_to=9999-12-31'), undefined, cookie); // DB 날짜 상한
        check(upper.status === 200 && upper.data.daily_created.length === 1 && upper.data.daily_created[0].date === '9999-12-31', '9999년 마지막 날의 유한한 조회'); // 날짜 증가 상한 회귀
        const invalids = ['created_from=2024-01-01&created_to=2025-01-01', 'created_to=1000-01-01', 'created_from=2024-02-30', 'created_from=2025-02-29', 'created_from=2026-02-02&created_to=2026-02-01', 'created_from[]=', 'created_to=', 'page=0', 'page=-1', 'page=1.5', 'page=01', 'page=99999999999999999999999', 'page[]=1', 'status=legacy', 'assignee_id=0', 'unexpected=1']; // 잘못된 조건
        for (const query of invalids) // 입력 검증
        { // 조건별 검사
            check((await request('GET', route(id, '?' + query), undefined, cookie)).status === 400, '잘못된 입력: ' + query); // 일관된 400
        } // 입력 검증 끝
        await request('POST', '/api/auth/logout', {}, cookie); // 회원 만료
        check((await request('GET', csvRoute(id), undefined, cookie)).status === 401, '로그아웃 후 CSV 거부'); // 다운로드 세션 만료
        check((await request('GET', route(id), undefined, cookie)).status === 401, '로그아웃 후 차단'); // 세션 경계

        console.log('대시보드 ' + passed + '개 통과'); // 검증 집계
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
