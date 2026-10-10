// 수용 테스트 러너: PHP 내장 서버(8081)와 실시간 서버(3002)를 직접 띄우고 docs/11 의 AC01~AC14, AC16~AC23 과 보안 점검 SEC01, 운영 점검 OPS01 을 자동 검사
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

const ack = (socket, event, data) => new Promise((resolve) => socket.emit(event, data, resolve)); // ack 프로미스

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
    const badUses = await Promise.all([0, 101, 'x'].map((n) => api('POST', invitesPath, { role: 'viewer', days: 1, max_uses: n }, admin.cookie))); // 허용 범위 밖·형식 오류
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
