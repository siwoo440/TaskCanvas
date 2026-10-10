// 수용 테스트 러너: PHP 내장 서버(8081)와 실시간 서버(3002)를 직접 띄우고 docs/11 의 AC01~AC14, AC16~AC23, AC26~AC32 와 보안 점검 SEC01·SEC02, 운영 점검 OPS01 을 자동 검사
// 사용법: node scripts/acceptance.js   (MariaDB 실행 중, apps/php-api/.env 준비 필요. PHP 경로는 PHP_BIN 환경 변수로 변경)
'use strict';

const { spawn, execFileSync } = require('child_process'); // 서버·CLI 실행
const fs = require('fs'); // 표본 파일 읽기
const http = require('http'); // 출처 헤더를 직접 지정한 요청
const path = require('path'); // 경로 계산
const { io } = require('socket.io-client'); // 테스트용 클라이언트

const ROOT = path.resolve(__dirname, '..', '..', '..'); // 저장소 루트
const PHP_API = path.join(ROOT, 'apps', 'php-api'); // PHP API 폴더
const PHP = process.env.PHP_BIN || (process.platform === 'win32' ? 'C:/xampp/php/php.exe' : 'php'); // PHP 실행 파일
const API_PORT = Number(process.env.AC_API_PORT || 8081); // 테스트용 PHP 포트
const RT_PORT = Number(process.env.AC_RT_PORT || 3002); // 테스트용 실시간 포트
const API = 'http://127.0.0.1:' + API_PORT; // PHP API 주소
const RT = 'http://127.0.0.1:' + RT_PORT; // 실시간 서버 주소
const FIXTURES = path.join(__dirname, 'fixtures'); // 표본 이미지 폴더

const results = []; // {id, name, status, detail}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); // 대기

function record(id, name, ok, detail)
{
    results.push({ id, name, status: ok === null ? 'MANUAL' : ok ? 'PASS' : 'FAIL', detail: detail ?? '' }); // 결과 기록
    console.log((ok === null ? 'MANUAL' : ok ? 'PASS  ' : 'FAIL  ') + ' ' + id + ' ' + name + (detail ? ' — ' + detail : '')); // 즉시 출력
}

// ---------- 서버 준비 ----------

async function waitFor(url, tries = 50)
{
    for (let i = 0; i < tries; i++)
    {
        try
        {
            const res = await fetch(url); // 상태 확인
            if (res.ok)
            {
                return; // 준비 완료
            }
        }
        catch (err)
        {
            // 아직 준비 안 됨
        }
        await sleep(200); // 재시도 간격
    }
    throw new Error(url + ' 가 응답하지 않습니다.'); // 시작 실패
}

function startServers()
{
    const php = spawn(PHP, ['-S', '127.0.0.1:' + API_PORT, '-t', 'apps/frontend/public', 'apps/php-api/public/index.php'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, RATE_LIMIT: '1000' } }); // PHP 내장 서버(테스트는 입장이 잦으므로 요청 제한 완화)
    const rt = spawn(process.execPath, ['src/server.js'], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, PORT: String(RT_PORT), LOCK_TTL_MS: '1500', LOCK_SWEEP_MS: '300', BOARD_SWEEP_MS: '300', CORS_ORIGIN: 'auto' } }); // 실시간 서버(짧은 잠금 TTL·보드 감시 주기, 출처 검사는 기본값으로 고정)
    php.stderr.on('data', (d) => { if (/PHP (Fatal|Parse|Warning)/.test(String(d))) { console.error('[php] ' + String(d).trim()); } }); // PHP 오류만 표시
    rt.stderr.on('data', (d) => console.error('[realtime] ' + String(d).trim())); // 실시간 서버 오류 표시
    return { php, rt }; // 프로세스 핸들
}

function phpCli(script, args)
{
    return execFileSync(PHP, [path.join(PHP_API, 'bin', script), ...args], { cwd: PHP_API, encoding: 'utf8' }); // 개발용 CLI 실행
}

function setupProject()
{
    const out = phpCli('create-project.php', ['AC Project ' + Date.now(), 'Board A', 'Board B']); // 프로젝트·보드 생성
    const boards = [...out.matchAll(/board_id=(\d+)/g)].map((m) => Number(m[1])); // 보드 ID
    const projectId = Number(/project_id=(\d+)/.exec(out)[1]); // 프로젝트 ID
    const adminCode = /관리자 초대 코드: (\S+)/.exec(out)[1]; // create-project 가 한 번 출력하는 최초 관리자 코드
    const editorCode = /초대 코드: (\S+)/.exec(phpCli('create-invite.php', [String(projectId), 'editor', '1']))[1]; // 편집자 코드
    const viewerCode = /초대 코드: (\S+)/.exec(phpCli('create-invite.php', [String(projectId), 'viewer', '1']))[1]; // 열람자 코드
    return { projectId, boardA: boards[0], boardB: boards[1], adminCode, editorCode, viewerCode }; // 테스트 환경
}

// ---------- 호출 도우미 ----------

async function api(method, p, body, cookie)
{
    const res = await fetch(API + p, {
        method, // 메서드
        headers: { ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), 'X-TaskCanvas': '1', ...(cookie ? { Cookie: cookie } : {}) }, // 필수 헤더
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), // 본문
    }); // HTTP 호출
    let json = null; // 응답 본문
    try
    {
        json = await res.json(); // JSON 파싱
    }
    catch (err)
    {
        json = null; // JSON 아님
    }
    return { status: res.status, json, headers: res.headers, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] }; // 응답 요약
}

async function join(name, code)
{
    const res = await api('POST', '/api/guest/join', { display_name: name, invite_code: code }); // 게스트 입장
    return { ...res, cookie: res.cookie }; // 세션 쿠키 포함
}

async function ticket(cookie, boardId)
{
    return (await api('POST', '/api/realtime-ticket', { board_id: boardId }, cookie)).json.ticket; // 티켓 원문
}

function connect()
{
    const socket = io(RT, { transports: ['websocket'], reconnection: false }); // 소켓 생성
    return new Promise((resolve) => socket.on('connect', () => resolve(socket))); // 연결 대기
}

// 요청을 보내고 응답(ack)을 기다린다. 15초 안에 답이 없으면 러너가 멈추지 않게 NO_ACK 오류로 돌려주고 어느 요청인지 남긴다
const ack = (socket, event, data) => new Promise((resolve) =>
{
    const timer = setTimeout(() =>
    {
        console.error('응답 없음: ' + event + ' ' + JSON.stringify(data).slice(0, 120)); // 멈춘 요청 기록
        resolve({ ok: false, error: { code: 'NO_ACK', message: '서버가 응답하지 않았습니다.' } }); // 실패로 처리
    }, 15000); // 응답 대기 제한
    socket.emit(event, data, (reply) =>
    {
        clearTimeout(timer); // 타이머 해제
        resolve(reply); // 서버 응답
    });
}); // ack 프로미스

// 브라우저처럼 Origin 헤더를 붙여 웹소켓 연결을 시도한다. 연결되면 true, 거부되면 false
function connectFrom(originHeader)
{
    return new Promise((resolve) =>
    {
        const socket = io(RT, { transports: ['websocket'], reconnection: false, timeout: 3000, extraHeaders: { Origin: originHeader } }); // 출처를 지정한 소켓
        socket.on('connect', () =>
        {
            socket.disconnect(); // 확인만 하고 끊음
            resolve(true); // 허용됨
        });
        socket.on('connect_error', () =>
        {
            socket.close(); // 정리
            resolve(false); // 거부됨
        });
    });
}

// 폴링 방식의 첫 연결 요청을 Origin 헤더와 함께 보내고 상태 코드와 CORS 허용 헤더를 돌려준다
function pollingHandshake(originHeader)
{
    return new Promise((resolve) =>
    {
        const req = http.get(RT + '/socket.io/?EIO=4&transport=polling', { headers: originHeader ? { Origin: originHeader } : {} }, (res) =>
        {
            res.resume(); // 본문은 쓰지 않음
            resolve({ status: res.statusCode, allow: res.headers['access-control-allow-origin'] ?? null }); // 결과 요약
        });
        req.on('error', () => resolve({ status: 0, allow: null })); // 연결 실패
    });
}

function once(socket, event, timeoutMs = 2500)
{
    return new Promise((resolve) =>
    {
        const timer = setTimeout(() => resolve(null), timeoutMs); // 시간 초과 시 null
        socket.once(event, (payload) =>
        {
            clearTimeout(timer); // 타이머 해제
            resolve(payload); // 수신 데이터
        });
    });
}

function until(socket, event, predicate, timeoutMs = 2500)
{
    return new Promise((resolve) =>
    {
        const timer = setTimeout(() =>
        {
            socket.off(event, handler); // 리스너 해제
            resolve(null); // 시간 초과
        }, timeoutMs);
        function handler(payload)
        {
            if (predicate(payload))
            {
                clearTimeout(timer); // 타이머 해제
                socket.off(event, handler); // 리스너 해제
                resolve(payload); // 조건에 맞는 이벤트(다른 소켓 ack 와의 순서 차이로 먼저 온 이전 이벤트는 건너뜀)
            }
        }
        socket.on(event, handler); // 조건 대기
    });
}

async function enter(name, code, boardId)
{
    const session = await join(name, code); // HTTP 입장
    if (session.status !== 201)
    {
        throw new Error(name + ' 입장 실패: ' + JSON.stringify(session.json)); // 입장 오류를 그대로 보고
    }
    const socket = await connect(); // 소켓 연결
    const reply = await ack(socket, 'board:join', { board_id: boardId, ticket: await ticket(session.cookie, boardId) }); // 보드 참여
    return { cookie: session.cookie, socket, reply, guestId: session.json.guest.guest_id }; // 참여자 묶음
}

function imageForm(projectId, file, type, name)
{
    const form = new FormData(); // multipart 본문
    form.append('project_id', String(projectId)); // 프로젝트
    form.append('file', new Blob([file], { type }), name); // 파일
    return form; // 폼
}

// 작업실 직접 만들기를 꺼 둔 서버(ALLOW_WORKSPACE_CREATE=0)를 잠깐 띄워 만들기 요청이 거부되는지 본다
async function createWhenDisabled()
{
    const port = API_PORT + 100; // 임시 포트
    const php = spawn(PHP, ['-S', '127.0.0.1:' + port, '-t', 'apps/frontend/public', 'apps/php-api/public/index.php'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, RATE_LIMIT: '1000', ALLOW_WORKSPACE_CREATE: '0' } }); // 만들기를 꺼 둔 PHP 서버
    try
    {
        await waitFor('http://127.0.0.1:' + port + '/api/health'); // 준비 대기
        const res = await fetch('http://127.0.0.1:' + port + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TaskCanvas': '1' }, body: JSON.stringify({ display_name: 'AC-Off', title: 'AC Off' }) }); // 만들기 시도
        const body = await res.json(); // 응답 본문
        return { status: res.status, code: body.error ? body.error.code : null }; // 결과 요약
    }
    finally
    {
        php.kill(); // 임시 서버 종료
    }
}

// 작업실 삭제를 꺼 둔 서버(ALLOW_WORKSPACE_DELETE=0)를 잠깐 띄워 관리자의 삭제 요청도 거부되는지 본다
async function deleteWhenDisabled(url, cookie, title)
{
    const port = API_PORT + 101; // 임시 포트
    const php = spawn(PHP, ['-S', '127.0.0.1:' + port, '-t', 'apps/frontend/public', 'apps/php-api/public/index.php'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, RATE_LIMIT: '1000', ALLOW_WORKSPACE_DELETE: '0' } }); // 삭제를 끈 임시 서버(같은 DB)
    try
    {
        await waitFor('http://127.0.0.1:' + port + '/api/health'); // 준비 대기
        const res = await fetch('http://127.0.0.1:' + port + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TaskCanvas': '1', Cookie: cookie }, body: JSON.stringify({ confirm_title: title }) }); // 관리자의 올바른 삭제 요청
        const body = await res.json(); // 응답 본문
        return { status: res.status, code: body.error ? body.error.code : null }; // 결과 요약
    }
    finally
    {
        php.kill(); // 임시 서버 종료
    }
}

// ---------- 시나리오 ----------

