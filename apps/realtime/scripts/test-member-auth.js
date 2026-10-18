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
const PORT = Number(process.env.AUTH_TEST_PORT || 0); // 기본값은 가용한 임의 포트
let BASE = ''; // 예약 이후 확정할 테스트 서버 주소
const DB_NAME = 'taskcanvas_d26_' + crypto.randomBytes(8).toString('hex'); // 이번 실행만 사용하는 DB
let passed = 0; // 통과 항목 수

async function availablePort() // 기존 서버를 건드리지 않는 포트 선택
{ // 포트 선택 시작
    if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) // 포트 설정 범위 검사
    { // 설정 오류 처리 시작
        throw new Error('AUTH_TEST_PORT 범위 오류'); // 잘못된 포트 차단
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
        server = spawn(PHP, ['-S', '127.0.0.1:' + port, '-t', 'apps/frontend/public', routerPath], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, TC_AUTH_TEST_NONCE: nonce, DB_NAME, DB_HOST: options.host, DB_PORT: String(options.port), DB_USER: options.user, DB_PASS: options.password, USER_SESSION_COOKIE: 'tc_user_session', USER_SESSION_TTL: '3600', COOKIE_SECURE: '0', RATE_LIMIT: '20', RATE_WINDOW: '600' } }); // 실제 PHP 테스트 서버
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
        check((await request('GET', '/api/auth/me')).status === 401, '비로그인 회원 조회 거부'); // 인증 필요 검사
        const signup = { login_id: 'member26', display_name: '회원 26', password: 'Member-test-26!', password_confirm: 'Member-test-26!' }; // 가상 회원 입력
        check((await request('POST', '/api/auth/register', signup, '', false)).status === 403, '회원가입 보호 헤더 누락 거부'); // 요청 위조 검사
        const invalids = [ // 잘못된 가입 입력
            { login_id: 'x' }, // 짧은 로그인 ID
            { login_id: '<script>' }, // 허용되지 않는 ID
            { display_name: '' }, // 빈 표시 이름
            { display_name: '\u0085' }, // 유니코드 제어 문자만 있는 이름
            { password: 'short', password_confirm: 'short' }, // 짧은 비밀번호
            { password: 'x'.repeat(73), password_confirm: 'x'.repeat(73) }, // 해시 처리 한도 초과
            { password: 'invalid\u0000password', password_confirm: 'invalid\u0000password' }, // 잘못된 비밀번호 바이트
            { password_confirm: 'different-password' }, // 확인 비밀번호 불일치
            { password: 12345678 }, // 문자열이 아닌 비밀번호
        ]; // 입력 목록 끝
        for (const invalid of invalids) // 입력 거부 검사
        { // 입력 검사 시작
            check((await request('POST', '/api/auth/register', { ...signup, ...invalid })).status === 400, '잘못된 가입 입력 거부: ' + Object.keys(invalid).join('/')); // 서버 검증
        } // 입력 검사 끝
        await db.query('DELETE FROM join_attempts'); // 전용 DB의 요청 제한 기록 정리
        const registered = await request('POST', '/api/auth/register', signup); // 정상 회원가입
        check(registered.status === 201 && registered.data.user.login_id === signup.login_id, '회원가입과 회원 정보 응답'); // 가입 성공
        check(!registered.text.includes('password_hash') && !registered.text.includes(signup.password), '가입 응답의 비밀번호 정보 비노출'); // 비밀 정보 검사
        const [[stored]] = await db.query('SELECT * FROM users WHERE login_id = ?', [signup.login_id]); // 저장된 회원
        check(stored.password_hash !== signup.password && stored.password_hash.startsWith('$2'), 'DB에 비밀번호 해시 저장'); // 평문 저장 차단
        const [[guestCount]] = await db.query('SELECT (SELECT COUNT(*) FROM guests) AS guests, (SELECT COUNT(*) FROM guest_user_links) AS links'); // 게스트 자동 연결 검사
        check(guestCount.guests === 0 && guestCount.links === 0, '회원가입의 기존 게스트 자동 연결 없음'); // 27일차 경계
        check((await request('POST', '/api/auth/register', { ...signup, login_id: 'MEMBER26' })).status === 409, '대소문자만 다른 중복 ID 거부'); // 중복 계정 차단
        const wrong = await request('POST', '/api/auth/login', { login_id: signup.login_id, password: 'wrong-password' }); // 잘못된 비밀번호
        const unknown = await request('POST', '/api/auth/login', { login_id: 'unknown26', password: 'wrong-password' }); // 없는 ID
        check(wrong.status === 401 && unknown.status === 401 && wrong.data.error.message === unknown.data.error.message, '없는 ID와 잘못된 비밀번호의 동일한 거부 응답'); // 계정 유무 노출 방지
        check((await request('POST', '/api/auth/login', { login_id: signup.login_id, password: signup.password }, '', false)).status === 403, '로그인 보호 헤더 누락 거부'); // 교차 사이트 로그인 방어
        const login = await request('POST', '/api/auth/login', { login_id: 'MEMBER26', password: signup.password }); // 대소문자 정규화 로그인
        check(login.status === 200 && login.data.user.user_id === stored.user_id, '정상 로그인과 회원 ID 확인'); // 인증 성공
        const setCookie = login.cookies.find((value) => value.startsWith('tc_user_session=')) || ''; // 회원 세션 쿠키
        check(/HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie) && /path=\//i.test(setCookie), 'HttpOnly·SameSite·전체 경로 회원 쿠키'); // 쿠키 보호
        const token = setCookie.split(';')[0].split('=')[1]; // 가상 회원 토큰
        const [[session]] = await db.query('SELECT * FROM user_sessions WHERE token_hash = ?', [crypto.createHash('sha256').update(token).digest('hex')]); // 토큰 해시 조회
        check(Boolean(session) && session.token_hash !== token, 'DB에 회원 세션 토큰 해시만 저장'); // 원문 토큰 비저장
        const me = await request('GET', '/api/auth/me', undefined, login.cookie); // 새 요청의 로그인 유지
        check(me.status === 200 && me.data.user.login_id === signup.login_id && me.headers.get('cache-control').includes('no-store'), '쿠키로 로그인 상태 복원과 응답 캐시 차단'); // 상태 유지
        const otherBrowser = await request('POST', '/api/auth/login', { login_id: signup.login_id, password: signup.password }); // 별도 브라우저의 회원 세션
        const rotated = await request('POST', '/api/auth/login', { login_id: signup.login_id, password: signup.password }, login.cookie); // 현재 브라우저 재로그인
        check(rotated.status === 200 && rotated.cookie !== login.cookie, '재로그인 시 세션 토큰 교체'); // 세션 고정 방지
        check((await request('GET', '/api/auth/me', undefined, login.cookie)).status === 401, '교체 전 회원 세션 재사용 거부'); // 이전 세션 폐기
        check((await request('GET', '/api/auth/me', undefined, otherBrowser.cookie)).status === 200, '현재 브라우저 재로그인 시 다른 브라우저 세션 보존'); // 세션 교체 범위
        await db.query('DELETE FROM join_attempts'); // 전용 요청 기록 정리
        const guest = await request('POST', '/api/projects', { display_name: '기존 게스트', title: '게스트 보존 검사' }); // 별도 게스트 작업실
        check(guest.status === 201, '기존 게스트 작업실 생성 유지'); // 기존 진입 기능
        const combinedCookie = rotated.cookies.find((value) => value.startsWith('tc_user_session=')).split(';')[0] + '; ' + guest.cookie; // 회원과 게스트 쿠키 공존
        check((await request('POST', '/api/auth/logout', {}, combinedCookie, false)).status === 403, '보호 헤더 없는 로그아웃 거부'); // 무단 로그아웃 차단
        check((await request('GET', '/api/auth/me', undefined, combinedCookie)).status === 200, '거부된 로그아웃 이후 회원 세션 보존'); // 인증 상태 보존
        const logout = await request('POST', '/api/auth/logout', {}, combinedCookie); // 회원 로그아웃
        check(logout.status === 200 && !logout.cookies.some((value) => value.startsWith('tc_session=')), '회원 로그아웃 시 게스트 쿠키 보존'); // 인증 분리
        check((await request('GET', '/api/auth/me', undefined, combinedCookie)).status === 401, '로그아웃 전 토큰의 재사용 거부'); // 서버 세션 폐기
        check((await request('GET', '/api/me', undefined, combinedCookie)).status === 200, '회원 로그아웃 이후 기존 게스트 세션 유지'); // 게스트 회귀 검사
        check((await request('GET', '/api/auth/me', undefined, otherBrowser.cookie)).status === 200, '현재 브라우저 로그아웃 시 다른 브라우저 세션 보존'); // 로그아웃 범위
        check((await request('POST', '/api/auth/logout', {})).status === 200, '비로그인 로그아웃의 안전한 반복 처리'); // 멱등 로그아웃
        const expired = await request('POST', '/api/auth/login', { login_id: signup.login_id, password: signup.password }); // 만료 검사 세션
        await db.query('UPDATE user_sessions SET expires_at = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE revoked_at IS NULL'); // 전용 회원 세션 만료
        check((await request('GET', '/api/auth/me', undefined, expired.cookie)).status === 401, '만료된 회원 세션 거부'); // 만료 검사
        check((await request('GET', '/api/auth/me', undefined, 'tc_user_session=invalid')).status === 401, '잘못된 세션 토큰 형식 거부'); // 쿠키 형식 검사
        const spaced = { login_id: 'space26', display_name: '공백 비밀번호', password: '  Space-password-26!  ', password_confirm: '  Space-password-26!  ' }; // 원문 유지 검사
        check((await request('POST', '/api/auth/register', spaced)).status === 201, '공백을 포함한 비밀번호 가입'); // 가입 원문 보존
        check((await request('POST', '/api/auth/login', { login_id: spaced.login_id, password: spaced.password.trim() })).status === 401, '앞뒤 공백을 제거한 다른 비밀번호 거부'); // 암묵적 비밀번호 변경 차단
        check((await request('POST', '/api/auth/login', { login_id: spaced.login_id, password: spaced.password })).status === 200, '공백을 포함한 원래 비밀번호 로그인'); // 로그인 원문 보존
        await db.query('DELETE FROM join_attempts'); // 요청 제한 검사 준비
        for (let index = 0; index < 20; index += 1) // 요청 제한 한도까지 시도
        { // 제한 검사 시작
            await request('POST', '/api/auth/login', { login_id: 'unknown26', password: 'wrong-password' }); // 실패한 로그인 시도
        } // 제한 검사 끝
        check((await request('POST', '/api/auth/login', { login_id: signup.login_id, password: signup.password })).status === 429, '로그인 반복 시도 제한'); // 무차별 시도 방어
        check((await request('GET', '/login.html')).status === 200 && (await request('GET', '/register.html')).status === 200, '회원가입·로그인 페이지 제공'); // 화면 경로 검사
        console.log('회원 인증 ' + passed + '개 통과'); // 최종 집계
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
