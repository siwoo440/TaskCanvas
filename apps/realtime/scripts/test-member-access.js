'use strict'; // 엄격한 자바스크립트 검사
const fs = require('fs'); // 스키마 읽기
const path = require('path'); // 경로 계산
const crypto = require('crypto'); // 임시 DB 이름과 해시
const { spawn } = require('child_process'); // 실제 PHP 서버
const mysql = require('mysql2/promise'); // 실제 MariaDB 연결
const { io } = require('socket.io-client'); // 실제 실시간 클라이언트
const net = require('net'); // 테스트 포트 사전 예약
const env = require('../src/env'); // 개발 DB 설정
const ROOT = path.resolve(__dirname, '../../..'); // 저장소 경로
const PHP = process.env.PHP_BIN || (process.platform === 'win32' ? 'C:/xampp/php/php.exe' : 'php'); // PHP 실행 파일
const PORT = Number(process.env.AUTH_TEST_PORT || 0); // 기본값은 가용한 임의 포트
let BASE = ''; // 예약 이후 확정할 테스트 서버 주소
const DB_NAME = 'taskcanvas_d27_' + crypto.randomBytes(8).toString('hex'); // 이번 실행만 사용하는 DB
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

async function request(method, route, body, cookie = '', protectedHeader = true, base = BASE) // 실제 HTTP 요청
{ // 요청 시작
    const headers = { 'Content-Type': 'application/json', Cookie: cookie }; // 본문과 쿠키
    if (protectedHeader) // 정상 클라이언트 헤더 여부
    { // 보호 헤더 추가
        headers['X-TaskCanvas'] = '1'; // 요청 위조 방어 헤더
    } // 보호 헤더 끝
    const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); // 실제 API 호출
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

function ack(socket, event, payload) // 제한 시간 있는 실시간 요청
{ // 요청 시작
    return new Promise((resolve) => // 응답 결과
    { // 응답 대기
        const timer = setTimeout(() => resolve({ ok: false, timeout: true }), 2500); // 무응답 한도
        socket.emit(event, payload, (reply) => // 서버 ACK
        { // 응답 처리
            clearTimeout(timer); // 대기 해제
            resolve(reply); // 실제 결과
        }); // 응답 처리 끝
    }); // 요청 약속 끝
} // 요청 끝

function merge(oldCookie, newCookie) // 발급된 쿠키별 덮어쓰기
{ // 쿠키 병합 시작
    const values = new Map(); // 이름별 쿠키
    for (const item of (oldCookie + '; ' + newCookie).split('; ')) // 모든 쿠키 순회
    { // 쿠키 저장
        if (item.includes('=')) // 빈 항목 제외
        { // 이름 추출
            values.set(item.split('=')[0], item); // 같은 이름만 교체
        } // 저장 끝
    } // 순회 끝
    return [...values.values()].join('; '); // HTTP 쿠키 헤더
} // 병합 끝