async function run(envInfo)
{
    const { projectId, boardA, boardB, adminCode, editorCode, viewerCode } = envInfo; // 테스트 환경

    // AC01 게스트 참여
    const bad = await join('AC-Bad', 'WRONG-CODE-0000'); // 잘못된 코드
    const good = await join('AC-Editor', editorCode); // 유효한 코드
    record('AC01', '게스트 참여', bad.status === 401 && bad.json.error.code === 'INVALID_INVITE' && good.status === 201 && good.json.role === 'editor', '잘못된 코드 401, 유효 코드 201');

    const A = await enter('AC-A', editorCode, boardA); // 보드 A 편집자 A
    const B = await enter('AC-B', editorCode, boardA); // 보드 A 편집자 B
    const C = await enter('AC-C', editorCode, boardB); // 보드 B 편집자 C

    // AC02 보드 분리
    const rectA = await ack(A.socket, 'object:create', { board_id: boardA, type: 'rect', x: 0, y: 0, width: 50, height: 50 }); // 보드 A 객체
    const ellipseB = await ack(C.socket, 'object:create', { board_id: boardB, type: 'ellipse', x: 0, y: 0, width: 50, height: 50 }); // 보드 B 객체
    const crossBoard = await ack(A.socket, 'object:create', { board_id: boardB, type: 'rect', x: 0, y: 0, width: 50, height: 50 }); // A 소켓이 보드 B 에 생성 시도
    const snapA = (await api('GET', '/api/boards/' + boardA + '/snapshot', undefined, A.cookie)).json; // 보드 A 스냅샷
    const snapB = (await api('GET', '/api/boards/' + boardB + '/snapshot', undefined, A.cookie)).json; // 보드 B 스냅샷
    record('AC02', '보드 분리', rectA.ok && ellipseB.ok && crossBoard.ok === false && crossBoard.error.code === 'FORBIDDEN'
        && snapA.objects.every((o) => o.type === 'rect') && snapB.objects.every((o) => o.type === 'ellipse') && snapA.objects.length === 1 && snapB.objects.length === 1, '보드 A/B 객체 섞이지 않음, 타 보드 생성 FORBIDDEN');

    // AC03 펜 (그리는 중 표시)
    const previewPromise = once(B.socket, 'stroke:preview'); // B 가 받을 미리보기
    A.socket.emit('stroke:preview', { board_id: boardA, stroke_id: 'ac-stroke', points_delta: [[1, 1], [2, 2]], style: { color: '#ff0000', width: 3 } }); // A 그리는 중
    const preview = await previewPromise; // 수신
    const strokeCommit = await ack(A.socket, 'stroke:commit', { board_id: boardA, stroke_id: 'ac-stroke', points: [[1, 1], [2, 2], [3, 3]], style: { color: '#ff0000', width: 3 } }); // 확정
    record('AC03', '펜', preview !== null && preview.stroke_id === 'ac-stroke' && preview.points_delta.length === 2 && strokeCommit.ok && strokeCommit.persisted, '확정 전 미리보기 수신, 확정 저장');

    // AC04 도형 생성·이동·삭제 반영
    const createdPromise = until(B.socket, 'object:created', (d) => d.object.type === 'ellipse'); // 생성 전파
    const shape = await ack(A.socket, 'object:create', { board_id: boardA, type: 'ellipse', x: 10, y: 10, width: 40, height: 20 }); // 생성
    const created = await createdPromise; // 수신
    const lock1 = await ack(A.socket, 'object:lock', { board_id: boardA, object_id: shape.object_id }); // 잠금
    const updatedPromise = until(B.socket, 'object:updated', (d) => d.object.object_id === shape.object_id); // 이동 전파
    const moved = await ack(A.socket, 'object:commit', { board_id: boardA, object_id: shape.object_id, lock_token: lock1.lock_token, version: 1, changes: { x: 99, y: 88 } }); // 이동
    const updated = await updatedPromise; // 수신
    const lock2 = await ack(A.socket, 'object:lock', { board_id: boardA, object_id: shape.object_id }); // 삭제용 잠금
    const deletedPromise = until(B.socket, 'object:deleted', (d) => d.object_id === shape.object_id); // 삭제 전파
    const deleted = await ack(A.socket, 'object:delete', { board_id: boardA, object_id: shape.object_id, lock_token: lock2.lock_token, version: 2 }); // 삭제
    const deletedEvent = await deletedPromise; // 수신
    record('AC04', '도형', created !== null && created.object.object_id === shape.object_id && moved.ok && updated !== null && updated.object.x === 99 && deleted.ok && deletedEvent !== null && deletedEvent.object_id === shape.object_id, '생성·이동·삭제가 다른 참여자에게 반영');

    // AC05 커서
    const cursorPromise = once(B.socket, 'cursor:move'); // 커서 수신
    A.socket.emit('cursor:move', { board_id: boardA, x: 12, y: 34 }); // A 커서
    const cursor = await cursorPromise; // 수신
    const colors = B.reply.participants.map((p) => p.color); // 참여자 색상
    record('AC05', '커서', cursor !== null && cursor.display_name === 'AC-A' && cursor.x === 12 && cursor.y === 34 && typeof cursor.color === 'string' && new Set(colors).size === colors.length, '이름·좌표·색상 수신, 참여자별 색상 구분');

    // AC06 잠금
    const target = await ack(A.socket, 'object:create', { board_id: boardA, type: 'rect', x: 0, y: 0, width: 10, height: 10 }); // 잠금 대상
    const lockA = await ack(A.socket, 'object:lock', { board_id: boardA, object_id: target.object_id }); // A 잠금
    const lockB = await ack(B.socket, 'object:lock', { board_id: boardA, object_id: target.object_id }); // B 잠금 시도
    const commitB = await ack(B.socket, 'object:commit', { board_id: boardA, object_id: target.object_id, lock_token: 'x', version: 1, changes: { x: 5 } }); // B 수정 시도
    record('AC06', '잠금', lockA.ok && lockB.ok === false && lockB.error.code === 'OBJECT_LOCKED' && commitB.ok === false && commitB.error.code === 'OBJECT_LOCKED', 'A 잠금 중 B 의 잠금·수정 요청 차단');

    // AC07 잠금 해제: 완료·이탈·만료
    const unlockedByCommit = until(B.socket, 'object:unlocked', (d) => d.object_id === target.object_id && d.reason === 'committed'); // 완료 해제
    await ack(A.socket, 'object:commit', { board_id: boardA, object_id: target.object_id, lock_token: lockA.lock_token, version: 1, changes: { x: 1 } }); // 완료
    const u1 = await unlockedByCommit; // 수신
    const D = await enter('AC-D', editorCode, boardA); // 이탈 테스트용 참여자
    const lockD = await ack(D.socket, 'object:lock', { board_id: boardA, object_id: target.object_id }); // D 잠금
    const unlockedByDrop = until(B.socket, 'object:unlocked', (d) => d.object_id === target.object_id && d.reason === 'disconnected', 3000); // 이탈 해제
    D.socket.disconnect(); // D 연결 종료
    const u2 = await unlockedByDrop; // 수신
    const lockE = await ack(A.socket, 'object:lock', { board_id: boardA, object_id: target.object_id }); // 만료 테스트용 잠금
    const unlockedByExpiry = until(B.socket, 'object:unlocked', (d) => d.object_id === target.object_id && d.reason === 'expired', 4000); // 만료 해제(TTL 1.5초 + 검사 0.3초)
    const u3 = await unlockedByExpiry; // 수신
    const lockAfterExpiry = await ack(B.socket, 'object:lock', { board_id: boardA, object_id: target.object_id }); // 만료 후 B 잠금
    await ack(B.socket, 'object:unlock', { board_id: boardA, object_id: target.object_id, lock_token: lockAfterExpiry.lock_token }); // 정리
    record('AC07', '잠금 해제', lockD.ok && lockE.ok && u1 !== null && u1.reason === 'committed' && u2 !== null && u2.reason === 'disconnected' && u3 !== null && u3.reason === 'expired' && lockAfterExpiry.ok, '완료·이탈·만료 세 경우 모두 해제');

    // AC08 이미지 업로드 (PNG·JPG·WEBP)
    const uploads = []; // 업로드 결과
    for (const [file, type] of [['tiny.png', 'image/png'], ['tiny.jpg', 'image/jpeg'], ['tiny.webp', 'image/webp']])
    {
        const res = await api('POST', '/api/images', imageForm(projectId, fs.readFileSync(path.join(FIXTURES, file)), type, file), A.cookie); // 업로드
        const get = res.status === 201 ? await fetch(API + res.json.asset.url, { headers: { Cookie: A.cookie } }) : null; // 조회
        uploads.push({ file, status: res.status, mime: res.json && res.json.asset ? res.json.asset.mime_type : null, getStatus: get ? get.status : null, getType: get ? get.headers.get('content-type') : null, asset: res.json && res.json.asset ? res.json.asset : null }); // 기록
    }
    const imageObj = await ack(A.socket, 'object:create', { board_id: boardA, type: 'image', x: 0, y: 0, width: 4, height: 4, payload: { asset_id: uploads[0].asset ? uploads[0].asset.asset_id : 0 } }); // 이미지 객체
    record('AC08', '이미지', uploads.every((u) => u.status === 201 && u.getStatus === 200 && u.getType === u.mime) && imageObj.ok, uploads.map((u) => u.file + ':' + u.status).join(' '));

    // AC09 업로드 거부
    const gif = await api('POST', '/api/images', imageForm(projectId, fs.readFileSync(path.join(FIXTURES, 'tiny.gif')), 'image/gif', 'tiny.gif'), A.cookie); // GIF
    const fake = await api('POST', '/api/images', imageForm(projectId, fs.readFileSync(path.join(FIXTURES, 'not-image.png')), 'image/png', 'fake.png'), A.cookie); // 위장
    const big = await api('POST', '/api/images', imageForm(projectId, new Uint8Array(10 * 1024 * 1024 + 1), 'image/png', 'big.png'), A.cookie); // 10MB 초과
    record('AC09', '업로드 거부', gif.status === 415 && gif.json.error.code === 'INVALID_FILE' && fake.status === 415 && big.status === 413 && big.json.error.code === 'FILE_TOO_LARGE', 'GIF·위장 PNG 415, 10MB 초과 413');

    // AC10 추가 방식 (브라우저 UI)
    record('AC10', '추가 방식', null, '버튼·드래그·Ctrl+V 는 브라우저에서 수동 확인 (apps/frontend/README.md)');

    // AC11 영상
    const video = await ack(A.socket, 'object:create', { board_id: boardA, type: 'video', x: 0, y: 0, width: 480, height: 298, payload: { source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } }); // 허용 URL
    const badVideo = await ack(A.socket, 'object:create', { board_id: boardA, type: 'video', x: 0, y: 0, width: 480, height: 298, payload: { source_url: 'https://example.com/video' } }); // 비허용 URL
    record('AC11', '영상', video.ok && video.object.payload.embed_url === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' && badVideo.ok === false, '허용 URL 임베드 변환, 비허용 거부 (iframe 재생은 브라우저 수동 확인)');

    // AC12 자동 저장 (새로고침 = 스냅샷 재조회)
    const snapAfter = (await api('GET', '/api/boards/' + boardA + '/snapshot', undefined, B.cookie)).json; // 스냅샷
    const savedTarget = snapAfter.objects.find((o) => o.object_id === target.object_id); // 이동한 객체
    record('AC12', '자동 저장', snapAfter.objects.some((o) => o.type === 'stroke') && snapAfter.objects.some((o) => o.type === 'image') && snapAfter.objects.some((o) => o.type === 'video') && savedTarget && savedTarget.x === 1 && savedTarget.version === 2, '확정된 획·이미지·영상·이동 결과가 스냅샷에 존재');

    // AC13 재접속
    A.socket.disconnect(); // 연결 끊김
    await sleep(300); // 서버 정리 대기
    const reSocket = await connect(); // 재연결
    const rejoin = await ack(reSocket, 'board:join', { board_id: boardA, ticket: await ticket(A.cookie, boardA) }); // 새 티켓으로 재참여
    const snapRe = (await api('GET', '/api/boards/' + boardA + '/snapshot', undefined, A.cookie)).json; // 복원 스냅샷
    record('AC13', '재접속', rejoin.ok && rejoin.participants.some((p) => p.display_name === 'AC-A') && snapRe.objects.length === snapAfter.objects.length, '새 티켓 재참여, 마지막 저장 상태 복원');
    reSocket.disconnect(); // 정리

    // AC14 접근 권한 (열람자)
    const V = await enter('AC-Viewer', viewerCode, boardA); // 열람자
    const vBoard = await api('POST', '/api/projects/' + projectId + '/boards', { title: 'viewer board' }, V.cookie); // 보드 생성 시도
    const vUpload = await api('POST', '/api/images', imageForm(projectId, fs.readFileSync(path.join(FIXTURES, 'tiny.png')), 'image/png', 'v.png'), V.cookie); // 업로드 시도
    const vStroke = await ack(V.socket, 'stroke:commit', { board_id: boardA, points: [[0, 0]] }); // 펜 확정 시도
    const vCreate = await ack(V.socket, 'object:create', { board_id: boardA, type: 'rect', x: 0, y: 0, width: 5, height: 5 }); // 도형 생성 시도
    const vLock = await ack(V.socket, 'object:lock', { board_id: boardA, object_id: target.object_id }); // 잠금 시도
    const vSnap = await api('GET', '/api/boards/' + boardA + '/snapshot', undefined, V.cookie); // 열람은 허용
    record('AC14', '접근 권한', V.reply.ok && vBoard.status === 403 && vUpload.status === 403 && vStroke.ok === false && vStroke.error.code === 'FORBIDDEN' && vCreate.ok === false && vLock.ok === false && vSnap.status === 200, '열람자의 생성·업로드·확정·잠금 모두 서버가 거부, 조회는 허용');

    const C2 = await enter('AC-C2', editorCode, boardA); // 보드 A 의 두 번째 편집자(연결선·다중 선택 전파 확인용)

    // AC16 공유 업무: 보드 A 의 상태 변경이 보드 B 의 블럭에도 반영
    const taskCreatedPromise = until(C.socket, 'task:created', (d) => d.task.title === 'AC shared task'); // 보드 B 참여자가 받을 생성 알림
    const taskCreate = await ack(B.socket, 'task:create', { board_id: boardA, title: 'AC shared task', status: 'todo', assignee_id: B.guestId, due_at: '2026-10-20' }); // 보드 A 에서 업무 생성
    const taskCreated = await taskCreatedPromise; // 수신
    const taskId = taskCreate.ok ? taskCreate.task.task_id : 0; // 공유 업무 ID
    const blockA = await ack(B.socket, 'object:create', { board_id: boardA, type: 'task', x: 0, y: 0, width: 240, height: 110, payload: { task_id: taskId } }); // 보드 A 블럭
    const blockB = await ack(C.socket, 'object:create', { board_id: boardB, type: 'task', x: 50, y: 50, width: 240, height: 110, payload: { task_id: taskId } }); // 보드 B 블럭(같은 업무)
    const taskUpdatedPromise = until(C.socket, 'task:updated', (d) => d.task.task_id === taskId && d.task.status === 'done'); // 보드 B 가 받을 상태 변경
    const taskUpdate = await ack(B.socket, 'task:update', { board_id: boardA, task_id: taskId, version: 1, changes: { status: 'done' } }); // 보드 A 에서 상태 변경
    const taskUpdated = await taskUpdatedPromise; // 수신
    const staleUpdate = await ack(C.socket, 'task:update', { board_id: boardB, task_id: taskId, version: 1, changes: { title: 'stale' } }); // 이전 버전으로 수정 시도
    const tasksList = (await api('GET', '/api/projects/' + projectId + '/tasks', undefined, B.cookie)).json; // 업무 목록
    const listed = tasksList.tasks.find((t) => t.task_id === taskId); // 목록의 업무
    record('AC16', '공유 업무', taskCreate.ok && taskCreated !== null && taskCreate.task.assignee_name === 'AC-B' && taskCreate.task.due_at === '2026-10-20'
        && blockA.ok && blockB.ok && blockA.object.task_id === taskId && blockB.object.task_id === taskId && blockA.object.object_id !== blockB.object.object_id
        && taskUpdate.ok && taskUpdate.task.version === 2 && taskUpdated !== null && staleUpdate.ok === false && staleUpdate.error.code === 'VERSION_CONFLICT'
        && listed && listed.status === 'done' && listed.version === 2, '보드 A 상태 변경 → 보드 B 수신, 이전 버전 수정은 VERSION_CONFLICT');

    // AC17 공유 업무 삭제: 한 보드의 블럭만 제거, 원본과 다른 보드 블럭 유지
    const lockBlock = await ack(B.socket, 'object:lock', { board_id: boardA, object_id: blockA.object_id }); // 블럭 잠금
    const delBlock = await ack(B.socket, 'object:delete', { board_id: boardA, object_id: blockA.object_id, lock_token: lockBlock.lock_token, version: 1 }); // 보드 A 블럭 삭제
    const tasksAfter = (await api('GET', '/api/projects/' + projectId + '/tasks', undefined, B.cookie)).json; // 업무 목록
    const snapBAfter = (await api('GET', '/api/boards/' + boardB + '/snapshot', undefined, B.cookie)).json; // 보드 B 스냅샷
    const snapAAfter = (await api('GET', '/api/boards/' + boardA + '/snapshot', undefined, B.cookie)).json; // 보드 A 스냅샷
    record('AC17', '공유 업무 삭제', delBlock.ok && tasksAfter.tasks.some((t) => t.task_id === taskId) && snapBAfter.objects.some((o) => o.type === 'task' && o.task_id === taskId) && !snapAAfter.objects.some((o) => o.object_id === blockA.object_id), '보드 A 블럭만 제거, tasks 원본과 보드 B 블럭 보존');

    // AC18 연결선: 생성·라벨 변경·삭제 전파, 객체 삭제 시 연결선도 제거
    const n1 = await ack(B.socket, 'object:create', { board_id: boardA, type: 'rect', x: 0, y: 0, width: 40, height: 40 }); // 출발 객체
    const n2 = await ack(B.socket, 'object:create', { board_id: boardA, type: 'ellipse', x: 200, y: 0, width: 40, height: 40 }); // 도착 객체
    const linkCreatedPromise = until(C2.socket, 'link:created', (d) => d.link.from_object_id === n1.object_id); // 같은 보드 참여자가 받을 생성
    const linkCreate = await ack(B.socket, 'link:create', { board_id: boardA, from_object_id: n1.object_id, to_object_id: n2.object_id, label: '다음 단계' }); // 연결선 생성
    const linkCreated = await linkCreatedPromise; // 수신
    const selfLink = await ack(B.socket, 'link:create', { board_id: boardA, from_object_id: n1.object_id, to_object_id: n1.object_id }); // 자기 자신 연결
    const crossLink = await ack(B.socket, 'link:create', { board_id: boardA, from_object_id: n1.object_id, to_object_id: ellipseB.object_id }); // 다른 보드 객체와 연결
    const linkUpdatedPromise = until(C2.socket, 'link:updated', (d) => d.link.link_id === linkCreate.link.link_id); // 라벨 변경 수신
    const linkUpdate = await ack(B.socket, 'link:update', { board_id: boardA, link_id: linkCreate.link.link_id, label: '의존' }); // 라벨 변경
    const linkUpdated = await linkUpdatedPromise; // 수신
    const snapLinks = (await api('GET', '/api/boards/' + boardA + '/snapshot', undefined, B.cookie)).json; // 스냅샷의 연결선
    const lockN2 = await ack(B.socket, 'object:lock', { board_id: boardA, object_id: n2.object_id }); // 도착 객체 잠금
    await ack(B.socket, 'object:delete', { board_id: boardA, object_id: n2.object_id, lock_token: lockN2.lock_token, version: 1 }); // 도착 객체 삭제(연결선 FK 연쇄 삭제)
    const snapAfterDel = (await api('GET', '/api/boards/' + boardA + '/snapshot', undefined, B.cookie)).json; // 삭제 후 스냅샷
    const link2 = await ack(B.socket, 'link:create', { board_id: boardA, from_object_id: n1.object_id, to_object_id: target.object_id }); // 두 번째 연결선
    const linkDeletedPromise = until(C2.socket, 'link:deleted', (d) => d.link_id === link2.link.link_id); // 삭제 수신
    const linkDelete = await ack(B.socket, 'link:delete', { board_id: boardA, link_id: link2.link.link_id }); // 연결선 삭제
    const linkDeleted = await linkDeletedPromise; // 수신
    record('AC18', '연결선', linkCreate.ok && linkCreate.link.label === '다음 단계' && linkCreated !== null && selfLink.ok === false && crossLink.ok === false
        && linkUpdate.ok && linkUpdate.link.label === '의존' && linkUpdated !== null && snapLinks.links.some((l) => l.link_id === linkCreate.link.link_id && l.label === '의존')
        && !snapAfterDel.links.some((l) => l.link_id === linkCreate.link.link_id) && linkDelete.ok && linkDeleted !== null, '생성·라벨·삭제 전파, 자기 자신·타 보드 연결 거부, 객체 삭제 시 연결선 제거');

    // AC19 다중 선택 이동: 모든 객체 잠금을 얻어야 이동, 하나라도 타인 잠금이면 전체 취소(얻은 잠금 반납)
    const m1 = await ack(B.socket, 'object:create', { board_id: boardA, type: 'rect', x: 0, y: 0, width: 10, height: 10 }); // 다중 선택 객체 1
    const m2 = await ack(B.socket, 'object:create', { board_id: boardA, type: 'rect', x: 20, y: 0, width: 10, height: 10 }); // 다중 선택 객체 2
    const otherLock = await ack(C2.socket, 'object:lock', { board_id: boardA, object_id: m2.object_id }); // 다른 사용자가 객체 2 잠금
    const lockM1 = await ack(B.socket, 'object:lock', { board_id: boardA, object_id: m1.object_id }); // B 가 객체 1 잠금 성공
    const lockM2 = await ack(B.socket, 'object:lock', { board_id: boardA, object_id: m2.object_id }); // B 가 객체 2 잠금 실패 → 클라이언트는 전체 취소
    await ack(B.socket, 'object:unlock', { board_id: boardA, object_id: m1.object_id, lock_token: lockM1.lock_token }); // 얻었던 객체 1 잠금 반납
    const otherLockM1 = await ack(C2.socket, 'object:lock', { board_id: boardA, object_id: m1.object_id }); // 반납 후 다른 사용자가 객체 1 잠금 가능
    await ack(C2.socket, 'object:unlock', { board_id: boardA, object_id: m1.object_id, lock_token: otherLockM1.lock_token }); // 정리
    await ack(C2.socket, 'object:unlock', { board_id: boardA, object_id: m2.object_id, lock_token: otherLock.lock_token }); // 정리
    const lockBoth1 = await ack(B.socket, 'object:lock', { board_id: boardA, object_id: m1.object_id }); // 둘 다 잠금
    const lockBoth2 = await ack(B.socket, 'object:lock', { board_id: boardA, object_id: m2.object_id }); // 둘 다 잠금
    const [mv1, mv2] = await Promise.all([
        ack(B.socket, 'object:commit', { board_id: boardA, object_id: m1.object_id, lock_token: lockBoth1.lock_token, version: 1, changes: { x: 100, y: 50 } }), // 함께 이동 1
        ack(B.socket, 'object:commit', { board_id: boardA, object_id: m2.object_id, lock_token: lockBoth2.lock_token, version: 1, changes: { x: 120, y: 50 } }), // 함께 이동 2
    ]); // 동시 확정
    record('AC19', '다중 선택 이동', otherLock.ok && lockM1.ok && lockM2.ok === false && lockM2.error.code === 'OBJECT_LOCKED' && otherLockM1.ok && lockBoth1.ok && lockBoth2.ok && mv1.ok && mv2.ok && mv1.object.x === 100 && mv2.object.x === 120, '타인 잠금 포함 시 전체 취소·반납, 모두 잠그면 동시 이동 저장');

    // AC20 초대 코드 관리: 관리자만 목록·발급·취소, 발급한 코드로 입장, 취소 후에는 거부
    const invitesPath = '/api/projects/' + projectId + '/invites'; // 초대 API 경로
    const admin = await join('AC-Admin', adminCode); // create-project 가 출력한 최초 관리자 코드로 입장
    const inviteList = await api('GET', invitesPath, undefined, admin.cookie); // 관리자 목록 조회
    const editorList = await api('GET', invitesPath, undefined, B.cookie); // 편집자 목록 조회 시도
    const editorIssue = await api('POST', invitesPath, { role: 'viewer', days: 1 }, B.cookie); // 편집자 발급 시도
    const issued = await api('POST', invitesPath, { role: 'viewer', days: 3 }, admin.cookie); // 관리자 발급
    const badDays = await api('POST', invitesPath, { role: 'viewer', days: 31 }, admin.cookie); // 허용 범위 밖 기간
    const badRole = await api('POST', invitesPath, { role: 'owner', days: 1 }, admin.cookie); // 없는 역할
    const viaIssued = await join('AC-Invited', issued.json.code); // 발급한 코드로 입장
    const revoked = await api('POST', '/api/invites/' + issued.json.invite.invite_id + '/revoke', {}, admin.cookie); // 취소
    const afterRevoke = await join('AC-Late', issued.json.code); // 취소된 코드로 입장 시도
    const stillMember = await api('GET', '/api/me', undefined, viaIssued.cookie); // 이미 입장한 사람은 유지
    const limited = await api('POST', invitesPath, { role: 'viewer', days: 1, max_uses: 1 }, admin.cookie); // 한 명만 들어올 수 있는 코드
    const badUses = await Promise.all([-1, 101, 'x'].map((n) => api('POST', invitesPath, { role: 'viewer', days: 1, max_uses: n }, admin.cookie))); // 허용 범위 밖·형식 오류
    const firstIn = await join('AC-Limit-1', limited.json.code); // 첫 사람
    const secondIn = await join('AC-Limit-2', limited.json.code); // 두 번째 사람(인원 마감)
    const firstAgain = await join('AC-Limit-1', limited.json.code); // 이미 입장한 이름은 다시 들어올 수 있음
    const limitedRow = (await api('GET', invitesPath, undefined, admin.cookie)).json.invites.find((i) => i.invite_id === limited.json.invite.invite_id); // 관리 목록의 그 코드
    const unlimitedRow = inviteList.json.invites[0]; // 인원 제한 없이 만든 코드
    record('AC20', '초대 코드 관리', admin.status === 201 && admin.json.role === 'admin' && inviteList.status === 200 && inviteList.json.invites.length >= 3
        && inviteList.json.invites.every((i) => i.code === undefined && i.code_hash === undefined) && editorList.status === 403 && editorIssue.status === 403
        && issued.status === 201 && /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(issued.json.code) && issued.json.invite.status === 'active' && badDays.status === 400 && badRole.status === 400
        && viaIssued.status === 201 && viaIssued.json.role === 'viewer' && revoked.status === 200 && revoked.json.invite.status === 'revoked'
        && afterRevoke.status === 401 && afterRevoke.json.error.code === 'INVALID_INVITE' && stillMember.status === 200
        && limited.status === 201 && limited.json.invite.max_uses === 1 && limited.json.invite.used_count === 0 && badUses.every((r) => r.status === 400)
        && firstIn.status === 201 && secondIn.status === 401 && secondIn.json.error.code === 'INVITE_EXHAUSTED' && firstAgain.status === 201
        && limitedRow.used_count === 1 && limitedRow.status === 'exhausted' && unlimitedRow.max_uses === null, '관리자만 목록·발급·취소(편집자 403), 발급 코드 입장, 취소 후 거부, 목록에 코드 원문 없음, 인원 제한 1명 코드는 두 번째 사람 거부·기존 참여자 재입장 허용');

    // AC21 크기 조절: 미리보기에 크기 포함, 확정 저장, 너무 작은 크기 거부, 펜 획은 크기 변경 무시
    const rz = await ack(B.socket, 'object:create', { board_id: boardA, type: 'rect', x: 0, y: 0, width: 40, height: 20 }); // 크기 조절 대상
    const rzLock = await ack(B.socket, 'object:lock', { board_id: boardA, object_id: rz.object_id }); // 잠금
    const rzPreviewPromise = until(C2.socket, 'object:preview', (d) => d.object_id === rz.object_id && d.width !== undefined); // 크기 포함 미리보기 수신
    B.socket.emit('object:preview', { board_id: boardA, object_id: rz.object_id, lock_token: rzLock.lock_token, x: -10, y: -5, width: 80, height: 50 }); // 크기 조절 중
    const rzPreview = await rzPreviewPromise; // 수신
    const rzSmall = await ack(B.socket, 'object:commit', { board_id: boardA, object_id: rz.object_id, lock_token: rzLock.lock_token, version: 1, changes: { width: 0, height: 50 } }); // 0 크기 시도
    const rzCommit = await ack(B.socket, 'object:commit', { board_id: boardA, object_id: rz.object_id, lock_token: rzLock.lock_token, version: 1, changes: { x: -10, y: -5, width: 80, height: 50 } }); // 크기 확정
    const strokeLock = await ack(B.socket, 'object:lock', { board_id: boardA, object_id: strokeCommit.object_id }); // 펜 획 잠금
    const strokeResize = await ack(B.socket, 'object:commit', { board_id: boardA, object_id: strokeCommit.object_id, lock_token: strokeLock.lock_token, version: 1, changes: { width: 999, height: 999 } }); // 획 크기 변경 시도
    const snapRz = (await api('GET', '/api/boards/' + boardA + '/snapshot', undefined, B.cookie)).json.objects.find((o) => o.object_id === rz.object_id); // 저장된 결과
    record('AC21', '크기 조절', rzLock.ok && rzPreview !== null && rzPreview.width === 80 && rzPreview.height === 50 && rzSmall.ok === false && rzSmall.error.code === 'BAD_REQUEST'
        && rzCommit.ok && rzCommit.object.width === 80 && rzCommit.object.x === -10 && snapRz && snapRz.width === 80 && snapRz.height === 50 && snapRz.version === 2
        && strokeResize.ok && strokeResize.object.width === 2 && strokeResize.object.height === 2, '미리보기·확정에 크기 반영, 0 크기 거부, 펜 획 크기는 유지');

    // AC22 메모: 생성·글 수정 전파, 제어 문자 제거, 너무 긴 글 거부, 메모가 아닌 객체의 text 무시, 열람자 거부
    const noteCreatedPromise = until(C2.socket, 'object:created', (d) => d.object.type === 'note'); // 같은 보드 참여자가 받을 생성
    const noteObj = await ack(B.socket, 'object:create', { board_id: boardA, type: 'note', x: 10, y: 10, width: 180, height: 120, style: { fill: '#fff59d', color: '#222222' }, payload: { text: '첫 줄\r\n둘째 줄\u0007' } }); // 메모 생성(CRLF·제어 문자 포함)
    const noteCreated = await noteCreatedPromise; // 수신
    const noteLock = await ack(B.socket, 'object:lock', { board_id: boardA, object_id: noteObj.object_id }); // 글 수정용 잠금
    const noteTooLong = await ack(B.socket, 'object:commit', { board_id: boardA, object_id: noteObj.object_id, lock_token: noteLock.lock_token, version: 1, changes: { text: 'x'.repeat(2001) } }); // 2001자
    const noteUpdatedPromise = until(C2.socket, 'object:updated', (d) => d.object.object_id === noteObj.object_id); // 글 변경 수신
    const noteCommit = await ack(B.socket, 'object:commit', { board_id: boardA, object_id: noteObj.object_id, lock_token: noteLock.lock_token, version: 1, changes: { text: '회의 메모', height: 160, style: { fill: null, color: '#e53935' } } }); // 글·높이·스타일 확정
    const noteUpdated = await noteUpdatedPromise; // 수신
    const rectLock = await ack(B.socket, 'object:lock', { board_id: boardA, object_id: rz.object_id }); // 메모가 아닌 객체
    const rectText = await ack(B.socket, 'object:commit', { board_id: boardA, object_id: rz.object_id, lock_token: rectLock.lock_token, version: 2, changes: { text: 'ignored' } }); // 사각형에 text 전송
    const badNote = await ack(B.socket, 'object:create', { board_id: boardA, type: 'note', x: 0, y: 0, width: 100, height: 60, payload: { text: 123 } }); // 문자열이 아닌 글
    const viewerNote = await ack(V.socket, 'object:create', { board_id: boardA, type: 'note', x: 0, y: 0, width: 100, height: 60, payload: { text: 'v' } }); // 열람자 생성 시도
    const snapNote = (await api('GET', '/api/boards/' + boardA + '/snapshot', undefined, B.cookie)).json.objects.find((o) => o.object_id === noteObj.object_id); // 저장 결과
    const bigNote = await ack(B.socket, 'object:create', { board_id: boardA, type: 'note', x: 300, y: 10, width: 200, height: 80, style: { fill: null, color: '#111111', size: 28 }, payload: { text: '제목' } }); // 큰 글자 메모
    const wrongSizes = await Promise.all([999, 3, '24', null].map((size) => ack(B.socket, 'object:create', { board_id: boardA, type: 'note', x: 300, y: 120, width: 100, height: 60, style: { size }, payload: { text: 's' } }))); // 범위 밖·숫자가 아닌 크기
    const bigLock = await ack(B.socket, 'object:lock', { board_id: boardA, object_id: bigNote.object_id }); // 글자 크기 변경용 잠금
    const resized = await ack(B.socket, 'object:commit', { board_id: boardA, object_id: bigNote.object_id, lock_token: bigLock.lock_token, version: 1, changes: { style: { fill: null, color: '#111111', size: 40 }, height: 120 } }); // 글자 크기와 높이를 함께 변경
    record('AC22', '메모', noteObj.ok && noteObj.object.payload.text === '첫 줄\n둘째 줄' && noteObj.object.style.fill === '#fff59d' && noteCreated !== null
        && noteTooLong.ok === false && noteTooLong.error.code === 'BAD_REQUEST' && noteCommit.ok && noteCommit.object.payload.text === '회의 메모' && noteCommit.object.height === 160
        && noteCommit.object.style.fill === null && noteCommit.object.style.color === '#e53935' && noteUpdated !== null && noteUpdated.object.payload.text === '회의 메모'
        && rectText.ok && rectText.object.payload.text === undefined && rectText.object.text === undefined && badNote.ok === false && badNote.error.code === 'BAD_REQUEST'
        && viewerNote.ok === false && viewerNote.error.code === 'FORBIDDEN' && snapNote && snapNote.payload.text === '회의 메모' && snapNote.version === 2
        && noteObj.object.style.size === 16 && bigNote.ok && bigNote.object.style.size === 28 && wrongSizes.every((r) => r.ok && r.object.style.size === 16)
        && resized.ok && resized.object.style.size === 40 && resized.object.height === 120, '생성·글 수정 전파, 제어 문자 제거, 2001자 거부, 다른 객체의 text 무시, 열람자 거부, 글자 크기 10~72 저장(범위 밖·형식 오류는 기본 16)');

    // AC23 보드 관리: 이름 변경(편집자 이상)·삭제(관리자), 보드 안 참여자에게 실시간 알림 후 연결 정리
    const tempBoard = (await api('POST', '/api/projects/' + projectId + '/boards', { title: 'AC Temp' }, B.cookie)).json.board; // 임시 보드
    const tempPath = '/api/boards/' + tempBoard.board_id; // 임시 보드 API 경로
    const T = await enter('AC-T', editorCode, tempBoard.board_id); // 임시 보드 안에 있는 참여자
    await ack(T.socket, 'object:create', { board_id: tempBoard.board_id, type: 'rect', x: 0, y: 0, width: 10, height: 10 }); // 보드 안 객체
    const viewerRename = await api('POST', tempPath + '/rename', { title: 'nope' }, V.cookie); // 열람자 이름 변경 시도
    const emptyRename = await api('POST', tempPath + '/rename', { title: '   ' }, B.cookie); // 빈 이름
    const renamedPromise = until(T.socket, 'board:renamed', (d) => d.board_id === tempBoard.board_id, 4000); // 보드 안 참여자가 받을 이름 변경
    const rename = await api('POST', tempPath + '/rename', { title: 'AC Renamed' }, B.cookie); // 편집자 이름 변경
    const renamed = await renamedPromise; // 수신
    const editorDelete = await api('POST', tempPath + '/delete', {}, B.cookie); // 편집자 삭제 시도
    const boardDeletedPromise = until(T.socket, 'board:deleted', (d) => d.board_id === tempBoard.board_id, 4000); // 삭제 알림
    const disconnectedPromise = once(T.socket, 'disconnect', 5000); // 알림 뒤 연결 정리
    const adminDelete = await api('POST', tempPath + '/delete', {}, admin.cookie); // 관리자 삭제
    const boardDeleted = await boardDeletedPromise; // 수신
    const disconnected = await disconnectedPromise; // 연결 종료 사유
    const snapGone = await api('GET', tempPath + '/snapshot', undefined, B.cookie); // 삭제된 보드 조회
    const boardsAfter = (await api('GET', '/api/projects/' + projectId + '/boards', undefined, B.cookie)).json.boards; // 남은 보드
    const missingRename = await api('POST', '/api/boards/999999/rename', { title: 'x' }, B.cookie); // 없는 보드
    record('AC23', '보드 관리', T.reply.ok && T.reply.board_title === 'AC Temp' && viewerRename.status === 403 && emptyRename.status === 400 && rename.status === 200 && rename.json.board.title === 'AC Renamed'
        && renamed !== null && renamed.title === 'AC Renamed' && editorDelete.status === 403 && adminDelete.status === 200 && adminDelete.json.deleted === true
        && boardDeleted !== null && disconnected !== null && snapGone.status === 404 && !boardsAfter.some((b) => b.board_id === tempBoard.board_id) && boardsAfter.length >= 2
        && missingRename.status === 404, '편집자 이름 변경·관리자 삭제(그 외 403), 보드 안 참여자에게 이름 변경·삭제 알림 후 연결 종료, 삭제된 보드 404');

    // AC26 업무 현황판: 작업실 연결(보드에 들어가지 않은 연결)에서 업무를 만들고 바꾸면 보드에 전달되고, 보드의 변경은 작업실에 전달
    const projectTicket = async (cookie, id = projectId) => api('POST', '/api/realtime-ticket', { project_id: id }, cookie); // 작업실용 티켓 발급
    const wsTicket = await projectTicket(B.cookie); // 편집자의 작업실 티켓
    const W = await connect(); // 작업실 연결
    const wsJoin = await ack(W, 'project:join', { project_id: projectId, ticket: wsTicket.json.ticket }); // 작업실 참여
    const probe = await connect(); // 잘못된 티켓 사용을 시험할 연결
    const reused = await ack(probe, 'project:join', { project_id: projectId, ticket: wsTicket.json.ticket }); // 이미 쓴 티켓
    const asBoard = await ack(probe, 'board:join', { board_id: boardA, ticket: (await projectTicket(B.cookie)).json.ticket }); // 작업실 티켓으로 보드 참여 시도
    const asProject = await ack(probe, 'project:join', { project_id: projectId, ticket: await ticket(B.cookie, boardA) }); // 보드 티켓으로 작업실 참여 시도
    const beforeJoin = await ack(probe, 'task:create', { title: 'no join' }); // 어디에도 참여하지 않은 연결의 업무 생성
    const bothIds = await api('POST', '/api/realtime-ticket', { board_id: boardA, project_id: projectId }, B.cookie); // 범위를 둘 다 지정
    const noIds = await api('POST', '/api/realtime-ticket', {}, B.cookie); // 범위 없음
    const otherAdminCode = /관리자 초대 코드: (\S+)/.exec(phpCli('create-project.php', ['AC Other ' + Date.now(), 'Other Board']))[1]; // 다른 프로젝트
    const outsider = await join('AC-Outsider', otherAdminCode); // 다른 프로젝트의 참여자
    const outsiderTicket = await projectTicket(outsider.cookie); // 남의 프로젝트 작업실 티켓 요청
    const createdAtBoard = until(C.socket, 'task:created', (d) => d.task.title === 'AC workspace task'); // 보드 B 참여자가 받을 생성 알림
    const wsCreate = await ack(W, 'task:create', { title: 'AC workspace task', status: 'todo', due_at: '2026-11-01' }); // 작업실에서 업무 생성(보드 번호 없음)
    const boardSawCreate = await createdAtBoard; // 수신
    const wsTaskId = wsCreate.ok ? wsCreate.task.task_id : 0; // 새 업무 ID
    const movedAtBoard = until(C.socket, 'task:updated', (d) => d.task.task_id === wsTaskId && d.task.status === 'doing'); // 보드가 받을 상태 변경
    const wsMove = await ack(W, 'task:update', { task_id: wsTaskId, version: 1, changes: { status: 'doing' } }); // 현황판에서 카드를 옮긴 것과 같은 요청
    const boardSawMove = await movedAtBoard; // 수신
    const doneAtWorkspace = until(W, 'task:updated', (d) => d.task.task_id === wsTaskId && d.task.status === 'done'); // 작업실이 받을 보드 쪽 변경
    const boardMove = await ack(C.socket, 'task:update', { board_id: boardB, task_id: wsTaskId, version: 2, changes: { status: 'done' } }); // 보드에서 상태 변경
    const workspaceSawMove = await doneAtWorkspace; // 수신
    const wsStale = await ack(W, 'task:update', { task_id: wsTaskId, version: 2, changes: { status: 'todo' } }); // 이전 버전으로 다시 옮기기 시도
    const wsObject = await ack(W, 'object:create', { board_id: boardA, type: 'rect', x: 0, y: 0, width: 5, height: 5 }); // 작업실 연결로 보드 객체 생성 시도
    const VW = await connect(); // 열람자의 작업실 연결
    const viewerJoin = await ack(VW, 'project:join', { project_id: projectId, ticket: (await projectTicket(V.cookie)).json.ticket }); // 열람자도 볼 수는 있음
    const viewerMove = await ack(VW, 'task:update', { task_id: wsTaskId, version: 3, changes: { status: 'todo' } }); // 열람자의 상태 변경 시도
    const viewerCreate = await ack(VW, 'task:create', { title: 'viewer task' }); // 열람자의 업무 생성 시도
    const wsListed = (await api('GET', '/api/projects/' + projectId + '/tasks', undefined, B.cookie)).json.tasks.find((t) => t.task_id === wsTaskId); // 저장된 결과
    record('AC26', '업무 현황판', wsTicket.status === 201 && wsTicket.json.project_id === projectId && wsTicket.json.board_id === undefined && wsJoin.ok && wsJoin.you.role === 'editor'
        && reused.ok === false && reused.error.code === 'INVALID_TICKET' && asBoard.ok === false && asBoard.error.code === 'INVALID_TICKET' && asProject.ok === false && asProject.error.code === 'INVALID_TICKET'
        && beforeJoin.ok === false && beforeJoin.error.code === 'FORBIDDEN' && bothIds.status === 400 && noIds.status === 400 && outsider.status === 201 && outsiderTicket.status === 403
        && wsCreate.ok && wsCreate.task.due_at === '2026-11-01' && boardSawCreate !== null && wsMove.ok && wsMove.task.version === 2 && boardSawMove !== null
        && boardMove.ok && workspaceSawMove !== null && workspaceSawMove.task.version === 3 && wsStale.ok === false && wsStale.error.code === 'VERSION_CONFLICT' && wsStale.task.status === 'done'
        && wsObject.ok === false && wsObject.error.code === 'FORBIDDEN' && viewerJoin.ok && viewerJoin.you.role === 'viewer' && viewerMove.ok === false && viewerMove.error.code === 'FORBIDDEN'
        && viewerCreate.ok === false && viewerCreate.error.code === 'FORBIDDEN' && wsListed && wsListed.status === 'done' && wsListed.version === 3,
        '작업실 연결의 업무 생성·상태 변경이 보드에 전달되고 보드의 변경은 작업실에 전달, 이전 버전은 VERSION_CONFLICT, 티켓은 범위가 다르면 거부, 작업실 연결의 보드 객체 생성과 열람자의 변경은 FORBIDDEN');
    for (const s of [W, probe, VW])
    {
        s.disconnect(); // 작업실 연결 정리
    }

    // AC27 작업실 직접 만들기: 초대 코드 없이 만들면 관리자로 입장, 남의 작업실과 분리, 재입장 전용 코드, 낮은 권한 코드로 이름 가로채기 방지
    const noHeader = await fetch(API + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: 'AC-Owner', title: 'no header' }) }); // CSRF 방어 헤더 없이
    const emptyTitle = await api('POST', '/api/projects', { display_name: 'AC-Owner', title: '   ' }); // 빈 작업실 이름
    const longTitle = await api('POST', '/api/projects', { display_name: 'AC-Owner', title: 'x'.repeat(121) }); // 너무 긴 이름
    const made = await api('POST', '/api/projects', { display_name: 'AC-Owner', title: 'AC 내 작업실' }); // 작업실 만들기
    const mine = made.status === 201 ? made.json.project.project_id : 0; // 새 작업실 ID
    const firstBoard = made.status === 201 ? made.json.board.board_id : 0; // 처음부터 들어 있는 보드
    const invitesMine = '/api/projects/' + mine + '/invites'; // 내 작업실의 초대 API
    const meOwner = await api('GET', '/api/me', undefined, made.cookie); // 만든 직후의 세션
    const myBoards = await api('GET', '/api/projects/' + mine + '/boards', undefined, made.cookie); // 내 보드 목록
    const myInvites = await api('GET', invitesMine, undefined, made.cookie); // 내 초대 목록(재입장 코드 한 줄)
    const intoOthers = await api('GET', '/api/projects/' + projectId + '/boards', undefined, made.cookie); // 내 세션으로 남의 작업실 조회
    const othersIntoMine = await api('GET', '/api/projects/' + mine + '/boards', undefined, B.cookie); // 남의 세션으로 내 작업실 조회
    const ownerSocket = await connect(); // 만든 사람의 실시간 연결
    const ownerBoardJoin = await ack(ownerSocket, 'board:join', { board_id: firstBoard, ticket: await ticket(made.cookie, firstBoard) }); // 첫 보드에 바로 참여
    ownerSocket.disconnect(); // 정리
    const editorInvite = await api('POST', invitesMine, { role: 'editor', days: 1 }, made.cookie); // 팀원용 편집자 코드
    const viewerInvite = await api('POST', invitesMine, { role: 'viewer', days: 1 }, made.cookie); // 열람자 코드
    const friend = await join('AC-Friend', editorInvite.json.code); // 초대받은 편집자
    const stealOwner = await join('AC-Owner', editorInvite.json.code); // 편집자 코드로 만든 사람의 이름을 씀
    const stealFriend = await join('AC-Friend', viewerInvite.json.code); // 열람자 코드로 편집자의 이름을 씀
    const friendAgain = await join('AC-Friend', editorInvite.json.code); // 같은 권한의 코드로 자기 이름은 다시 들어올 수 있음
    const ownerBack = await join('AC-Owner', made.json.owner_code); // 만든 사람이 재입장 코드로 돌아옴
    const ownerCodeNewName = await join('AC-Stranger', made.json.owner_code); // 재입장 코드로 새 이름
    const reentryIssued = await api('POST', invitesMine, { role: 'admin', days: 1, max_uses: 0 }, made.cookie); // 관리자가 재입장 전용 코드를 새로 발급
    const renameByEditor = await api('POST', '/api/projects/' + mine + '/rename', { title: 'nope' }, friend.cookie); // 편집자의 이름 변경 시도
    const renameEmpty = await api('POST', '/api/projects/' + mine + '/rename', { title: '  ' }, made.cookie); // 빈 이름
    const projectRenamed = await api('POST', '/api/projects/' + mine + '/rename', { title: 'AC 새 이름' }, made.cookie); // 관리자의 이름 변경
    const meRenamed = await api('GET', '/api/me', undefined, ownerBack.cookie); // 다시 들어온 세션에서 본 작업실
    const disabled = await createWhenDisabled(); // 만들기를 꺼 둔 서버
    const ownerRow = myInvites.status === 200 ? myInvites.json.invites[0] : {}; // 재입장 코드의 목록 행
    record('AC27', '작업실 직접 만들기', noHeader.status === 403 && emptyTitle.status === 400 && longTitle.status === 400
        && made.status === 201 && made.json.project.role === 'admin' && made.json.project.title === 'AC 내 작업실' && made.cookie !== '' && /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(made.json.owner_code)
        && meOwner.status === 200 && meOwner.json.projects.length === 1 && meOwner.json.projects[0].project_id === mine && meOwner.json.projects[0].role === 'admin'
        && myBoards.status === 200 && myBoards.json.boards.length === 1 && myBoards.json.boards[0].board_id === firstBoard
        && myInvites.status === 200 && myInvites.json.invites.length === 1 && ownerRow.role === 'admin' && ownerRow.reentry_only === true && ownerRow.status === 'active' && ownerRow.code === undefined
        && intoOthers.status === 403 && othersIntoMine.status === 403 && ownerBoardJoin.ok && ownerBoardJoin.you.role === 'admin'
        && friend.status === 201 && friend.json.role === 'editor' && stealOwner.status === 403 && stealOwner.json.error.code === 'NAME_IN_USE' && stealFriend.status === 403 && stealFriend.json.error.code === 'NAME_IN_USE'
        && friendAgain.status === 201 && friendAgain.json.guest.guest_id === friend.json.guest.guest_id
        && ownerBack.status === 201 && ownerBack.json.role === 'admin' && ownerBack.json.guest.guest_id === made.json.guest.guest_id
        && ownerCodeNewName.status === 401 && ownerCodeNewName.json.error.code === 'REENTRY_ONLY' && reentryIssued.status === 201 && reentryIssued.json.invite.reentry_only === true
        && renameByEditor.status === 403 && renameEmpty.status === 400 && projectRenamed.status === 200 && meRenamed.json.projects[0].title === 'AC 새 이름'
        && disabled.status === 403 && disabled.code === 'CREATE_DISABLED',
        '초대 코드 없이 만들면 관리자로 입장하고 첫 보드에 바로 참여, 남의 작업실과 서로 403, 재입장 코드는 같은 이름만 허용, 낮은 권한 코드로 높은 권한 이름 사용은 NAME_IN_USE, 이름 변경은 관리자만, 꺼 둔 서버는 CREATE_DISABLED');

    // AC28 참여자 따라가기(서버 쪽): 참여자의 마지막 커서 위치를 기억해, 나중에 들어온 사람의 참여자 목록에도 실어 준다
    const cursorSeen = once(C2.socket, 'cursor:move'); // 같은 보드의 참여자가 받을 커서
    B.socket.emit('cursor:move', { board_id: boardA, x: 321, y: -45 }); // B 가 커서를 옮김
    const cursorRelayed = await cursorSeen; // 중계 확인
    const presenceSeen = until(C2.socket, 'presence:update', (d) => d.participants.some((p) => p.display_name === 'AC-Follower')); // 새 참여자가 들어올 때의 목록 갱신
    const follower = await enter('AC-Follower', editorCode, boardA); // B 가 움직인 뒤에 들어온 사람
    const presenceUpdate = await presenceSeen; // 기존 참여자가 받은 목록
    const joinedList = follower.reply.ok ? follower.reply.participants : []; // 들어온 사람이 받은 목록
    const listedB = joinedList.find((p) => p.guest_id === B.guestId); // 목록의 B
    const listedSelf = joinedList.find((p) => p.guest_id === follower.guestId); // 목록의 자기 자신(아직 움직인 적 없음)
    const updateB = presenceUpdate ? presenceUpdate.participants.find((p) => p.guest_id === B.guestId) : null; // 갱신된 목록의 B
    follower.socket.disconnect(); // 정리
    record('AC28', '참여자 따라가기', cursorRelayed !== null && cursorRelayed.x === 321 && !!listedB && !!listedB.cursor && listedB.cursor.x === 321 && listedB.cursor.y === -45
        && !!listedSelf && listedSelf.cursor === null && !!updateB && !!updateB.cursor && updateB.cursor.x === 321 && joinedList.every((p) => p.socket_id === undefined),
        '참여자의 마지막 커서 위치가 나중에 들어온 사람의 참여자 목록과 목록 갱신에 실림, 움직인 적 없는 사람은 null (화면 동작은 리허설 10번이 확인)');

    // AC29 참여자 선택 표시(서버 쪽): 고른 객체·연결선을 알리면 같은 보드의 참여자에게만 전달되고, 나중에 들어온 사람의 참여자 목록에도 실린다
    const pick = [target.object_id, n1.object_id]; // B 가 고를 객체 둘
    const pickLink = linkCreate.link.link_id; // B 가 고를 연결선 번호(서버는 번호 형식만 보고 전달)
    const selSeen = until(C2.socket, 'selection:update', (d) => d.guest_id === B.guestId); // 같은 보드의 참여자가 받을 선택
    const selElsewhere = once(C.socket, 'selection:update', 600); // 다른 보드의 참여자는 받지 않아야 함
    const selSet = await ack(B.socket, 'selection:set', { board_id: boardA, object_ids: [...pick, pick[0]], link_id: pickLink }); // B 가 선택을 알림(같은 번호를 두 번 넣어 봄)
    const selUpdate = await selSeen; // 수신
    const selLeaked = await selElsewhere; // 다른 보드로 새지 않았는지
    const picker = await enter('AC-Picker', editorCode, boardA); // B 가 고른 뒤에 들어온 사람
    const pickerList = picker.reply.ok ? picker.reply.participants : []; // 들어온 사람이 받은 목록
    const pickedB = pickerList.find((p) => p.guest_id === B.guestId); // 목록의 B
    const pickedSelf = pickerList.find((p) => p.guest_id === picker.guestId); // 목록의 자기 자신(아무것도 고르지 않음)
    const selBad = [
        await ack(B.socket, 'selection:set', { board_id: boardA, object_ids: 'x', link_id: null }), // 목록이 아님
        await ack(B.socket, 'selection:set', { board_id: boardA, object_ids: [1.5], link_id: null }), // 번호가 정수가 아님
        await ack(B.socket, 'selection:set', { board_id: boardA, object_ids: Array.from({ length: 201 }, (_, i) => i + 1), link_id: null }), // 한 번에 200개를 넘김
        await ack(B.socket, 'selection:set', { board_id: boardA, object_ids: [], link_id: 'a' }), // 연결선 번호가 숫자가 아님
    ]; // 형식이 잘못된 요청들
    const selWrongBoard = await ack(B.socket, 'selection:set', { board_id: boardB, object_ids: [], link_id: null }); // 참여하지 않은 보드
    const selCleared = until(C2.socket, 'selection:update', (d) => d.guest_id === B.guestId && d.object_ids.length === 0); // 선택을 풀 때의 전달
    await ack(B.socket, 'selection:set', { board_id: boardA, object_ids: [], link_id: null }); // B 가 선택을 풂
    const selEmpty = await selCleared; // 수신
    const pickerGone = until(C2.socket, 'presence:update', (d) => !d.participants.some((p) => p.guest_id === picker.guestId)); // 고른 사람이 나갈 때의 목록 갱신
    await ack(picker.socket, 'selection:set', { board_id: boardA, object_ids: [pick[0]], link_id: null }); // 나중에 들어온 사람도 하나 고름
    picker.socket.disconnect(); // 고른 채로 나감
    const afterLeave = await pickerGone; // 남은 참여자가 받은 목록(나간 사람과 그 선택이 함께 빠짐)
    record('AC29', '참여자 선택 표시', selSet.ok && selUpdate !== null && selUpdate.display_name === 'AC-B' && selUpdate.color === B.reply.you.color
        && selUpdate.object_ids.length === 2 && pick.every((id) => selUpdate.object_ids.includes(id)) && selUpdate.link_id === pickLink && selLeaked === null
        && !!pickedB && pickedB.selection.object_ids.length === 2 && pickedB.selection.link_id === pickLink && !!pickedSelf && pickedSelf.selection.object_ids.length === 0 && pickedSelf.selection.link_id === null
        && selBad.every((r) => r.ok === false && r.error.code === 'BAD_REQUEST') && selWrongBoard.ok === false && selWrongBoard.error.code === 'FORBIDDEN'
        && selEmpty !== null && selEmpty.link_id === null && afterLeave !== null,
        '고른 객체 2개와 연결선이 같은 보드의 참여자에게 이름·색과 함께 전달(같은 번호는 하나로), 다른 보드로는 전달 안 됨, 나중에 들어온 사람의 참여자 목록에도 실림, 잘못된 형식은 BAD_REQUEST, 참여하지 않은 보드는 FORBIDDEN, 풀면 빈 선택 전달 (화면 표시는 리허설 2번과 캡처가 확인)');

    // AC30 업무 체크리스트: 세부 항목을 더하고 체크하고 고치고 지우면 그 업무를 보는 모든 보드와 작업실에 전달된다. 업무의 버전은 그대로라 다른 수정과 충돌하지 않는다
    const W2 = await connect(); // 편집자의 작업실 연결(AC26 의 연결은 이미 정리됨)
    const VW2 = await connect(); // 열람자의 작업실 연결
    const idle = await connect(); // 어디에도 참여하지 않은 연결
    const w2Join = await ack(W2, 'project:join', { project_id: projectId, ticket: (await projectTicket(B.cookie)).json.ticket }); // 작업실 참여
    const vw2Join = await ack(VW2, 'project:join', { project_id: projectId, ticket: (await projectTicket(V.cookie)).json.ticket }); // 열람자의 작업실 참여
    const itemSeenAtBoard = until(C.socket, 'task:updated', (d) => d.task.task_id === taskId && d.task.checklist.length === 1); // 다른 보드가 받을 항목 추가
    const itemSeenAtWorkspace = until(W2, 'task:updated', (d) => d.task.task_id === taskId && d.task.checklist.length === 1); // 작업실이 받을 항목 추가
    const itemAdd = await ack(B.socket, 'checklist:add', { board_id: boardA, task_id: taskId, title: '  첫 항목\n ' }); // 보드 A 에서 항목 추가(앞뒤 공백과 줄바꿈 포함)
    const boardSawItem = await itemSeenAtBoard; // 수신
    const workspaceSawItem = await itemSeenAtWorkspace; // 수신
    const itemId = itemAdd.ok ? itemAdd.item_id : 0; // 새 항목 번호
    const checkSeen = until(B.socket, 'task:updated', (d) => d.task.task_id === taskId && d.task.checklist.some((i) => i.item_id === itemId && i.done)); // 보드 A 가 받을 체크
    const itemCheck = await ack(C.socket, 'checklist:update', { board_id: boardB, task_id: taskId, item_id: itemId, changes: { done: true } }); // 보드 B 에서 체크
    const boardSawCheck = await checkSeen; // 수신
    const itemRename = await ack(W2, 'checklist:update', { task_id: taskId, item_id: itemId, changes: { title: '고친 항목' } }); // 작업실에서 이름 변경(보드 번호 없음)
    const afterItems = await ack(B.socket, 'task:update', { board_id: boardA, task_id: taskId, version: itemAdd.ok ? itemAdd.task.version : 0, changes: { description: '체크리스트와 따로 저장' } }); // 항목을 바꾸기 전에 알던 버전으로 업무 수정(충돌하지 않아야 함)
    const itemListed = (await api('GET', '/api/projects/' + projectId + '/tasks', undefined, V.cookie)).json.tasks.find((t) => t.task_id === taskId); // 열람자가 조회한 업무 목록
    const burstTasks = await Promise.all(Array.from({ length: 12 }, (_, i) => ack(B.socket, 'task:create', { board_id: boardA, title: 'AC burst ' + (i + 1) }))); // 한꺼번에 고칠 업무 12개
    const burst = await Promise.race([
        Promise.all(burstTasks.map((r) => ack(B.socket, 'task:update', { board_id: boardA, task_id: r.task.task_id, version: 1, changes: { status: 'doing' } }))), // 서로 다른 업무 12개를 동시에 수정(DB 연결 10개보다 많음)
        sleep(8000).then(() => null), // 서버가 서로 막혀 멈추면 여기서 끝냄
    ]); // 동시 수정 결과
    const limitTask = await ack(B.socket, 'task:create', { board_id: boardA, title: 'AC checklist limit' }); // 개수 제한을 시험할 다른 업무
    const limitId = limitTask.ok ? limitTask.task.task_id : 0; // 그 업무 번호
    const many = await Promise.all(Array.from({ length: 31 }, (_, i) => ack(B.socket, 'checklist:add', { board_id: boardA, task_id: limitId, title: '항목 ' + (i + 1) }))); // 한꺼번에 31개 추가
    const manyOk = many.filter((r) => r.ok).length; // 받아 준 수
    const manyRefused = many.filter((r) => r.ok === false && r.error.code === 'BAD_REQUEST').length; // 개수 제한으로 거절된 수
    const itemBad = [
        await ack(B.socket, 'checklist:add', { board_id: boardA, task_id: taskId, title: ' \n ' }), // 빈 이름
        await ack(B.socket, 'checklist:add', { board_id: boardA, task_id: taskId, title: 'x'.repeat(121) }), // 너무 긴 이름
        await ack(B.socket, 'checklist:update', { board_id: boardA, task_id: taskId, item_id: itemId, changes: { done: 'yes' } }), // 체크 값이 참·거짓이 아님
        await ack(B.socket, 'checklist:update', { board_id: boardA, task_id: taskId, item_id: itemId, changes: {} }), // 바꿀 내용 없음
    ]; // 형식이 잘못된 요청들
    const itemMissing = [
        await ack(B.socket, 'checklist:update', { board_id: boardA, task_id: limitId, item_id: itemId, changes: { done: false } }), // 다른 업무의 항목 번호
        await ack(B.socket, 'checklist:add', { board_id: boardA, task_id: 99999999, title: '없는 업무' }), // 없는 업무
    ]; // 대상이 없는 요청들
    const itemForbidden = [
        await ack(V.socket, 'checklist:update', { board_id: boardA, task_id: taskId, item_id: itemId, changes: { done: false } }), // 열람자(보드 연결)
        await ack(VW2, 'checklist:add', { task_id: taskId, title: '열람자 항목' }), // 열람자(작업실 연결)
        await ack(B.socket, 'checklist:add', { board_id: boardB, task_id: taskId, title: '다른 보드 번호' }), // 참여하지 않은 보드 번호
        await ack(idle, 'checklist:add', { task_id: taskId, title: '미참여' }), // 어디에도 참여하지 않은 연결
    ]; // 권한이 없는 요청들
    const deleteSeen = until(C2.socket, 'task:updated', (d) => d.task.task_id === taskId && d.task.checklist.length === 0); // 같은 보드의 참여자가 받을 삭제
    const itemDelete = await ack(B.socket, 'checklist:delete', { board_id: boardA, task_id: taskId, item_id: itemId }); // 항목 삭제
    const boardSawDelete = await deleteSeen; // 수신
    const itemDeleteAgain = await ack(B.socket, 'checklist:delete', { board_id: boardA, task_id: taskId, item_id: itemId }); // 이미 지운 항목
    for (const s of [W2, VW2, idle])
    {
        s.disconnect(); // 연결 정리
    }
    record('AC30', '업무 체크리스트', w2Join.ok && vw2Join.ok && itemAdd.ok && itemAdd.task.checklist.length === 1 && itemAdd.task.checklist[0].title === '첫 항목' && itemAdd.task.checklist[0].done === false
        && boardSawItem !== null && workspaceSawItem !== null && itemCheck.ok && boardSawCheck !== null
        && itemRename.ok && itemRename.task.checklist[0].title === '고친 항목' && itemRename.task.checklist[0].done === true && itemRename.task.version === itemAdd.task.version && afterItems.ok
        && !!itemListed && itemListed.checklist.length === 1 && itemListed.checklist[0].title === '고친 항목' && itemListed.checklist[0].done === true
        && burst !== null && burst.every((r) => r.ok && r.task.status === 'doing') && manyOk === 30 && manyRefused === 1 && itemBad.every((r) => r.ok === false && r.error.code === 'BAD_REQUEST')
        && itemMissing.every((r) => r.ok === false && r.error.code === 'NOT_FOUND') && itemForbidden.every((r) => r.ok === false && r.error.code === 'FORBIDDEN')
        && itemDelete.ok && boardSawDelete !== null && itemDeleteAgain.ok === false && itemDeleteAgain.error.code === 'NOT_FOUND',
        '보드에서 더한 항목이 다른 보드와 작업실에 전달, 다른 보드의 체크와 작업실의 이름 변경이 저장되고 목록 조회에도 실림, 항목을 바꿔도 업무 버전은 그대로라 앞선 버전의 업무 수정이 충돌하지 않음, 업무 12개를 동시에 고쳐도 모두 저장, 항목을 한꺼번에 31개 보내도 ' + manyOk + '개만 저장, 잘못된 형식 BAD_REQUEST·없는 대상 NOT_FOUND·열람자와 미참여 FORBIDDEN, 삭제 전달 (화면 조작은 리허설 6·9번과 캡처가 확인)');

    // AC31 작업실 삭제: 관리자가 이름을 확인하고 지우면 그 작업실의 모든 것과 올린 이미지가 사라지고, 접속해 있던 사람은 알림을 받고 연결이 끊긴다. 다른 작업실은 그대로 남는다
    const DOOMED = 'AC 지울 작업실'; // 지울 작업실 이름
    const doomed = await api('POST', '/api/projects', { display_name: 'AC-Doomed-Owner', title: DOOMED }); // 지울 작업실(만든 사람이 관리자)
    const doomedId = doomed.status === 201 ? doomed.json.project.project_id : 0; // 그 작업실 번호
    const doomedBoard = doomed.status === 201 ? doomed.json.board.board_id : 0; // 첫 보드
    const doomedInvite = await api('POST', '/api/projects/' + doomedId + '/invites', { role: 'editor', days: 1 }, doomed.cookie); // 편집자 코드
    const doomedEditor = await join('AC-Doomed-Editor', doomedInvite.json.code); // 그 작업실의 편집자
    const doomedUpload = await api('POST', '/api/images', imageForm(doomedId, fs.readFileSync(path.join(FIXTURES, 'tiny.png')), 'image/png', 'doomed.png'), doomedEditor.cookie); // 그 작업실에 올린 이미지
    const uploadRoot = process.env.UPLOAD_DIR || path.join(PHP_API, 'storage', 'uploads'); // 업로드 폴더
    const doomedDir = path.join(uploadRoot, String(doomedId)); // 지울 작업실의 이미지 폴더
    const mainDir = path.join(uploadRoot, String(projectId)); // 남아야 하는 작업실의 이미지 폴더
    const filesBefore = { doomed: fs.existsSync(doomedDir) ? fs.readdirSync(doomedDir).length : 0, main: fs.existsSync(mainDir) ? fs.readdirSync(mainDir).length : 0 }; // 지우기 전 파일 수
    const doomedSocket = await connect(); // 편집자의 보드 연결
    const doomedJoin = await ack(doomedSocket, 'board:join', { board_id: doomedBoard, ticket: await ticket(doomedEditor.cookie, doomedBoard) }); // 보드 참여
    const doomedTask = await ack(doomedSocket, 'task:create', { board_id: doomedBoard, title: '지워질 업무' }); // 함께 지워질 업무
    await ack(doomedSocket, 'checklist:add', { board_id: doomedBoard, task_id: doomedTask.ok ? doomedTask.task.task_id : 0, title: '지워질 항목' }); // 함께 지워질 체크리스트 항목
    await ack(doomedSocket, 'object:create', { board_id: doomedBoard, type: 'task', x: 0, y: 0, width: 240, height: 110, payload: { task_id: doomedTask.ok ? doomedTask.task.task_id : 0 } }); // 함께 지워질 블럭
    const doomedWorkspace = await connect(); // 만든 사람의 작업실 연결
    const doomedWsJoin = await ack(doomedWorkspace, 'project:join', { project_id: doomedId, ticket: (await projectTicket(doomed.cookie, doomedId)).json.ticket }); // 작업실 참여
    const delUrl = '/api/projects/' + doomedId + '/delete'; // 삭제 API
    const delByEditor = await api('POST', delUrl, { confirm_title: DOOMED }, doomedEditor.cookie); // 편집자의 삭제 시도
    const delByOutsider = await api('POST', delUrl, { confirm_title: DOOMED }, admin.cookie); // 다른 작업실 관리자의 삭제 시도
    const delWrongName = await api('POST', delUrl, { confirm_title: 'AC 지울 작업' }, doomed.cookie); // 관리자지만 이름을 다르게 적음
    const delNoHeader = await fetch(API + delUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: doomed.cookie }, body: JSON.stringify({ confirm_title: DOOMED }) }); // CSRF 방어 헤더 없이
    const delDisabled = await deleteWhenDisabled(delUrl, doomed.cookie, DOOMED); // 서버 설정으로 삭제를 꺼 둔 경우
    const stillThere = await api('GET', '/api/projects/' + doomedId + '/boards', undefined, doomed.cookie); // 거부된 시도들 뒤에도 그대로 있는지
    const boardTold = until(doomedSocket, 'project:deleted', (d) => d.project_id === doomedId, 4000); // 보드 연결이 받을 삭제 알림
    const workspaceTold = until(doomedWorkspace, 'project:deleted', (d) => d.project_id === doomedId, 4000); // 작업실 연결이 받을 삭제 알림
    let boardEventToo = false; // 작업실째 지울 때 보드 삭제 알림까지 따로 왔는지
    doomedSocket.on('board:deleted', () => { boardEventToo = true; }); // 오면 안 됨(화면이 작업실로 돌아가려다 실패함)
    const boardClosed = new Promise((resolve) => doomedSocket.on('disconnect', () => resolve(true))); // 알림 뒤 서버가 연결을 끊음
    const del = await api('POST', delUrl, { confirm_title: DOOMED }, doomed.cookie); // 관리자가 이름을 맞게 적고 삭제
    const toldBoard = await boardTold; // 수신
    const toldWorkspace = await workspaceTold; // 수신
    const closed = await Promise.race([boardClosed, sleep(3000).then(() => false)]); // 연결 종료 확인
    const ownerAfter = await api('GET', '/api/me', undefined, doomed.cookie); // 지운 사람의 세션
    const editorAfter = await api('GET', '/api/me', undefined, doomedEditor.cookie); // 그 작업실에만 있던 편집자의 세션
    const codeAfter = await join('AC-Doomed-Editor', doomedInvite.json.code); // 지워진 작업실의 초대 코드
    const ownerCodeAfter = await join('AC-Doomed-Owner', doomed.json.owner_code); // 지워진 작업실의 재입장 코드
    const delAgain = await api('POST', delUrl, { confirm_title: DOOMED }, admin.cookie); // 이미 지워진 작업실
    const filesAfter = { doomed: fs.existsSync(doomedDir), main: fs.existsSync(mainDir) ? fs.readdirSync(mainDir).length : 0 }; // 지운 뒤 파일
    const mainAfter = await api('GET', '/api/projects/' + projectId + '/boards', undefined, B.cookie); // 다른 작업실은 그대로
    doomedWorkspace.disconnect(); // 정리(이미 끊겼어도 무해)
    record('AC31', '작업실 삭제', doomed.status === 201 && doomedUpload.status === 201 && filesBefore.doomed === 1 && filesBefore.main > 0 && doomedJoin.ok && doomedTask.ok && doomedWsJoin.ok
        && delByEditor.status === 403 && delByOutsider.status === 403 && delWrongName.status === 400 && delWrongName.json.error.code === 'CONFIRM_MISMATCH' && delNoHeader.status === 403
        && delDisabled.status === 403 && delDisabled.code === 'DELETE_DISABLED' && stillThere.status === 200 && stillThere.json.boards.length === 1
        && del.status === 200 && del.json.deleted === true && del.json.removed_files === 1 && toldBoard !== null && toldWorkspace !== null && boardEventToo === false && closed === true
        && ownerAfter.status === 401 && editorAfter.status === 401 && codeAfter.status === 401 && ownerCodeAfter.status === 401 && delAgain.status === 403
        && filesAfter.doomed === false && filesAfter.main === filesBefore.main && mainAfter.status === 200 && mainAfter.json.boards.length >= 1,
        '편집자·다른 작업실 관리자·이름 불일치(CONFIRM_MISMATCH)·헤더 없음·꺼 둔 서버(DELETE_DISABLED)는 거부되고 작업실은 그대로, 관리자가 이름을 맞게 적으면 삭제. 보드·작업실 연결에 project:deleted 가 가고 연결 종료, 참여자 세션과 초대 코드·재입장 코드는 무효, 그 작업실의 이미지 폴더만 사라지고 다른 작업실의 파일 ' + filesBefore.main + '개는 그대로');

    // AC32 업무 삭제: 업무를 지우면 체크리스트와 모든 보드의 블럭, 블럭의 연결선이 함께 사라지고 그 업무를 보던 모든 화면에 전달된다
    const victim = await ack(B.socket, 'task:create', { board_id: boardA, title: 'AC 지울 업무' }); // 지울 업무
    const victimId = victim.ok ? victim.task.task_id : 0; // 그 업무 번호
    await ack(B.socket, 'checklist:add', { board_id: boardA, task_id: victimId, title: '함께 지워질 항목' }); // 체크리스트 항목
    const victimBlockA = await ack(B.socket, 'object:create', { board_id: boardA, type: 'task', x: 300, y: 300, width: 240, height: 110, payload: { task_id: victimId } }); // 보드 A 의 블럭
    const victimBlockB = await ack(C.socket, 'object:create', { board_id: boardB, type: 'task', x: 300, y: 300, width: 240, height: 110, payload: { task_id: victimId } }); // 보드 B 의 블럭
    const victimLink = await ack(B.socket, 'link:create', { board_id: boardA, from_object_id: n1.object_id, to_object_id: victimBlockA.object_id, label: '지워질 연결선' }); // 블럭에 이은 연결선
    const victimLock = await ack(C2.socket, 'object:lock', { board_id: boardA, object_id: victimBlockA.object_id }); // 다른 사람이 그 블럭을 잡고 있는 중
    const W3 = await connect(); // 편집자의 작업실 연결
    const w3Join = await ack(W3, 'project:join', { project_id: projectId, ticket: (await projectTicket(B.cookie)).json.ticket }); // 작업실 참여
    const delByViewer = await ack(V.socket, 'task:delete', { board_id: boardA, task_id: victimId }); // 열람자의 삭제 시도
    const delOtherBoard = await ack(B.socket, 'task:delete', { board_id: boardB, task_id: victimId }); // 참여하지 않은 보드 번호
    const delMissing = await ack(B.socket, 'task:delete', { board_id: boardA, task_id: 99999999 }); // 없는 업무
    const delBadId = await ack(B.socket, 'task:delete', { board_id: boardA, task_id: 'x' }); // 번호가 아님
    const blockGoneAtA = until(C2.socket, 'object:deleted', (d) => d.object_id === victimBlockA.object_id); // 보드 A 참여자(블럭을 잡고 있던 사람)가 받을 블럭 삭제
    const blockGoneAtB = until(C.socket, 'object:deleted', (d) => d.object_id === victimBlockB.object_id); // 보드 B 참여자가 받을 블럭 삭제
    const taskGoneAtA = until(B.socket, 'task:deleted', (d) => d.task_id === victimId); // 보드 A 가 받을 업무 삭제
    const taskGoneAtB = until(C.socket, 'task:deleted', (d) => d.task_id === victimId); // 보드 B 가 받을 업무 삭제
    const delTask = await ack(W3, 'task:delete', { task_id: victimId }); // 작업실에서 업무 삭제(보드 번호 없음)
    const sawBlockA = await blockGoneAtA; // 수신
    const sawBlockB = await blockGoneAtB; // 수신
    const sawTaskA = await taskGoneAtA; // 수신
    const sawTaskB = await taskGoneAtB; // 수신
    const tasksLeft = (await api('GET', '/api/projects/' + projectId + '/tasks', undefined, B.cookie)).json.tasks; // 남은 업무
    const snapADel = (await api('GET', '/api/boards/' + boardA + '/snapshot', undefined, B.cookie)).json; // 보드 A 스냅샷
    const snapBDel = (await api('GET', '/api/boards/' + boardB + '/snapshot', undefined, B.cookie)).json; // 보드 B 스냅샷
    const lockAfterDel = await ack(B.socket, 'object:lock', { board_id: boardA, object_id: victimBlockA.object_id }); // 지워진 블럭 잠금 시도
    const delTaskAgain = await ack(W3, 'task:delete', { task_id: victimId }); // 이미 지운 업무
    const blockAfterDel = await ack(B.socket, 'object:create', { board_id: boardA, type: 'task', x: 0, y: 0, width: 240, height: 110, payload: { task_id: victimId } }); // 지워진 업무의 블럭을 다시 놓으려는 시도(실행 취소가 보내는 요청과 같음)
    const itemAfterDel = await ack(B.socket, 'checklist:add', { board_id: boardA, task_id: victimId, title: '없는 업무의 항목' }); // 지워진 업무에 항목 추가
    W3.disconnect(); // 정리
    record('AC32', '업무 삭제', victim.ok && victimBlockA.ok && victimBlockB.ok && victimLink.ok && victimLock.ok && w3Join.ok
        && delByViewer.ok === false && delByViewer.error.code === 'FORBIDDEN' && delOtherBoard.ok === false && delOtherBoard.error.code === 'FORBIDDEN'
        && delMissing.ok === false && delMissing.error.code === 'NOT_FOUND' && delBadId.ok === false && delBadId.error.code === 'BAD_REQUEST'
        && delTask.ok && delTask.removed_objects.length === 2 && sawBlockA !== null && sawBlockB !== null && sawTaskA !== null && sawTaskB !== null
        && !tasksLeft.some((t) => t.task_id === victimId) && tasksLeft.some((t) => t.task_id === taskId)
        && !snapADel.objects.some((o) => o.object_id === victimBlockA.object_id) && !snapBDel.objects.some((o) => o.object_id === victimBlockB.object_id)
        && !snapADel.links.some((l) => l.link_id === victimLink.link.link_id) && snapADel.objects.some((o) => o.object_id === n1.object_id)
        && lockAfterDel.ok === false && delTaskAgain.ok === false && delTaskAgain.error.code === 'NOT_FOUND'
        && blockAfterDel.ok === false && blockAfterDel.error.code === 'BAD_REQUEST' && itemAfterDel.ok === false && itemAfterDel.error.code === 'NOT_FOUND',
        '열람자·다른 보드 번호 FORBIDDEN, 없는 업무 NOT_FOUND. 작업실에서 지우면 두 보드의 블럭 2개와 연결선·체크리스트가 함께 사라지고 object:deleted·task:deleted 가 두 보드에 전달, 다른 사람이 잡고 있던 블럭의 잠금도 정리, 다른 업무와 객체는 그대로, 지워진 업무의 블럭 다시 놓기와 항목 추가는 거부');

    // SEC01 접속 출처 제한(수용 기준과 별도의 보안 점검)
    const sameHostOrigin = 'http://127.0.0.1:' + API_PORT; // 실시간 서버와 같은 호스트에서 열린 페이지(포트만 다름)
    const foreignWs = await connectFrom('http://evil.example'); // 다른 사이트의 페이지
    const nullWs = await connectFrom('null'); // 파일·샌드박스 페이지
    const sameWs = await connectFrom(sameHostOrigin); // 우리 페이지
    const foreignPoll = await pollingHandshake('http://evil.example'); // 다른 사이트의 폴링 연결
    const samePoll = await pollingHandshake(sameHostOrigin); // 우리 페이지의 폴링 연결
    const plainPoll = await pollingHandshake(null); // 출처 없는 클라이언트(테스트 스크립트)
    record('SEC01', '접속 출처 제한', foreignWs === false && nullWs === false && sameWs === true && foreignPoll.status === 403 && foreignPoll.allow === null
        && samePoll.status === 200 && samePoll.allow === sameHostOrigin && plainPoll.status === 200, '다른 사이트 출처의 웹소켓·폴링 연결 403, 같은 호스트의 페이지와 출처 없는 클라이언트는 허용');

    // SEC02 요청 제한: 한 연결이 요청을 쏟아내면 응답 있는 요청은 RATE_LIMITED 로 거절, 미리보기 중계는 일부만 전달. 잠시 뒤에는 다시 받음
    const flood = await connect(); // 보드에 참여하지 않은 새 연결(제한은 연결마다 따로라 다른 검사에 영향 없음)
    const pings = await Promise.all(Array.from({ length: 400 }, () => ack(flood, 'net:ping', {}))); // 한꺼번에 400번
    const pingPassed = pings.filter((r) => r && r.ok === true).length; // 받아 준 수(기본 통 크기 300 + 그 사이 다시 찬 만큼)
    const pingLimited = pings.filter((r) => r && r.ok === false && r.error.code === 'RATE_LIMITED').length; // 거절된 수
    await sleep(1200); // 통이 다시 차기를 기다림
    const pingAfterWait = await ack(flood, 'net:ping', {}); // 잠시 뒤에는 다시 받음
    flood.disconnect(); // 정리
    const noisy = await enter('AC-Noisy', editorCode, boardA); // 미리보기를 쏟아낼 편집자
    let relayed = 0; // 다른 참여자가 받은 미리보기 수
    const countPreview = () => { relayed += 1; }; // 수신 집계
    C2.socket.on('stroke:preview', countPreview); // 같은 보드의 참여자가 받는 미리보기
    for (let i = 0; i < 3000; i++)
    {
        noisy.socket.emit('stroke:preview', { board_id: boardA, stroke_id: 'ac-flood', points_delta: [[i, i]], style: { color: '#000000', width: 1 } }); // 한꺼번에 3000번
    }
    const lockWhileNoisy = await ack(noisy.socket, 'object:lock', { board_id: boardA, object_id: target.object_id }); // 저장 쪽 요청은 따로 세므로 계속 됨
    await sleep(600); // 전달 대기
    C2.socket.off('stroke:preview', countPreview); // 집계 종료
    await ack(noisy.socket, 'object:unlock', { board_id: boardA, object_id: target.object_id, lock_token: lockWhileNoisy.lock_token }); // 잠금 반납
    noisy.socket.disconnect(); // 정리
    record('SEC02', '요청 제한', pingPassed >= 300 && pingPassed < 400 && pingLimited === 400 - pingPassed && pingAfterWait.ok === true
        && relayed > 0 && relayed < 3000 && lockWhileNoisy.ok === true,
        '한꺼번에 보낸 400번 중 ' + pingPassed + '번만 받고 나머지는 RATE_LIMITED, 잠시 뒤 다시 받음. 미리보기 3000번 중 ' + relayed + '번만 전달, 그동안에도 잠금 요청은 처리');

    // OPS01 업로드 정리(수용 기준과 별도의 운영 점검): 보드에서 쓰지 않는 이미지만 지워지는지
    const keepUpload = await api('POST', '/api/images', imageForm(projectId, fs.readFileSync(path.join(FIXTURES, 'tiny.png')), 'image/png', 'keep.png'), B.cookie); // 계속 쓸 이미지
    const dropUpload = await api('POST', '/api/images', imageForm(projectId, fs.readFileSync(path.join(FIXTURES, 'tiny.jpg')), 'image/jpeg', 'drop.jpg'), B.cookie); // 지웠다가 정리될 이미지
    const keepObj = await ack(B.socket, 'object:create', { board_id: boardA, type: 'image', x: 0, y: 300, width: 40, height: 40, payload: { asset_id: keepUpload.json.asset.asset_id } }); // 보드에 놓은 이미지
    const dropObj = await ack(B.socket, 'object:create', { board_id: boardA, type: 'image', x: 60, y: 300, width: 40, height: 40, payload: { asset_id: dropUpload.json.asset.asset_id } }); // 곧 지울 이미지
    const dropLock = await ack(B.socket, 'object:lock', { board_id: boardA, object_id: dropObj.object_id }); // 삭제용 잠금
    const dropDelete = await ack(B.socket, 'object:delete', { board_id: boardA, object_id: dropObj.object_id, lock_token: dropLock.lock_token, version: 1 }); // 보드에서 이미지 삭제
    const afterDelete = await api('GET', '/api/images/' + dropUpload.json.asset.asset_id, undefined, B.cookie); // 보드에서 지워도 파일은 남아 있어야 함(실행 취소용)
    const scope = '--project=' + projectId; // 이 테스트 프로젝트의 이미지만 정리(같은 DB 의 다른 프로젝트는 건드리지 않음)
    const cleanPreview = phpCli('clean-uploads.php', ['--older-than=0', scope]); // 미리보기(아무것도 지우지 않음)
    const afterPreview = await api('GET', '/api/images/' + dropUpload.json.asset.asset_id, undefined, B.cookie); // 미리보기 뒤에도 그대로
    let guarded = false; // 접속 중 보호가 동작했는지
    try
    {
        phpCli('clean-uploads.php', ['--apply', '--older-than=0', scope]); // 방금 보드에 접속한 기록이 있으므로 멈춰야 함
    }
    catch (err)
    {
        guarded = err.status === 1; // 종료 코드 1 로 거절
    }
    const applied = phpCli('clean-uploads.php', ['--apply', '--older-than=0', '--force', scope]); // 실제 정리
    const dropGone = await api('GET', '/api/images/' + dropUpload.json.asset.asset_id, undefined, B.cookie); // 쓰지 않는 이미지는 사라짐
    const keepStays = await api('GET', '/api/images/' + keepUpload.json.asset.asset_id, undefined, B.cookie); // 보드에 놓인 이미지는 남음
    record('OPS01', '업로드 정리', keepObj.ok && dropDelete.ok && afterDelete.status === 200 && /미리보기/.test(cleanPreview) && afterPreview.status === 200 && guarded
        && /지웠습니다/.test(applied) && dropGone.status === 404 && keepStays.status === 200, '보드에서 지운 이미지는 정리 전까지 남고, 미리보기는 지우지 않으며, 접속 중에는 멈추고, 정리 후 쓰지 않는 이미지만 사라짐');

    // AC15 실제 LAN
    record('AC15', '실제 LAN', null, '학교 PC 4대 환경에서 수동 확인 (docs/15-deployment-school-pc.md)');

    for (const s of [B.socket, C.socket, C2.socket, V.socket])
    {
        s.disconnect(); // 소켓 정리
    }
}

