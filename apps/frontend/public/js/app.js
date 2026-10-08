// 화면 전환과 상태 관리: 입장 → 보드 선택 → 화이트보드(스냅샷 복원 + 실시간 연동)
'use strict';

const state = {
    guest: null, // {guest_id, display_name}
    project: null, // {project_id, title, role}
    boards: [], // 프로젝트 보드 목록
    board: null, // 현재 보드
    tool: 'pen', // 현재 도구
    style: { color: '#222222', width: 3, fill: null }, // 그리기 스타일
    pendingSaves: 0, // 저장 응답 대기 수
    requestSeq: 0, // 요청 ID 일련번호
}; // 전역 상태

const $ = (id) => document.getElementById(id); // 요소 조회 단축
let canvas = null; // BoardCanvas
let realtime = null; // Realtime

function showView(name)
{
    for (const v of document.querySelectorAll('.view'))
    {
        v.hidden = v.id !== 'view-' + name; // 해당 화면만 표시
    }
}

function toast(message, ms = 2500)
{
    const el = $('toast'); // 안내 요소
    el.textContent = message; // 메시지
    el.hidden = false; // 표시
    clearTimeout(toast.timer); // 이전 타이머 해제
    toast.timer = setTimeout(() => { el.hidden = true; }, ms); // 자동 숨김
}

function setConnection(stateName)
{
    const labels = { online: '연결됨', reconnecting: '재접속 중', offline: '연결 끊김' }; // 표시 문구
    $('conn-status').dataset.state = stateName; // 색상 상태
    $('conn-status').textContent = labels[stateName]; // 문구
}

function setSaveStatus(stateName)
{
    const labels = { idle: '대기', saving: '저장 중…', saved: '저장됨', failed: '저장 실패' }; // 표시 문구
    $('save-status').dataset.state = stateName; // 색상 상태
    $('save-status').textContent = labels[stateName]; // 문구
}

function canEdit()
{
    return state.project !== null && (state.project.role === 'editor' || state.project.role === 'admin'); // 편집 가능 역할
}

// ---------- 입장 ----------

async function bootstrap()
{
    try
    {
        const me = await window.api.get('/api/me'); // 기존 세션 확인
        state.guest = me.guest; // 게스트 저장
        state.project = me.projects[0] ?? null; // 첫 프로젝트 선택(MVP: 초대 코드당 프로젝트 1개)
        if (state.project)
        {
            return openBoards(); // 보드 선택 화면
        }
    }
    catch (err)
    {
        // 세션 없음 → 입장 화면
    }
    showView('join'); // 입장 화면
    $('join-name').focus(); // 이름 입력 포커스
}

$('join-form').addEventListener('submit', async (e) =>
{
    e.preventDefault(); // 기본 제출 방지
    $('join-error').textContent = ''; // 오류 초기화
    try
    {
        await window.api.post('/api/guest/join', { display_name: $('join-name').value.trim(), invite_code: $('join-code').value.trim() }); // 게스트 입장
        $('join-code').value = ''; // 코드 입력 비움
        await bootstrap(); // 세션 기준으로 다시 진입
    }
    catch (err)
    {
        $('join-error').textContent = err.message; // 오류 표시
    }
});

// ---------- 보드 선택 ----------

async function openBoards()
{
    showView('boards'); // 보드 선택 화면
    $('boards-project-title').textContent = state.project.title; // 프로젝트 이름
    $('boards-guest-name').textContent = state.guest.display_name; // 게스트 이름
    $('boards-role').textContent = { admin: '관리자', editor: '편집자', viewer: '열람자' }[state.project.role] ?? state.project.role; // 역할 표시
    $('board-create-form').hidden = !canEdit(); // 열람자는 생성 불가
    $('boards-error').textContent = ''; // 오류 초기화
    try
    {
        const data = await window.api.get('/api/projects/' + state.project.project_id + '/boards'); // 보드 목록 조회
        state.boards = data.boards; // 목록 저장
        renderBoardList(); // 목록 표시
    }
    catch (err)
    {
        $('boards-error').textContent = err.message; // 오류 표시
    }
}