async function main() // 인증 통합 검증
{ // 검증 실행 시작
    const port = await availablePort(); // DB 변경 전에 포트 충돌 차단
    BASE = 'http://127.0.0.1:' + port; // 실제 검사 주소
    const options = { host: env.get('DB_HOST'), port: env.int('DB_PORT'), user: env.get('DB_USER'), password: env.get('DB_PASS'), charset: 'utf8mb4', multipleStatements: true }; // 개발용 서버 접속
    const admin = await mysql.createConnection(options); // DB 생성 전용 연결
    let db = null; // 테스트 DB 연결
    let secondary = null; // 동시 HTTP 요청 서버
    let realtime = null; // 테스트 실시간 서버
    const sockets = []; // 정리할 클라이언트
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
        check((await request('GET', '/api/auth/workspaces')).status === 401, '회원 작업실 인증 필요'); // 신규 경로 검사
        const secondPort = await availablePort(); // 동시 실행용 PHP 포트
        const secondBase = 'http://127.0.0.1:' + secondPort; // 독립 PHP 주소
        secondary = spawn(PHP, ['-S', '127.0.0.1:' + secondPort, '-t', 'apps/frontend/public', routerPath], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, TC_AUTH_TEST_NONCE: nonce, DB_NAME, DB_HOST: options.host, DB_PORT: String(options.port), DB_USER: options.user, DB_PASS: options.password, USER_SESSION_COOKIE: 'tc_user_session', COOKIE_SECURE: '0', RATE_LIMIT: '1000' } }); // 같은 테스트 DB의 두 번째 서버
        let secondError = null; // 두 번째 서버 오류
        secondary.once('error', (error) => // 시작 오류 감지
        { // 오류 기록
            secondError = error; // 본인 서버 시작 실패
        }); // 감지 끝
        secondary.once('exit', (code) => // 포트 충돌 감지
        { // 종료 기록
            secondError = new Error('동시 PHP 종료 ' + code); // 조기 종료 원인
        }); // 종료 감지 끝
        let secondReady = false; // 실제 서버 확인
        for (let attempt = 0; attempt < 40; attempt += 1) // 준비 확인 한도
        { // 본인 서버 확인
            if (secondError) // 프로세스 실패
            { // 실행 중단
                throw secondError; // 다른 서버로 진행 금지
            } // 오류 검사 끝
            try // 읽기 전용 식별 요청
            { // 준비 요청
                const probe = await request('GET', '/api/health', undefined, '', true, secondBase); // 별도 주소 조회
                if (probe.status === 200 && probe.headers.get('x-taskcanvas-test') !== nonce) // 타 서버 응답
                { // 외부 대상 차단
                    throw new Error('동시 서버 식별 불일치'); // 변경 요청 금지
                } // 식별 검사 끝
                secondReady = probe.status === 200; // 준비 결과
            } // 준비 요청 끝
            catch (error) // 시작 중 연결 거부
            { // 오류 분류
                if (error.message.includes('식별')) // 잘못된 대상
                { // 검사 중단
                    throw error; // 실제 충돌 전달
                } // 분류 끝
            } // 연결 오류 끝
            if (secondReady) // 본인 서버 준비
            { // 준비 종료
                break; // 동시 요청 시작
            } // 준비 끝
            await new Promise((resolve) => setTimeout(resolve, 100)); // 시작 재확인
        } // 준비 순회 끝
        check(secondReady && !secondError, '동시 HTTP 검사 서버 식별'); // 변경 전 대상 검증
        const rtPort = await availablePort(); // 별도 실시간 포트
        realtime = spawn(process.execPath, ['src/server.js'], { cwd: path.join(ROOT, 'apps/realtime'), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: String(rtPort), DB_NAME, DB_HOST: options.host, DB_PORT: String(options.port), DB_USER: options.user, DB_PASS: options.password, CORS_ORIGIN: 'auto' } }); // 임시 DB 실시간 서버
        await new Promise((resolve, reject) => // 서버 수신 시작 확인
        { // 시작 대기
            const timer = setTimeout(() => reject(new Error('실시간 서버 시작 시간 초과')), 5000); // 대기 한도
            realtime.once('error', reject); // 실행 오류
            realtime.once('exit', (code) => reject(new Error('실시간 서버 조기 종료 ' + code))); // 포트 충돌 차단
            realtime.stdout.on('data', (chunk) => // 본인 서버의 시작 로그
            { // 로그 확인
                if (chunk.toString().includes('TaskCanvas')) // 수신 시작 로그
                { // 준비 완료
                    clearTimeout(timer); // 대기 해제
                    resolve(); // 본인 프로세스 준비
                } // 로그 확인 끝
            }); // 로그 감시 끝
        }); // 시작 대기 끝
        const connect = async (cookie, scope) => // 실제 일회성 티켓 참여
        { // 클라이언트 생성
            const issued = await request('POST', '/api/realtime-ticket', scope, cookie); // 서버 발급 티켓
            const socket = io('http://127.0.0.1:' + rtPort, { transports: ['websocket'], reconnection: false }); // 별도 연결
            sockets.push(socket); // 정리 예약
            await new Promise((resolve, reject) => // 연결 확인
            { // 연결 대기
                socket.once('connect', resolve); // 연결 성공
                socket.once('connect_error', reject); // 연결 오류
            }); // 연결 대기 끝
            const reply = await ack(socket, scope.board_id ? 'board:join' : 'project:join', { ...scope, ticket: issued.data.ticket }); // 참여 검증
            check(reply.ok, '유효한 티켓 실시간 참여'); // 참여 성공
            return socket; // 연결 반환
        }; // 참여 헬퍼 끝
        const password = 'Member-access-27!'; // 가상 비밀번호
        const accounts = []; // 테스트 회원 목록
        for (const id of ['alpha27', 'bravo27']) // 서로 다른 회원
        { // 회원 준비
            await request('POST', '/api/auth/register', { login_id: id, display_name: id, password, password_confirm: password }); // 가상 가입
            accounts.push(await request('POST', '/api/auth/login', { login_id: id, password })); // 가상 로그인
        } // 회원 준비 끝
        let a = accounts[0].cookie; // 회원 A 쿠키
        let b = accounts[1].cookie; // 회원 B 쿠키
        const made = await request('POST', '/api/projects', { display_name: 'alpha27', title: 'A 작업실' }, a); // 회원 작업실 생성
        check(made.status === 201, '회원 작업실 생성'); // 생성 성공
        a = merge(a, made.cookie); // 게스트 쿠키 갱신
        const project = made.data.project.project_id; // 생성 작업실
        const board = made.data.board.board_id; // 생성 보드
        check((await request('GET', '/api/auth/workspaces', undefined, a)).data.projects.length === 1, '본인 작업실 목록'); // 목록 소유
        check((await request('GET', '/api/projects/' + project + '/boards', undefined, b)).status === 403, '다른 회원 작업실 접근 거부'); // 권한 격리
        check((await request('POST', '/api/auth/workspaces/select', { project_id: project, guest_id: made.data.guest.guest_id }, b)).status === 403, '본문 ID 위조로 회원 전환 불가'); // 식별자 위조
        const invite = await request('POST', '/api/projects/' + project + '/invites', { role: 'viewer', days: 1, max_uses: 1 }, a); // 열람자 초대
        const joined = await request('POST', '/api/auth/workspaces/join', { invite_code: invite.data.code }, b); // 회원 초대 참여
        check(joined.status === 201 && joined.data.role === 'viewer', '회원 초대 역할 부여'); // 초대 가입
        b = merge(b, joined.cookie); // 회원 B 활성 세션
        check((await request('POST', '/api/auth/workspaces/join', { invite_code: invite.data.code }, b)).status === 201, '기존 회원 재입장'); // 멱등 가입
        const [[usage]] = await db.query('SELECT used_count FROM project_invites WHERE invite_id = ?', [invite.data.invite.invite_id]); // 초대 사용 횟수
        check(usage.used_count === 1, '재입장 초대 횟수 추가 차감 없음'); // 사용 한도
        check((await request('POST', '/api/projects/' + project + '/boards', { title: '금지 보드' }, b)).status === 403, 'viewer 편집 거부'); // 역할 검사
        check((await request('POST', '/api/auth/workspaces/select', { project_id: project }, a, false)).status === 403, '회원 전환 CSRF 헤더 필수'); // 요청 보호
        const outsider = await request('POST', '/api/projects', { display_name: '외부 게스트', title: '외부 작업실' }); // 미연결 외부인
        await request('POST', '/api/auth/register', { login_id: 'charlie27', display_name: '신규회원', password, password_confirm: password }); // 추가 회원
        const c = await request('POST', '/api/auth/login', { login_id: 'charlie27', password }); // 초대 한도 대상
        check((await request('POST', '/api/auth/workspaces/join', { invite_code: invite.data.code }, c.cookie)).status === 401, '초대 신규 가입 한도 초과 거부'); // 한도 차단
        check((await request('POST', '/api/auth/workspaces/join', { invite_code: made.data.owner_code }, c.cookie)).data.error.code === 'REENTRY_ONLY', '재입장 전용 코드 신규 회원 거부'); // 관리자 코드 보호
        const expiring = await request('POST', '/api/projects/' + project + '/invites', { role: 'editor', days: 1 }, a); // 만료 대상
        await db.query('UPDATE project_invites SET expires_at = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE invite_id = ?', [expiring.data.invite.invite_id]); // 테스트 초대만 만료
        check((await request('POST', '/api/auth/workspaces/join', { invite_code: expiring.data.code }, c.cookie)).status === 401, '만료 초대 거부'); // 기간 검사
        await db.query('UPDATE project_invites SET expires_at = DATE_ADD(NOW(), INTERVAL 1 DAY), revoked_at = NOW() WHERE invite_id = ?', [expiring.data.invite.invite_id]); // 폐기 초대
        check((await request('POST', '/api/auth/workspaces/join', { invite_code: expiring.data.code }, c.cookie)).status === 401, '폐기 초대 거부'); // 폐기 검사
        const editing = await request('POST', '/api/projects/' + project + '/invites', { role: 'editor', days: 1 }, a); // 편집자 초대
        const editor = await request('POST', '/api/auth/workspaces/join', { invite_code: editing.data.code }, c.cookie); // 편집자 가입
        const editorCookie = merge(c.cookie, editor.cookie); // 편집자 세션
        check((await request('POST', '/api/projects/' + project + '/boards', { title: '편집 보드' }, editorCookie)).status === 201, 'editor 보드 생성 허용'); // 편집 권한
        check((await request('POST', '/api/projects/' + project + '/rename', { title: '권한 상승' }, editorCookie)).status === 403, 'editor 관리자 작업 거부'); // 관리 권한
        const duplicate = await request('POST', '/api/projects', { display_name: '별도 기존 참여자', title: '중복 멤버십' }); // 별도 게스트
        await db.query('INSERT INTO guest_user_links (guest_id, user_id) VALUES (?, ?)', [duplicate.data.guest.guest_id, accounts[1].data.user.user_id]); // 테스트의 보유 게스트
        await db.query("INSERT INTO project_members (project_id, guest_id, role) VALUES (?, ?, 'editor')", [project, duplicate.data.guest.guest_id]); // 추가 보유 역할
        const highest = await request('POST', '/api/auth/workspaces/select', { project_id: project }, b); // 최고 역할 선택
        check(highest.data.role === 'editor' && highest.data.guest.guest_id === duplicate.data.guest.guest_id, '여러 본인 게스트의 최고 역할 선택'); // 보유 역할 결정
        b = merge(b, highest.cookie); // 새 선택 쿠키
        const raceGuest = await request('POST', '/api/projects', { display_name: '동시 연결 게스트', title: '동시 연결 작업실' }); // 경쟁 대상
        const competing = await Promise.all([request('POST', '/api/auth/guest-link', { password }, merge(a, raceGuest.cookie)), request('POST', '/api/auth/guest-link', { password }, merge(b, raceGuest.cookie), true, secondBase)]); // 서로 다른 회원의 동시 연결
        check(competing.filter((r) => r.status === 200).length === 1 && competing.every((r) => [200,401,409].includes(r.status)), '동시 회원 연결 한 명 성공·나머지 인증 거부'); // 소유 경쟁 무결성
        const [[raceOwner]] = await db.query('SELECT COUNT(*) AS n FROM guest_user_links WHERE guest_id = ?', [raceGuest.data.guest.guest_id]); // 단일 소유
        check(raceOwner.n === 1, '동시 연결 후 소유자 한 명'); // 중복 없음
        const raceName = await request('POST', '/api/projects', { display_name: '동시 이름 재입장', title: '이름 경쟁' }); // 이름 경로 경쟁
        const nameRace = await Promise.all([request('POST', '/api/auth/guest-link', { password }, merge(a, raceName.cookie)), request('POST', '/api/guest/join', { display_name: '동시 이름 재입장', invite_code: raceName.data.owner_code }, '', true, secondBase)]); // 연결과 이름 재사용 동시 실행
        check(nameRace[0].status === 200 && (nameRace[1].status === 403 || (nameRace[1].status === 201 && (await request('GET', '/api/me', undefined, nameRace[1].cookie)).status === 401)), '연결과 이름 재입장 경쟁 후 탈취 세션 거부'); // 이전 권한 잔존 없음
        const raceProject = await request('POST', '/api/projects', { display_name: 'alpha27', title: '동시 가입 작업실' }, a); // 신규 초대 작업실
        const raceInvite = await request('POST', '/api/projects/' + raceProject.data.project.project_id + '/invites', { role: 'viewer', days: 1, max_uses: 1 }, merge(a, raceProject.cookie)); // 한 명 제한
        const joins = await Promise.all([request('POST', '/api/auth/workspaces/join', { invite_code: raceInvite.data.code }, b), request('POST', '/api/auth/workspaces/join', { invite_code: raceInvite.data.code }, b, true, secondBase)]); // 동일 회원 동시 가입
        const [[raceUses]] = await db.query('SELECT used_count FROM project_invites WHERE invite_id = ?', [raceInvite.data.invite.invite_id]); // 차감 결과
        check(joins.every((r) => r.status === 201) && raceUses.used_count === 1, '동일 회원 동시 가입의 초대 차감 한 번'); // 회원 잠금 검증
        const legacy = await request('POST', '/api/projects', { display_name: '기존 소유자', title: '기존 작업실' }); // 미연결 게스트
        const oldGuest = legacy.cookie; // 이전 게스트 쿠키
        const oldTicket = await request('POST', '/api/realtime-ticket', { board_id: legacy.data.board.board_id }, oldGuest); // 연결 전 티켓
        await db.query("CREATE TRIGGER fail_link_session BEFORE INSERT ON guest_sessions FOR EACH ROW BEGIN IF NEW.guest_id = " + legacy.data.guest.guest_id + " AND NEW.user_session_id IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test-only-session-insert-failure'; END IF; END"); // 신규 결합 세션 저장 실패 재현
        const failedLink = await request('POST', '/api/auth/guest-link', { password }, merge(a, oldGuest)); // 실패 지점까지 실제 연결
        await db.query('DROP TRIGGER fail_link_session'); // 검사 트리거 정리
        const [[failedOwner]] = await db.query('SELECT COUNT(*) AS n FROM guest_user_links WHERE guest_id = ?', [legacy.data.guest.guest_id]); // 실패 후 소유
        const [[keptTicket]] = await db.query('SELECT COUNT(*) AS n FROM realtime_tickets WHERE ticket_hash = ?', [crypto.createHash('sha256').update(oldTicket.data.ticket).digest('hex')]); // 기존 티켓 보존
        check(failedLink.status === 500 && failedOwner.n === 0 && keptTicket.n === 1 && (await request('GET', '/api/me', undefined, oldGuest)).status === 200, '신규 세션 저장 실패 시 소유·이전 세션·티켓 전체 롤백'); // 연결 원자성 회귀
        const combined = merge(a, oldGuest); // 회원과 현재 게스트
        check((await request('POST', '/api/auth/guest-link', { password: 'wrong' }, combined)).status === 401, '게스트 연결 비밀번호 재확인'); // 본인 비밀번호
        const legacySocket = await connect(oldGuest, { board_id: legacy.data.board.board_id }); // 연결 전 활성 게스트 소켓
        const linked = await request('POST', '/api/auth/guest-link', { password, guest_id: 999 }, combined); // 서버 세션에서 대상 결정
        check(linked.status === 200 && linked.data.guest.guest_id === legacy.data.guest.guest_id, '유효한 현재 게스트만 회원 연결'); // 소유 연결
        await new Promise((resolve) => setTimeout(resolve, 1400)); // 연결 폐기 감시
        check(!legacySocket.connected, '회원 연결 전 활성 게스트 소켓 해제'); // 이전 권한 정리
        a = merge(a, linked.cookie); // 연결 후 쿠키
        check((await request('GET', '/api/me', undefined, oldGuest)).status === 401, '연결 전 게스트 쿠키 거부'); // 권한 잔존 차단
        check((await request('GET', '/api/me', undefined, linked.cookie)).status === 401, '회원 쿠키 없는 연결 게스트 거부'); // 결합 인증
        check((await request('POST', '/api/auth/guest-link', { password }, a)).status === 200, '같은 회원 연결 멱등 처리'); // 중복 연결
        check((await request('POST', '/api/guest/join', { display_name: '기존 소유자', invite_code: legacy.data.owner_code })).status === 403, '이름 재입장으로 회원 게스트 탈취 차단'); // 이름 경로 보호
        const chosen = await request('POST', '/api/auth/workspaces/select', { project_id: project }, a); // 회원 작업실 전환
        check(chosen.status === 200 && chosen.data.role === 'admin', '본인 작업실 전환'); // 역할 복원
        a = merge(a, chosen.cookie); // 선택 세션
        check((await request('GET', '/api/me', undefined, a)).data.projects.length >= 3, '연결한 게스트의 여러 작업실 조회'); // 다중 작업실
        const ticket = await request('POST', '/api/realtime-ticket', { board_id: board }, a); // 회원 티켓
        check(ticket.status === 201, '회원 세션 결합 티켓 발급'); // 티켓 생성
        const [[bound]] = await db.query('SELECT guest_session_id FROM realtime_tickets WHERE ticket_hash = ?', [crypto.createHash('sha256').update(ticket.data.ticket).digest('hex')]); // 저장 결합
        check(Boolean(bound.guest_session_id), '티켓 발급 게스트 세션 저장'); // 세션 참조
        const boardSocket = await connect(a, { board_id: board }); // 활성 보드 연결
        const projectSocket = await connect(a, { project_id: project }); // 활성 작업실 연결
        await request('POST', '/api/auth/logout', {}, a); // 회원 로그아웃
        const deniedSocket = io('http://127.0.0.1:' + rtPort, { transports: ['websocket'], reconnection: false }); // 폐기 티켓 재사용
        sockets.push(deniedSocket); // 정리 예약
        await new Promise((resolve, reject) => // 연결 대기
        { // 연결 처리
            deniedSocket.once('connect', resolve); // 연결 완료
            deniedSocket.once('connect_error', reject); // 연결 오류
        }); // 연결 대기 끝
        const denied = await ack(deniedSocket, 'board:join', { board_id: board, ticket: ticket.data.ticket }); // 로그아웃 전 미사용 티켓
        check(!denied.ok, '로그아웃 전 미사용 티켓 거부'); // 잔존 권한 차단
        const postLogout = await ack(boardSocket, 'object:create', { board_id: board, type: 'rect', x: 0, y: 0, width: 100, height: 100 }); // 폐기 후 이벤트
        check(!postLogout.ok && (!boardSocket.connected || postLogout.error?.code === 'SESSION_EXPIRED'), '로그아웃 후 수신 이벤트 거부'); // 이벤트 가드
        await new Promise((resolve) => setTimeout(resolve, 1600)); // 유휴 인증 감시 대기
        check(!boardSocket.connected && !projectSocket.connected, '유휴 보드·작업실 연결 해제'); // 수신 방 제거
        check((await request('GET', '/api/me', undefined, a)).status === 401, '회원 로그아웃 후 게스트 접근 거부'); // 세션 폐기
        check((await request('GET', '/api/me', undefined, b)).status === 200, '다른 회원 세션 보존'); // 독립 회원
        const fresh = await request('POST', '/api/auth/login', { login_id: 'alpha27', password }); // 만료 검사 회원 로그인
        let freshCookie = fresh.cookie; // 새 회원·게스트 쿠키
        const selectFresh = await request('POST', '/api/auth/workspaces/select', { project_id: project }, freshCookie); // 작업실 선택
        freshCookie = merge(freshCookie, selectFresh.cookie); // 정확한 활성 게스트
        const preserved = await request('POST', '/api/auth/login', { login_id: 'alpha27', password }); // 다른 브라우저 세션
        const expiringSocket = await connect(freshCookie, { board_id: board }); // 만료 대상 소켓
        const expiringTicket = await request('POST', '/api/realtime-ticket', { board_id: board }, freshCookie); // 만료 대상 티켓
        await db.query('UPDATE user_sessions u JOIN guest_sessions g ON g.user_session_id = u.session_id SET u.expires_at = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE g.token_hash = ?', [crypto.createHash('sha256').update(selectFresh.cookie.split('=')[1]).digest('hex')]); // 해당 브라우저 회원만 만료
        check((await request('GET', '/api/me', undefined, freshCookie)).status === 401, '회원 만료 후 HTTP 거부'); // 만료 경계
        await new Promise((resolve) => setTimeout(resolve, 1400)); // 유휴 감시 대기
        check(!expiringSocket.connected, '회원 만료 후 유휴 소켓 해제'); // 만료 소켓
        check((await request('GET', '/api/me', undefined, preserved.cookie)).status === 200, '같은 회원의 다른 브라우저 세션 보존'); // 세션별 격리
        const restored = await request('POST', '/api/auth/login', { login_id: 'alpha27', password }); // 재로그인 준비
        const rotatedSocket = await connect(restored.cookie, { project_id: project }); // 교체 대상 연결
        const replacement = await request('POST', '/api/auth/login', { login_id: 'alpha27', password }, restored.cookie); // 현재 브라우저 교체
        check((await request('GET', '/api/me', undefined, restored.cookie)).status === 401 && (await request('GET', '/api/me', undefined, replacement.cookie)).status === 200, '재로그인 후 이전 종속 세션 거부·새 세션 허용'); // 교체 범위
        await new Promise((resolve) => setTimeout(resolve, 1400)); // 교체 감시 대기
        check(!rotatedSocket.connected, '재로그인 교체 후 이전 작업실 소켓 해제'); // 이전 연결 차단
        const revokedSocket = await connect(b, { board_id: board }); // 현재 편집자 소켓
        await db.query('DELETE FROM project_members WHERE project_id = ? AND guest_id = ?', [project, highest.data.guest.guest_id]); // 테스트 멤버십만 제거
        check((await request('GET', '/api/projects/' + project + '/boards', undefined, b)).status === 403, '멤버십 제거 후 HTTP 접근 거부'); // 역할 소멸
        await new Promise((resolve) => setTimeout(resolve, 1400)); // 유휴 권한 감시
        check(!revokedSocket.connected, '멤버십 제거 후 유휴 소켓 해제'); // 방 제거
        const guestExpiry = await request('POST', '/api/auth/workspaces/select', { project_id: project }, replacement.cookie); // 게스트 만료 대상
        const guestExpiryCookie = merge(replacement.cookie, guestExpiry.cookie); // 선택된 쿠키
        const guestExpirySocket = await connect(guestExpiryCookie, { project_id: project }); // 작업실 소켓
        await db.query('UPDATE guest_sessions SET expires_at = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE token_hash = ?', [crypto.createHash('sha256').update(guestExpiry.cookie.split('=')[1]).digest('hex')]); // 해당 게스트 세션만 만료
        check((await request('GET', '/api/me', undefined, guestExpiryCookie)).status === 401, '게스트 세션 만료 후 HTTP 거부'); // 만료 경계
        await new Promise((resolve) => setTimeout(resolve, 1400)); // 유휴 감시
        check(!guestExpirySocket.connected, '게스트 세션 만료 후 유휴 소켓 해제'); // 수신 중단
        console.log('회원 접근 ' + passed + '개 통과'); // 결과 집계
    } // 테스트 본문 끝
    finally // 전용 자원 정리
    { // 정리 시작
        for (const socket of sockets) // 생성한 연결만 정리
        { // 연결 종료
            socket.disconnect(); // 테스트 소켓 해제
        } // 연결 정리 끝
        if (secondary && secondary.exitCode === null) // 동시 검사 PHP
        { // 별도 프로세스 정리
            const stopped = new Promise((resolve) => secondary.once('exit', resolve)); // 종료 완료
            secondary.kill(); // 본인 PHP 종료
            await stopped; // DB 종료 확인
        } // 별도 정리 끝
        if (realtime && realtime.exitCode === null) // 실행 중인 테스트 Node
        { // Node 종료
            const stopped = new Promise((resolve) => realtime.once('exit', resolve)); // 종료 대기
            realtime.kill(); // 본인 서버만 종료
            await stopped; // DB 종료 확인
        } // Node 정리 끝
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