// ---------- 실행 ----------

async function main()
{
    const servers = startServers(); // 서버 시작
    let exitCode = 0; // 종료 코드
    try
    {
        await waitFor(API + '/api/health'); // PHP 준비
        await waitFor(RT + '/health'); // 실시간 준비
        const envInfo = setupProject(); // 프로젝트·초대 코드 준비
        console.log('테스트 프로젝트 project_id=' + envInfo.projectId + ' 보드 ' + envInfo.boardA + '/' + envInfo.boardB); // 환경 출력
        await run(envInfo); // 시나리오 실행
    }
    catch (err)
    {
        console.error('수용 테스트 실행 오류', err); // 실행 오류
        exitCode = 1; // 실패
    }
    finally
    {
        servers.php.kill(); // PHP 종료
        servers.rt.kill(); // 실시간 종료
    }
    const failed = results.filter((r) => r.status === 'FAIL'); // 실패 목록
    console.log('\n| ID | 검증 대상 | 결과 | 비고 |\n|---|---|---|---|'); // 마크다운 표 머리
    for (const r of results)
    {
        console.log('| ' + r.id + ' | ' + r.name + ' | ' + ({ PASS: '통과', FAIL: '실패', MANUAL: '수동 확인' })[r.status] + ' | ' + r.detail + ' |'); // 표 행
    }
    const accept = results.filter((r) => r.id.startsWith('AC')); // 수용 기준 항목
    const security = results.filter((r) => r.id.startsWith('SEC')); // 보안 점검 항목
    const operations = results.filter((r) => r.id.startsWith('OPS')); // 운영 점검 항목
    const count = (list, status) => list.filter((r) => r.status === status).length; // 상태별 개수
    console.log('\n자동 ' + count(accept, 'PASS') + ' 통과, ' + count(accept, 'FAIL') + ' 실패, ' + count(accept, 'MANUAL') + ' 수동'); // 수용 기준 요약
    console.log('보안 점검 ' + count(security, 'PASS') + ' 통과, ' + count(security, 'FAIL') + ' 실패'); // 보안 점검 요약
    console.log('운영 점검 ' + count(operations, 'PASS') + ' 통과, ' + count(operations, 'FAIL') + ' 실패'); // 운영 점검 요약
    process.exit(exitCode || (failed.length > 0 ? 1 : 0)); // 종료
}

main(); // 시작