function renderBoardList()
{
    const ul = $('boards-list'); // 목록 요소
    ul.innerHTML = ''; // 초기화
    if (state.boards.length === 0)
    {
        ul.innerHTML = '<li class="empty">아직 보드가 없습니다.</li>'; // 빈 안내
        return;
    }
    for (const b of state.boards)
    {
        const li = document.createElement('li'); // 항목
        const btn = document.createElement('button'); // 버튼
        btn.type = 'button'; // 제출 방지
        btn.textContent = b.title; // 보드 이름
        btn.addEventListener('click', () => openBoard(b)); // 보드 열기
        li.appendChild(btn); // 버튼 추가
        ul.appendChild(li); // 항목 추가
    }
}

$('board-create-form').addEventListener('submit', async (e) =>
{
    e.preventDefault(); // 기본 제출 방지
    try
    {
        const data = await window.api.post('/api/projects/' + state.project.project_id + '/boards', { title: $('board-create-title').value.trim() }); // 보드 생성
        state.boards.push(data.board); // 목록 추가
        $('board-create-title').value = ''; // 입력 비움
        renderBoardList(); // 목록 갱신
    }
    catch (err)
    {
        $('boards-error').textContent = err.message; // 오류 표시
    }
});

$('boards-leave').addEventListener('click', async () =>
{
    try
    {
        await window.api.post('/api/guest/leave'); // 세션 종료
    }
    catch (err)
    {
        // 이미 만료된 세션이어도 입장 화면으로 이동
    }
    state.guest = null; // 게스트 비움
    state.project = null; // 프로젝트 비움
    showView('join'); // 입장 화면
});

// ---------- 화이트보드 ----------

async function openBoard(board)
{
    state.board = board; // 현재 보드
    state.pendingSaves = 0; // 저장 대기 초기화
    showView('board'); // 보드 화면
    setConnection('offline'); // 연결 전
    setSaveStatus('idle'); // 저장 상태 초기화
    renderBoardSwitch(); // 보드 전환 목록
    renderParticipants([]); // 참여자 초기화
    applyRole(); // 역할에 따른 UI
    if (!canvas)
    {
        canvas = new BoardCanvas($('board-canvas')); // 캔버스 생성
        attachTools(canvas, toolHandlers); // 입력 연결
    }
    canvas.setObjects([]); // 화면 비움
    try
    {
        await loadSnapshot(); // 저장 상태 복원
        await Realtime.loadClient(window.TC_CONFIG.realtimeUrl); // Socket.IO 클라이언트 로드
        if (!realtime)
        {
            realtime = new Realtime(window.TC_CONFIG.realtimeUrl, realtimeHandlers); // 실시간 연결 관리자
        }
        realtime.join(board.board_id); // 보드 참여
    }
    catch (err)
    {
        toast(err.message, 5000); // 오류 안내
        setConnection('offline'); // 연결 실패
    }
}

async function loadSnapshot()
{
    const snapshot = await window.api.get('/api/boards/' + state.board.board_id + '/snapshot'); // 저장 완료 객체 조회
    if (state.board && snapshot.board_id === state.board.board_id)
    {
        canvas.setObjects(snapshot.objects); // 캔버스 복원
        if (canvas.objects.length > 0 && canvas.view.scale === 1 && canvas.view.x === 0 && canvas.view.y === 0)
        {
            canvas.fitAll(); // 첫 진입 시 전체 보기
        }
    }
}

function renderBoardSwitch()
{
    const select = $('board-switch'); // 전환 목록
    select.innerHTML = ''; // 초기화
    for (const b of state.boards)
    {
        const opt = document.createElement('option'); // 항목
        opt.value = String(b.board_id); // 보드 ID
        opt.textContent = state.project.title + ' / ' + b.title; // 표시 이름
        opt.selected = b.board_id === state.board.board_id; // 현재 보드 선택
        select.appendChild(opt); // 추가
    }
}

