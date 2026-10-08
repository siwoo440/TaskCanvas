// 개발용 통합 테스트: PHP API 로 입장·티켓 발급 → Socket.IO 참여 → 펜 중계·저장 확인
// 사용법: node scripts/test-client.js <초대코드> [API=http://127.0.0.1:8080] [RT=http://127.0.0.1:3001] [board_id=3]
'use strict';

const fs = require('fs'); // 표본 이미지 읽기
const path = require('path'); // 경로 계산
const { io } = require('socket.io-client'); // 테스트용 클라이언트

const [inviteCode, API = 'http://127.0.0.1:8080', RT = 'http://127.0.0.1:3001', BOARD = '3'] = process.argv.slice(2); // 실행 인자
const boardId = Number(BOARD); // 테스트 보드
if (!inviteCode)
{
    console.error('사용법: node scripts/test-client.js <초대코드> [API] [RT] [board_id]'); // 사용법 안내
    process.exit(1);
}

let failures = 0; // 실패 횟수
let snapshotProject = 0; // 입장한 프로젝트 ID

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
    snapshotProject = joined.json.project_id; // 프로젝트 ID 기록
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

    const shapePromise = waitFor(sb, 'object:created'); // B 가 받을 도형
    const shape = await emitAck(sa, 'object:create', { board_id: boardId, type: 'rect', x: 10, y: 20, width: -30, height: 40, style: { stroke: '#0000ff', fill: '#ffff00', width: 2 }, request_id: 'req-2' }); // A 도형 생성(음수 너비 보정 확인)
    check('도형 생성 저장 응답', shape.ok === true && shape.object.type === 'rect' && shape.object.width === 30 && shape.object.style.fill === '#ffff00', shape.object); // 저장 응답
    const shapeCreated = await shapePromise; // 도형 수신
    check('도형 객체 전달', shapeCreated !== null && shapeCreated.object.object_id === shape.object_id); // 전달 확인

    const badType = await emitAck(sa, 'object:create', { board_id: boardId, type: 'script', x: 0, y: 0, width: 10, height: 10 }); // 허용되지 않은 유형
    check('잘못된 객체 유형 거부', badType.ok === false && badType.error.code === 'BAD_REQUEST'); // 거부 확인

    // ---- 이미지·영상 ----
    const png = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'assets', 'design', 'reference-dashboard.png')); // 저장소의 PNG 를 업로드 표본으로 사용
    const form = new FormData(); // multipart 본문
    form.append('project_id', String(joinA.you ? snapshotProject : snapshotProject)); // 프로젝트 ID
    form.append('file', new Blob([png], { type: 'image/png' }), 'sample.png'); // 이미지 파일
    const uploadRes = await fetch(API + '/api/images', { method: 'POST', headers: { 'X-TaskCanvas': '1', Cookie: a.cookie }, body: form }); // 업로드
    const uploaded = await uploadRes.json(); // 응답
    check('이미지 업로드', uploadRes.status === 201 && uploaded.asset.mime_type === 'image/png' && uploaded.asset.width > 0, uploaded.asset); // 업로드 확인

    const fake = new FormData(); // 위장 파일
    fake.append('project_id', String(snapshotProject)); // 프로젝트 ID
    fake.append('file', new Blob(['not an image'], { type: 'image/png' }), 'fake.png'); // 텍스트를 PNG 로 위장
    const fakeRes = await fetch(API + '/api/images', { method: 'POST', headers: { 'X-TaskCanvas': '1', Cookie: a.cookie }, body: fake }); // 업로드 시도
    check('위장 파일 거부(INVALID_FILE)', fakeRes.status === 415 && (await fakeRes.json()).error.code === 'INVALID_FILE'); // 거부 확인

    const big = new FormData(); // 10MB 초과 파일
    big.append('project_id', String(snapshotProject)); // 프로젝트 ID
    big.append('file', new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/png' }), 'big.png'); // 10MB + 1
    const bigRes = await fetch(API + '/api/images', { method: 'POST', headers: { 'X-TaskCanvas': '1', Cookie: a.cookie }, body: big }); // 업로드 시도
    check('10MB 초과 거부(FILE_TOO_LARGE)', bigRes.status === 413 && (await bigRes.json()).error.code === 'FILE_TOO_LARGE'); // 거부 확인

    const imgGet = await fetch(API + uploaded.asset.url, { headers: { Cookie: a.cookie } }); // 참여자 이미지 조회
    check('참여자 이미지 조회', imgGet.status === 200 && imgGet.headers.get('content-type') === 'image/png' && Number(imgGet.headers.get('content-length')) === png.length); // 조회 확인
    const imgAnon = await fetch(API + uploaded.asset.url); // 세션 없이 조회
    check('세션 없는 이미지 조회 거부', imgAnon.status === 401); // 거부 확인

    const imageObjPromise = waitFor(sb, 'object:created'); // B 가 받을 이미지 객체
    const imageObj = await emitAck(sa, 'object:create', { board_id: boardId, type: 'image', x: 0, y: 0, width: 200, height: 120, payload: { asset_id: uploaded.asset.asset_id } }); // 이미지 객체 생성
    check('이미지 객체 생성', imageObj.ok === true && imageObj.object.payload.url === uploaded.asset.url && imageObj.object.payload.mime_type === 'image/png', imageObj.object && imageObj.object.payload); // 생성 확인
    const imageSeen = await imageObjPromise; // 전달 수신
    check('B 에게 이미지 객체 전달', imageSeen !== null && imageSeen.object.type === 'image'); // 전달 확인

    const badAsset = await emitAck(sa, 'object:create', { board_id: boardId, type: 'image', x: 0, y: 0, width: 10, height: 10, payload: { asset_id: 999999 } }); // 없는 이미지
    check('없는 이미지 ID 거부', badAsset.ok === false && badAsset.error.code === 'BAD_REQUEST'); // 거부 확인

    const videoObj = await emitAck(sa, 'object:create', { board_id: boardId, type: 'video', x: 0, y: 0, width: 480, height: 298, payload: { source_url: 'https://youtu.be/dQw4w9WgXcQ?t=5' } }); // YouTube 단축 URL
    check('영상 객체 생성(YouTube 임베드 변환)', videoObj.ok === true && videoObj.object.payload.provider === 'youtube' && videoObj.object.payload.embed_url === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', videoObj.object && videoObj.object.payload); // 변환 확인

    const vimeoObj = await emitAck(sa, 'object:create', { board_id: boardId, type: 'video', x: 0, y: 0, width: 480, height: 298, payload: { source_url: 'https://vimeo.com/76979871' } }); // Vimeo URL
    check('영상 객체 생성(Vimeo)', vimeoObj.ok === true && vimeoObj.object.payload.embed_url === 'https://player.vimeo.com/video/76979871'); // 변환 확인

    const badVideo = await emitAck(sa, 'object:create', { board_id: boardId, type: 'video', x: 0, y: 0, width: 480, height: 298, payload: { source_url: 'https://example.com/watch?v=dQw4w9WgXcQ' } }); // 허용되지 않은 도메인
    check('허용되지 않은 영상 도메인 거부', badVideo.ok === false && badVideo.error.code === 'BAD_REQUEST'); // 거부 확인

    // ---- 잠금·이동·삭제 ----
    const lockedPromise = waitFor(sb, 'object:locked'); // B 가 받을 잠금 알림
    const lockA = await emitAck(sa, 'object:lock', { board_id: boardId, object_id: shape.object_id }); // A 잠금
    check('A 잠금 획득', lockA.ok === true && typeof lockA.lock_token === 'string', { expires_in: lockA.expires_in }); // 획득 확인
    const lockedEvent = await lockedPromise; // 잠금 알림 수신
    check('B 에게 잠금 알림 전달', lockedEvent !== null && lockedEvent.object_id === shape.object_id && lockedEvent.display_name === '실시간A'); // 전달 확인

    const lockB = await emitAck(sb, 'object:lock', { board_id: boardId, object_id: shape.object_id }); // B 잠금 시도
    check('B 잠금 거부(OBJECT_LOCKED)', lockB.ok === false && lockB.error.code === 'OBJECT_LOCKED' && lockB.error.locked_by.display_name === '실시간A'); // 거부 확인

    const commitB = await emitAck(sb, 'object:commit', { board_id: boardId, object_id: shape.object_id, lock_token: 'fake', version: 1, changes: { x: 0 } }); // B 가 토큰 없이 수정
    check('B 수정 요청 거부', commitB.ok === false && commitB.error.code === 'OBJECT_LOCKED'); // 거부 확인

    const movePromise = waitFor(sb, 'object:preview'); // B 가 받을 이동 미리보기
    sa.emit('object:preview', { board_id: boardId, object_id: shape.object_id, lock_token: lockA.lock_token, x: 100, y: 200 }); // A 이동 중
    const movePreview = await movePromise; // 미리보기 수신
    check('이동 미리보기 중계', movePreview !== null && movePreview.x === 100 && movePreview.y === 200, movePreview); // 중계 확인

    const conflict = await emitAck(sa, 'object:commit', { board_id: boardId, object_id: shape.object_id, lock_token: lockA.lock_token, version: 99, changes: { x: 100, y: 200 } }); // 잘못된 버전
    check('버전 불일치 거부(VERSION_CONFLICT)', conflict.ok === false && conflict.error.code === 'VERSION_CONFLICT' && conflict.object.version === 1); // 충돌 확인(최신 객체 포함)

    const relock = await emitAck(sa, 'object:lock', { board_id: boardId, object_id: shape.object_id }); // 충돌 후 재잠금
    const updatedPromise = waitFor(sb, 'object:updated'); // B 가 받을 변경
    const unlockedPromise = waitFor(sb, 'object:unlocked'); // B 가 받을 해제
    const commitA = await emitAck(sa, 'object:commit', { board_id: boardId, object_id: shape.object_id, lock_token: relock.lock_token, version: 1, changes: { x: 100, y: 200, width: 60, style: { stroke: '#00ff00', fill: null, width: 3 } }, request_id: 'req-3' }); // A 확정
    check('이동·크기·스타일 확정 저장', commitA.ok === true && commitA.new_version === 2 && commitA.object.x === 100 && commitA.object.width === 60 && commitA.object.style.stroke === '#00ff00', commitA.object); // 저장 확인
    const updated = await updatedPromise; // 변경 수신
    check('B 에게 변경 전달', updated !== null && updated.object.version === 2 && updated.object.y === 200); // 전달 확인
    const unlocked = await unlockedPromise; // 해제 수신
    check('확정 후 잠금 해제 알림', unlocked !== null && unlocked.object_id === shape.object_id); // 해제 확인

    const strokeLock = await emitAck(sa, 'object:lock', { board_id: boardId, object_id: commit.object_id }); // 획 잠금
    const strokeMove = await emitAck(sa, 'object:commit', { board_id: boardId, object_id: commit.object_id, lock_token: strokeLock.lock_token, version: 1, changes: { x: 11, y: 21 } }); // 획 이동(+10, +20)
    check('획 이동 시 좌표 평행 이동', strokeMove.ok === true && strokeMove.object.payload.points[0][0] === 11 && strokeMove.object.payload.points[0][1] === 21 && strokeMove.object.payload.points[2][1] === 110, strokeMove.object && strokeMove.object.payload.points); // 좌표 확인

    const deletedPromise = waitFor(sb, 'object:deleted'); // B 가 받을 삭제
    const lockDel = await emitAck(sa, 'object:lock', { board_id: boardId, object_id: shape.object_id }); // 삭제용 잠금
    const del = await emitAck(sa, 'object:delete', { board_id: boardId, object_id: shape.object_id, lock_token: lockDel.lock_token, version: 2 }); // 삭제
    check('삭제 저장', del.ok === true && del.persisted === true); // 삭제 확인
    const deleted = await deletedPromise; // 삭제 수신
    check('B 에게 삭제 전달', deleted !== null && deleted.object_id === shape.object_id); // 전달 확인

    const lockGone = await emitAck(sa, 'object:lock', { board_id: boardId, object_id: shape.object_id }); // 삭제된 객체 잠금
    check('삭제된 객체 잠금 거부(NOT_FOUND)', lockGone.ok === false && lockGone.error.code === 'NOT_FOUND'); // 거부 확인

    const holdLock = await emitAck(sa, 'object:lock', { board_id: boardId, object_id: commit.object_id }); // A 가 획을 잠근 채 연결 종료 예정
    const unlockOnDrop = waitFor(sb, 'object:unlocked', 3000); // B 가 받을 해제

    const wrongBoard = await emitAck(sa, 'stroke:commit', { board_id: boardId + 1, points: [[0, 0]] }); // 다른 보드로 전송
    check('다른 보드 이벤트 거부', wrongBoard.ok === false && wrongBoard.error.code === 'FORBIDDEN'); // 거부 확인

    const badPoints = await emitAck(sa, 'stroke:commit', { board_id: boardId, points: 'nope' }); // 잘못된 좌표
    check('잘못된 좌표 거부', badPoints.ok === false && badPoints.error.code === 'BAD_REQUEST'); // 거부 확인

    const snapshot = await api('/api/boards/' + boardId + '/snapshot', null, a.cookie); // 스냅샷 재조회
    const saved = snapshot.json.objects.find((o) => o.object_id === commit.object_id); // 저장된 획
    check('스냅샷에 저장된 획 포함(이동 반영)', saved !== undefined && saved.type === 'stroke' && saved.payload.points.length === 3 && saved.style.color === '#ff0000' && saved.version === 2 && saved.x === 11, saved); // 복원 확인

    const leavePromise = waitFor(sb, 'presence:update'); // B 가 받을 퇴장 갱신
    sa.disconnect(); // A 연결 종료
    const left = await leavePromise; // 갱신 수신
    check('연결 종료 시 참여자 갱신', left !== null && left.participants.length === 1 && left.participants[0].display_name === '실시간B'); // 퇴장 확인
    const dropped = await unlockOnDrop; // 해제 수신
    check('연결 종료 시 잠금 해제 알림', holdLock.ok === true && dropped !== null && dropped.object_id === commit.object_id && dropped.reason === 'disconnected'); // 해제 확인

    sb.disconnect(); // B 연결 종료
    console.log(failures === 0 ? '모든 테스트 통과' : failures + '개 실패'); // 결과 요약
    process.exit(failures === 0 ? 0 : 1); // 종료 코드
}

main().catch((err) =>
{
    console.error('테스트 실행 오류', err); // 실행 오류
    process.exit(1);
});
