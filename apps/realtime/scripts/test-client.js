// 개발용 통합 테스트: PHP API 로 입장·티켓 발급 → Socket.IO 참여 → 펜 중계·저장 확인
// 사용법: node scripts/test-client.js <초대코드> [API=http://127.0.0.1:8080] [RT=http://127.0.0.1:3001] [board_id=3]
'use strict';

const { io } = require('socket.io-client'); // 테스트용 클라이언트

const [inviteCode, API = 'http://127.0.0.1:8080', RT = 'http://127.0.0.1:3001', BOARD = '3'] = process.argv.slice(2); // 실행 인자
const boardId = Number(BOARD); // 테스트 보드
if (!inviteCode)
{
    console.error('사용법: node scripts/test-client.js <초대코드> [API] [RT] [board_id]'); // 사용법 안내
    process.exit(1);
}

let failures = 0; // 실패 횟수

function check(label, condition, detail)
{
    console.log((condition ? 'PASS' : 'FAIL') + ' ' + label + (detail ? ' — ' + JSON.stringify(detail) : '')); // 결과 출력
    if (!condition)
    {
        failures++; // 실패 집계
    }
}

async function api(path, body, cookie)
{
    const res = await fetch(API + path, {
        method: body ? 'POST' : 'GET', // 메서드
        headers: { 'Content-Type': 'application/json', 'X-TaskCanvas': '1', ...(cookie ? { Cookie: cookie } : {}) }, // 필수 헤더
        body: body ? JSON.stringify(body) : undefined, // JSON 본문
    }); // HTTP 호출
    const setCookie = res.headers.get('set-cookie') ?? ''; // 세션 쿠키
    return { status: res.status, json: await res.json(), cookie: setCookie.split(';')[0] }; // 응답 요약
}

async function login(name)
{
    const joined = await api('/api/guest/join', { display_name: name, invite_code: inviteCode }); // 게스트 입장
    check(name + ' 입장', joined.status === 201, joined.json); // 입장 확인
    const ticket = await api('/api/realtime-ticket', { board_id: boardId }, joined.cookie); // 티켓 발급
    check(name + ' 티켓 발급', ticket.status === 201); // 티켓 확인
    return { cookie: joined.cookie, ticket: ticket.json.ticket }; // 세션·티켓
}

function emitAck(socket, event, data)
{
    return new Promise((resolve) => socket.emit(event, data, resolve)); // ack 를 프로미스로 변환
}

function waitFor(socket, event, timeoutMs = 2000)
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

async function main()
{
    const a = await login('실시간A'); // 사용자 A
    const b = await login('실시간B'); // 사용자 B

    const sa = io(RT, { transports: ['websocket'] }); // A 소켓
    const sb = io(RT, { transports: ['websocket'] }); // B 소켓
    await Promise.all([waitFor(sa, 'connect'), waitFor(sb, 'connect')]); // 연결 대기

    const bad = await emitAck(sa, 'board:join', { board_id: boardId, ticket: 'wrong-ticket-value' }); // 잘못된 티켓
    check('잘못된 티켓 거부', bad.ok === false && bad.error.code === 'INVALID_TICKET', bad.error); // 거부 확인

    const joinA = await emitAck(sa, 'board:join', { board_id: boardId, ticket: a.ticket }); // A 참여
    check('A 보드 참여', joinA.ok === true && joinA.you.display_name === '실시간A', joinA.you); // 참여 확인

    const presencePromise = waitFor(sa, 'presence:update'); // A 가 받을 참여자 갱신
    const joinB = await emitAck(sb, 'board:join', { board_id: boardId, ticket: b.ticket }); // B 참여
    check('B 보드 참여', joinB.ok === true && joinB.participants.length === 2, joinB.participants.map((p) => p.display_name)); // 참여자 2명
    const presence = await presencePromise; // 갱신 수신
    check('A 에게 참여자 갱신 전달', presence !== null && presence.participants.length === 2); // 전달 확인

    const reuse = await emitAck(sb, 'board:join', { board_id: boardId, ticket: b.ticket }); // 같은 연결 재참여
    check('중복 참여 차단', reuse.ok === false && reuse.error.code === 'ALREADY_JOINED'); // 차단 확인

    const cursorPromise = waitFor(sb, 'cursor:move'); // B 가 받을 커서
    sa.emit('cursor:move', { board_id: boardId, x: 120, y: 80 }); // A 커서 이동
    const cursor = await cursorPromise; // 커서 수신
    check('커서 중계', cursor !== null && cursor.x === 120 && cursor.display_name === '실시간A' && typeof cursor.color === 'string', cursor); // 중계 확인

    const previewPromise = waitFor(sb, 'stroke:preview'); // B 가 받을 미리보기
    sa.emit('stroke:preview', { board_id: boardId, stroke_id: 'tmp-1', points_delta: [[1, 1], [2, 2]], style: { color: '#ff0000', width: 4 } }); // A 미리보기
    const preview = await previewPromise; // 미리보기 수신
    check('펜 미리보기 중계', preview !== null && preview.stroke_id === 'tmp-1' && preview.points_delta.length === 2, preview); // 중계 확인

    const createdPromise = waitFor(sb, 'object:created'); // B 가 받을 확정 객체
    const commit = await emitAck(sa, 'stroke:commit', { board_id: boardId, stroke_id: 'tmp-1', request_id: 'req-1', points: [[1, 1], [50, 20], [10, 90]], style: { color: '#ff0000', width: 4 } }); // A 확정
    check('펜 확정 저장 응답', commit.ok === true && commit.persisted === true && commit.request_id === 'req-1' && commit.object_id > 0, commit); // 저장 응답
    const created = await createdPromise; // 확정 객체 수신
    check('확정 객체 전달', created !== null && created.object.object_id === commit.object_id && created.object.width === 49 && created.object.height === 89, created && created.object); // 경계 계산 확인

    const wrongBoard = await emitAck(sa, 'stroke:commit', { board_id: boardId + 1, points: [[0, 0]] }); // 다른 보드로 전송
    check('다른 보드 이벤트 거부', wrongBoard.ok === false && wrongBoard.error.code === 'FORBIDDEN'); // 거부 확인

    const badPoints = await emitAck(sa, 'stroke:commit', { board_id: boardId, points: 'nope' }); // 잘못된 좌표
    check('잘못된 좌표 거부', badPoints.ok === false && badPoints.error.code === 'BAD_REQUEST'); // 거부 확인

    const snapshot = await api('/api/boards/' + boardId + '/snapshot', null, a.cookie); // 스냅샷 재조회
    const saved = snapshot.json.objects.find((o) => o.object_id === commit.object_id); // 저장된 획
    check('스냅샷에 저장된 획 포함', saved !== undefined && saved.type === 'stroke' && saved.payload.points.length === 3 && saved.style.color === '#ff0000', saved); // 복원 확인

    const leavePromise = waitFor(sb, 'presence:update'); // B 가 받을 퇴장 갱신
    sa.disconnect(); // A 연결 종료
    const left = await leavePromise; // 갱신 수신
    check('연결 종료 시 참여자 갱신', left !== null && left.participants.length === 1 && left.participants[0].display_name === '실시간B'); // 퇴장 확인

    sb.disconnect(); // B 연결 종료
    console.log(failures === 0 ? '모든 테스트 통과' : failures + '개 실패'); // 결과 요약
    process.exit(failures === 0 ? 0 : 1); // 종료 코드
}

main().catch((err) =>
{
    console.error('테스트 실행 오류', err); // 실행 오류
    process.exit(1);
});