$('board-switch').addEventListener('change', (e) =>
{
    const target = state.boards.find((b) => String(b.board_id) === e.target.value); // 선택 보드
    if (target && target.board_id !== state.board.board_id)
    {
        openBoard(target); // 보드 전환(이전 연결은 join 에서 정리)
    }
});

$('board-back').addEventListener('click', () =>
{
    if (realtime)
    {
        realtime.leave(); // 연결 종료
    }
    state.board = null; // 보드 비움
    openBoards(); // 보드 선택 화면
});

function renderParticipants(list)
{
    const ul = $('participants'); // 참여자 목록 요소
    ul.innerHTML = ''; // 초기화
    for (const p of list)
    {
        const li = document.createElement('li'); // 항목
        const dot = document.createElement('span'); // 색상 점
        dot.className = 'dot'; // 스타일
        dot.style.background = p.color; // 참여자 색
        li.appendChild(dot); // 점 추가
        li.appendChild(document.createTextNode(p.display_name + (state.guest && p.guest_id === state.guest.guest_id ? ' (나)' : ''))); // 이름
        ul.appendChild(li); // 항목 추가
    }
    if (canvas)
    {
        canvas.removeCursorsExcept(list.map((p) => p.guest_id)); // 퇴장자 커서 제거
    }
}

function applyRole()
{
    const editable = canEdit(); // 편집 가능 여부
    for (const btn of document.querySelectorAll('#toolbar [data-tool]'))
    {
        btn.disabled = !editable && btn.dataset.tool !== 'pan'; // 열람자는 이동만 가능
    }
    if (!editable)
    {
        setTool('pan'); // 이동 도구 고정
    }
    $('board-canvas').classList.toggle('viewer', !editable); // 커서 모양
    $('props-role-note').textContent = editable ? '편집자: 펜·도형을 그리면 마우스를 놓는 순간 저장됩니다.' : '열람자: 보드를 볼 수만 있습니다.'; // 안내 문구
}

function setTool(tool)
{
    state.tool = tool; // 도구 저장
    for (const btn of document.querySelectorAll('#toolbar [data-tool]'))
    {
        btn.classList.toggle('active', btn.dataset.tool === tool); // 활성 표시
    }
    $('board-canvas').classList.toggle('pan', tool === 'pan'); // 커서 모양
}

for (const btn of document.querySelectorAll('#toolbar [data-tool]'))
{
    btn.addEventListener('click', () => setTool(btn.dataset.tool)); // 도구 버튼
}
$('fit-view').addEventListener('click', () => canvas && canvas.fitAll()); // 화면 맞춤

$('prop-color').addEventListener('input', (e) => { state.style.color = e.target.value; }); // 색상 변경
$('prop-width').addEventListener('input', (e) =>
{
    state.style.width = Number(e.target.value); // 굵기 변경
    $('prop-width-out').value = e.target.value; // 표시 갱신
});
$('prop-fill-on').addEventListener('change', (e) =>
{
    $('prop-fill').disabled = !e.target.checked; // 채우기 색 활성화
    state.style.fill = e.target.checked ? $('prop-fill').value : null; // 채우기 적용
});
$('prop-fill').addEventListener('input', (e) =>
{
    if ($('prop-fill-on').checked)
    {
        state.style.fill = e.target.value; // 채우기 색 변경
    }
});

// ---------- 도구 → 실시간 이벤트 ----------

function nextRequestId()
{
    state.requestSeq += 1; // 일련번호 증가
    return 'req-' + Date.now().toString(36) + '-' + state.requestSeq; // 요청 ID
}

async function commit(event, data, draft)
{
    const requestId = nextRequestId(); // 요청 ID
    canvas.pending.set(requestId, draft); // 저장 대기 표시
    state.pendingSaves += 1; // 대기 수 증가
    setSaveStatus('saving'); // 저장 중 표시
    try
    {
        const reply = await realtime.request(event, { ...data, board_id: state.board.board_id, request_id: requestId }); // 서버 확정 요청
        canvas.pending.delete(requestId); // 대기 해제
        canvas.addObject(reply.object ?? { ...draft, object_id: reply.object_id, version: reply.new_version }); // 확정 객체 반영
        state.pendingSaves -= 1; // 대기 수 감소
        if (state.pendingSaves === 0)
        {
            setSaveStatus('saved'); // 모두 저장됨
        }
    }
    catch (err)
    {
        canvas.pending.delete(requestId); // 대기 해제(초안 폐기)
        canvas.invalidate(); // 다시 그리기
        state.pendingSaves -= 1; // 대기 수 감소
        setSaveStatus('failed'); // 저장 실패 표시
        toast('저장 실패: ' + err.message, 4000); // 안내
    }
}

const toolHandlers = {
    getState: () => ({ tool: state.tool, style: state.style, canEdit: canEdit() && realtime && realtime.joined }), // 도구에 전달할 상태
    onToolShortcut: (tool) => { if (canEdit()) { setTool(tool); } }, // 단축키
    onCursor: (x, y) => realtime && realtime.emit('cursor:move', { board_id: state.board.board_id, x, y }), // 커서 공유
    onStrokePreview: (strokeId, delta, style) => realtime && realtime.emit('stroke:preview', { board_id: state.board.board_id, stroke_id: strokeId, points_delta: delta, style }), // 미리보기 전송
    onStrokeCommit: (draft) =>
    {
        const box = strokeBounds(draft.payload.points); // 경계 계산
        commit('stroke:commit', { stroke_id: draft.payload.stroke_id, points: draft.payload.points, style: draft.style }, { ...draft, ...box }); // 획 저장
    },
    onShapeCreate: (draft) => commit('object:create', { type: draft.type, x: draft.x, y: draft.y, width: draft.width, height: draft.height, style: draft.style }, draft), // 도형 저장
}; // 도구 콜백

function strokeBounds(points)
{
    let minX = Infinity; // 최소 X
    let minY = Infinity; // 최소 Y
    let maxX = -Infinity; // 최대 X
    let maxY = -Infinity; // 최대 Y
    for (const [x, y] of points)
    {
        minX = Math.min(minX, x); // 최소 X 갱신
        minY = Math.min(minY, y); // 최소 Y 갱신
        maxX = Math.max(maxX, x); // 최대 X 갱신
        maxY = Math.max(maxY, y); // 최대 Y 갱신
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }; // 경계 사각형
}

// ---------- 실시간 서버 → 화면 ----------

const realtimeHandlers = {
    getTicket: async (boardId) =>
    {
        const data = await window.api.post('/api/realtime-ticket', { board_id: boardId }); // 티켓 발급
        return data.ticket; // 티켓 원문
    },
    onStatus: (name) => setConnection(name), // 연결 상태
    onJoined: async (reply, rejoined) =>
    {
        renderParticipants(reply.participants); // 참여자 표시
        if (rejoined)
        {
            await loadSnapshot(); // 재접속 시 서버의 마지막 저장 상태로 복원
            toast('재접속되었습니다. 마지막 저장 상태를 불러왔습니다.'); // 안내
        }
    },
    onJoinError: (err) =>
    {
        if (err instanceof window.api.ApiError && err.status === 401)
        {
            realtime.leave(); // 연결 정리
            showView('join'); // 세션 만료 → 입장 화면
            $('join-error').textContent = '세션이 만료되었습니다. 다시 입장해 주세요.'; // 안내
            return;
        }
        toast('보드 참여 실패: ' + err.message, 5000); // 안내
    },
    onPresence: (participants) => renderParticipants(participants), // 참여자 갱신
    onCursor: (data) => canvas.setCursor(data), // 타인 커서
    onStrokePreview: (data) => canvas.applyPreview(data), // 타인 미리보기
    onObjectCreated: (object) => canvas.addObject(object), // 타인 확정 객체
}; // 실시간 콜백

bootstrap(); // 시작
