// 화면 전환과 상태 관리: 입장 → 보드 선택 → 화이트보드(스냅샷 복원 + 실시간 연동 + 선택·이동·삭제)
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
    tasks: new Map(), // 공유 업무 원본 task_id → task
    members: [], // 프로젝트 참여자(담당자 선택용)
    snap: false, // 격자 맞춤
}; // 전역 상태

const $ = (id) => document.getElementById(id); // 요소 조회 단축
let canvas = null; // BoardCanvas
let realtime = null; // Realtime
let overlay = null; // VideoOverlay
let move = null; // 진행 중인 객체 이동 {object, start, dx, dy, token, armed, finished, lastPreviewAt}

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

function boardId()
{
    return state.board ? state.board.board_id : null; // 현재 보드 ID
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
    cancelMove(); // 진행 중 이동 취소
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
        overlay = new VideoOverlay($('overlay')); // 영상 iframe 오버레이
        canvas.afterRender = () => overlay.sync(canvas); // 렌더마다 iframe 위치 동기화
        attachMediaInputs(); // 이미지·영상 입력 연결
        canvas.tasks = state.tasks; // 업무 블럭 렌더링용 공유 Map
        attachTaskInputs(); // 업무 블럭 입력 연결
        attachLinkInputs(); // 연결선 입력 연결
    }
    canvas.reset(); // 화면 비움
    updateSelectionInfo(); // 선택 안내 초기화
    try
    {
        await loadSnapshot(); // 저장 상태 복원
        await loadProjectData(); // 참여자·공유 업무 목록
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
        canvas.setLinks(snapshot.links ?? []); // 연결선 복원
        if (canvas.objects.length > 0 && canvas.view.scale === 1 && canvas.view.x === 0 && canvas.view.y === 0)
        {
            canvas.fitAll(); // 첫 진입 시 전체 보기
        }
        updateSelectionInfo(); // 선택 안내 갱신
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
    cancelMove(); // 진행 중 이동 취소
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
    $('tool-image').disabled = !editable; // 열람자는 이미지 추가 불가
    $('tool-video').disabled = !editable; // 열람자는 영상 추가 불가
    $('tool-task').disabled = !editable; // 열람자는 업무 블럭 추가 불가
    $('task-save').disabled = !editable; // 열람자는 업무 수정 불가
    $('props-role-note').textContent = editable ? '편집자: 그리거나 옮기면 마우스를 놓는 순간 저장됩니다.' : '열람자: 보드를 볼 수만 있습니다.'; // 안내 문구
}

function setTool(tool)
{
    state.tool = tool; // 도구 저장
    for (const btn of document.querySelectorAll('#toolbar [data-tool]'))
    {
        btn.classList.toggle('active', btn.dataset.tool === tool); // 활성 표시
    }
    $('board-canvas').classList.toggle('pan', tool === 'pan'); // 손 모양 커서
    $('board-canvas').classList.toggle('select', tool === 'select'); // 화살표 커서
    $('board-canvas').classList.toggle('link', tool === 'link'); // 연결선 커서
}

for (const btn of document.querySelectorAll('#toolbar [data-tool]'))
{
    btn.addEventListener('click', () => setTool(btn.dataset.tool)); // 도구 버튼
}
$('fit-view').addEventListener('click', () => canvas && canvas.fitAll()); // 화면 맞춤

$('prop-color').addEventListener('input', (e) => { state.style.color = e.target.value; }); // 색상 변경
$('prop-color').addEventListener('change', () => restyleSelected()); // 선택 객체에 색상 적용
$('prop-width').addEventListener('input', (e) =>
{
    state.style.width = Number(e.target.value); // 굵기 변경
    $('prop-width-out').value = e.target.value; // 표시 갱신
});
$('prop-width').addEventListener('change', () => restyleSelected()); // 선택 객체에 굵기 적용
$('prop-fill-on').addEventListener('change', (e) =>
{
    $('prop-fill').disabled = !e.target.checked; // 채우기 색 활성화
    state.style.fill = e.target.checked ? $('prop-fill').value : null; // 채우기 적용
    restyleSelected(); // 선택 객체에 채우기 적용
});
$('prop-fill').addEventListener('input', (e) =>
{
    if ($('prop-fill-on').checked)
    {
        state.style.fill = e.target.value; // 채우기 색 변경
    }
});
$('prop-fill').addEventListener('change', () => restyleSelected()); // 선택 객체에 채우기 색 적용

// ---------- 선택·이동·삭제 (다중 선택, 연결선 선택) ----------

function selectedObjects()
{
    return [...canvas.selectedIds].map((id) => canvas.findObject(id)).filter(Boolean); // 선택된 객체 목록
}

function updateSelectionInfo()
{
    const names = { stroke: '펜 획', rect: '사각형', ellipse: '원', image: '이미지', video: '영상', task: '업무 블럭' }; // 유형 이름
    const list = canvas ? selectedObjects() : []; // 선택 객체
    let text = ''; // 안내 문구
    if (list.length === 1)
    {
        text = '선택: ' + (names[list[0].type] ?? list[0].type) + ' #' + list[0].object_id + ' (v' + list[0].version + ') — Delete 키로 삭제'; // 단일 선택
    }
    else if (list.length > 1)
    {
        text = list.length + '개 선택 — 드래그로 함께 이동, Delete 키로 모두 삭제'; // 다중 선택
    }
    else if (canvas && canvas.selectedLinkId !== null)
    {
        text = '연결선 #' + canvas.selectedLinkId + ' 선택 — 라벨 수정 또는 Delete 키로 삭제'; // 연결선 선택
    }
    $('selection-info').textContent = text; // 안내 표시
}

function setSelection(ids, linkId = null)
{
    canvas.selectedIds = new Set(ids); // 객체 선택 집합
    canvas.selectedLinkId = linkId; // 연결선 선택
    canvas.invalidate(); // 다시 그리기
    updateSelectionInfo(); // 안내 갱신
    refreshTaskProps(); // 업무 패널 갱신
    refreshLinkProps(); // 연결선 패널 갱신
}

function selectObject(id)
{
    setSelection(id === null ? [] : [id]); // 단일 선택
}

function toggleSelection(id)
{
    const ids = new Set(canvas.selectedIds); // 현재 선택 복사
    if (ids.has(id))
    {
        ids.delete(id); // 선택 해제
    }
    else
    {
        ids.add(id); // 선택 추가
    }
    setSelection([...ids]); // 적용
}

function lockMessage(err)
{
    if (err.code === 'OBJECT_LOCKED')
    {
        return (err.locked_by ? err.locked_by.display_name : '다른 사용자') + ' 님이 편집 중인 객체입니다.'; // 타인 잠금 안내
    }
    return err.message; // 그 외 오류
}

function releaseTokens(s)
{
    for (const [id, token] of s.tokens)
    {
        realtime.emit('object:unlock', { board_id: boardId(), object_id: id, lock_token: token }); // 보유 잠금 해제
    }
    s.tokens.clear(); // 토큰 비움
}

async function beginMove(objects, w)
{
    const session = { objects, tokens: new Map(), start: w, dx: 0, dy: 0, armed: false, finished: false, lastPreviewAt: 0 }; // 이동 세션(여러 객체)
    move = session; // 현재 세션
    try
    {
        for (const o of objects)
        {
            const reply = await realtime.request('object:lock', { board_id: boardId(), object_id: o.object_id }); // 객체마다 선점 잠금
            session.tokens.set(o.object_id, reply.lock_token); // 토큰 보관
            if (move !== session)
            {
                releaseTokens(session); // 그 사이 취소됨 → 전부 해제
                return;
            }
        }
        session.armed = true; // 모든 잠금 확보 → 이동 허용
        applyMovePreview(session); // 누적 이동 반영
        if (session.finished)
        {
            finishMove(session); // 잠금 전에 놓았으면 바로 마무리
        }
    }
    catch (err)
    {
        releaseTokens(session); // 하나라도 실패하면 이미 얻은 잠금 해제(전체 취소)
        if (move === session)
        {
            move = null; // 세션 종료
        }
        toast(lockMessage(err) + (objects.length > 1 ? ' 전체 이동을 취소했습니다.' : '')); // 안내
    }
}

function applyMovePreview(s)
{
    for (const o of s.objects)
    {
        canvas.moves.set(o.object_id, { x: o.x + s.dx, y: o.y + s.dy }); // 로컬 미리보기
    }
    canvas.invalidate(); // 다시 그리기
    const now = Date.now(); // 현재 시각
    if (now - s.lastPreviewAt >= window.TC_CONFIG.cursorIntervalMs)
    {
        s.lastPreviewAt = now; // 전송 시각 갱신
        for (const o of s.objects)
        {
            realtime.emit('object:preview', { board_id: boardId(), object_id: o.object_id, lock_token: s.tokens.get(o.object_id), x: o.x + s.dx, y: o.y + s.dy }); // 이동 중 위치 공유
        }
    }
}

function updateMove(w)
{
    if (!move)
    {
        return;
    }
    move.dx = w.x - move.start.x; // 누적 이동 X
    move.dy = w.y - move.start.y; // 누적 이동 Y
    if (move.armed)
    {
        applyMovePreview(move); // 잠금 확보 후에만 표시·전송
    }
}

function endMove()
{
    if (!move)
    {
        return;
    }
    if (!move.armed)
    {
        move.finished = true; // 잠금 응답 후 마무리
        return;
    }
    finishMove(move); // 이동 확정
}

async function finishMove(s)
{
    move = null; // 세션 종료
    if (Math.hypot(s.dx, s.dy) < 0.5)
    {
        for (const o of s.objects)
        {
            canvas.moves.delete(o.object_id); // 미리보기 제거
        }
        canvas.invalidate(); // 다시 그리기
        releaseTokens(s); // 변경 없음 → 잠금 해제
        return;
    }
    await Promise.all(s.objects.map((o) =>
    {
        const targetX = state.snap ? Math.round((o.x + s.dx) / 10) * 10 : o.x + s.dx; // 이동 후 X(격자 맞춤 반영)
        const targetY = state.snap ? Math.round((o.y + s.dy) / 10) * 10 : o.y + s.dy; // 이동 후 Y
        return commitObject(o, s.tokens.get(o.object_id), { x: targetX, y: targetY }); // 객체마다 이동 저장
    })); // 선택한 객체 전부 확정
}

function cancelMove()
{
    if (!move)
    {
        return;
    }
    const s = move; // 취소할 세션
    move = null; // 세션 종료
    for (const o of s.objects)
    {
        canvas.moves.delete(o.object_id); // 미리보기 제거
    }
    canvas.invalidate(); // 다시 그리기
    if (realtime)
    {
        releaseTokens(s); // 잠금 해제
    }
}

async function commitObject(object, token, changes)
{
    state.pendingSaves += 1; // 대기 수 증가
    setSaveStatus('saving'); // 저장 중 표시
    try
    {
        const reply = await realtime.request('object:commit', { board_id: boardId(), object_id: object.object_id, lock_token: token, version: object.version, changes, request_id: nextRequestId() }); // 변경 확정 요청
        canvas.updateObject(reply.object); // 확정 결과 반영(미리보기 제거)
        updateSelectionInfo(); // 버전 표시 갱신
        state.pendingSaves -= 1; // 대기 수 감소
        if (state.pendingSaves === 0)
        {
            setSaveStatus('saved'); // 모두 저장됨
        }
    }
    catch (err)
    {
        state.pendingSaves -= 1; // 대기 수 감소
        canvas.moves.delete(object.object_id); // 미리보기 제거
        canvas.invalidate(); // 다시 그리기
        setSaveStatus('failed'); // 저장 실패 표시
        toast(err.code === 'VERSION_CONFLICT' ? err.message : '저장 실패: ' + err.message, 4000); // 안내
        if (err.code === 'VERSION_CONFLICT' || err.code === 'NOT_FOUND')
        {
            await loadSnapshot(); // 최신 저장 상태 재동기화
        }
    }
}

async function withLock(object, action)
{
    const reply = await realtime.request('object:lock', { board_id: boardId(), object_id: object.object_id }); // 잠금 획득
    try
    {
        return await action(reply.lock_token); // 잠금 상태에서 작업
    }
    catch (err)
    {
        realtime.emit('object:unlock', { board_id: boardId(), object_id: object.object_id, lock_token: reply.lock_token }); // 실패 시 해제(이미 해제되어도 무해)
        throw err;
    }
}

async function deleteSelected()
{
    if (!canEdit() || move || !realtime || !realtime.joined)
    {
        return; // 권한 없음·이동 중·미연결
    }
    if (canvas.selectedIds.size === 0 && canvas.selectedLinkId !== null)
    {
        return deleteLink(canvas.selectedLinkId); // 연결선만 선택된 경우
    }
    const list = selectedObjects(); // 삭제 대상
    if (list.length === 0)
    {
        return;
    }
    const lockedByOther = list.find((o) => canvas.locks.has(o.object_id)); // 타인 잠금 객체
    if (lockedByOther)
    {
        return toast(canvas.locks.get(lockedByOther.object_id).display_name + ' 님이 편집 중인 객체가 포함되어 있습니다.'); // 안내
    }
    for (const object of list)
    {
        state.pendingSaves += 1; // 대기 수 증가
        setSaveStatus('saving'); // 저장 중 표시
        try
        {
            await withLock(object, (token) => realtime.request('object:delete', { board_id: boardId(), object_id: object.object_id, lock_token: token, version: object.version, request_id: nextRequestId() })); // 잠금 후 삭제
            canvas.removeObject(object.object_id); // 화면에서 제거(연결선 포함)
            state.pendingSaves -= 1; // 대기 수 감소
            if (state.pendingSaves === 0)
            {
                setSaveStatus('saved'); // 모두 저장됨
            }
        }
        catch (err)
        {
            state.pendingSaves -= 1; // 대기 수 감소
            setSaveStatus('failed'); // 실패 표시
            toast(lockMessage(err), 4000); // 안내
            if (err.code === 'VERSION_CONFLICT' || err.code === 'NOT_FOUND')
            {
                await loadSnapshot(); // 최신 저장 상태 재동기화
            }
        }
    }
    setSelection([]); // 선택 해제
}

async function restyleSelected()
{
    const list = selectedObjects().filter((o) => o.type === 'stroke' || o.type === 'rect' || o.type === 'ellipse'); // 스타일이 있는 객체만
    if (list.length === 0 || !canEdit() || move || !realtime || !realtime.joined)
    {
        return; // 적용 대상 없음
    }
    for (const object of list)
    {
        if (canvas.locks.has(object.object_id))
        {
            toast(canvas.locks.get(object.object_id).display_name + ' 님이 편집 중인 객체입니다.'); // 타인 잠금
            continue;
        }
        const style = object.type === 'stroke'
            ? { color: state.style.color, width: state.style.width } // 획 스타일
            : { stroke: state.style.color, fill: state.style.fill, width: state.style.width }; // 도형 스타일
        try
        {
            await withLock(object, (token) => commitObject(object, token, { style })); // 잠금 후 스타일 저장
        }
        catch (err)
        {
            toast(lockMessage(err)); // 잠금 실패 안내
        }
    }
}

// ---------- 연결선 (P1) ----------

function refreshLinkProps()
{
    const link = canvas && canvas.selectedLinkId !== null ? canvas.links.find((l) => l.link_id === canvas.selectedLinkId) : null; // 선택한 연결선
    $('link-props').hidden = !link; // 연결선 패널 표시 여부
    if (link)
    {
        $('link-label').value = link.label ?? ''; // 라벨 표시
    }
}

async function createLink(from, to)
{
    if (!canEdit() || !realtime || !realtime.joined)
    {
        return toast('지금은 연결선을 추가할 수 없습니다.'); // 권한·연결 확인
    }
    try
    {
        const reply = await realtime.request('link:create', { board_id: boardId(), from_object_id: from.object_id, to_object_id: to.object_id, label: '', request_id: nextRequestId() }); // 연결선 생성
        canvas.addLink(reply.link); // 화면에 추가
        setSelection([], reply.link.link_id); // 새 연결선 선택(라벨 입력 유도)
        $('link-label').focus(); // 라벨 입력 포커스
    }
    catch (err)
    {
        toast('연결선 생성 실패: ' + err.message, 4000); // 안내
    }
}

async function saveLinkLabel()
{
    const linkId = canvas.selectedLinkId; // 선택한 연결선
    if (linkId === null || !canEdit() || !realtime || !realtime.joined)
    {
        return;
    }
    try
    {
        const reply = await realtime.request('link:update', { board_id: boardId(), link_id: linkId, label: $('link-label').value.trim(), request_id: nextRequestId() }); // 라벨 저장
        canvas.updateLink(reply.link); // 반영
        toast('연결선 라벨을 저장했습니다.'); // 안내
    }
    catch (err)
    {
        toast('라벨 저장 실패: ' + err.message, 4000); // 안내
    }
}

async function deleteLink(linkId)
{
    if (!canEdit() || !realtime || !realtime.joined)
    {
        return;
    }
    try
    {
        await realtime.request('link:delete', { board_id: boardId(), link_id: linkId, request_id: nextRequestId() }); // 연결선 삭제
        canvas.removeLink(linkId); // 화면에서 제거
        setSelection([]); // 선택 해제
    }
    catch (err)
    {
        toast('연결선 삭제 실패: ' + err.message, 4000); // 안내
    }
}

function attachLinkInputs()
{
    $('link-save').addEventListener('click', saveLinkLabel); // 라벨 저장
    $('link-delete').addEventListener('click', () => { if (canvas.selectedLinkId !== null) { deleteLink(canvas.selectedLinkId); } }); // 삭제
}

// ---------- 이미지·영상 ----------

function viewCenterWorld()
{
    return canvas.toWorld(canvas.el.width / canvas.dpr / 2, canvas.el.height / canvas.dpr / 2); // 화면 중앙의 월드 좌표
}

async function insertImages(files, world)
{
    if (!canEdit() || !realtime || !realtime.joined)
    {
        return toast('지금은 이미지를 추가할 수 없습니다.'); // 권한·연결 확인
    }
    let offset = 0; // 여러 장일 때 겹침 방지 간격
    for (const file of files)
    {
        const problem = Media.checkFile(file); // 형식·크기 사전 검사
        if (problem)
        {
            toast(problem, 4000); // 거부 안내
            continue;
        }
        setSaveStatus('saving'); // 업로드 중 표시
        try
        {
            const asset = await Media.upload(state.project.project_id, file); // 서버 업로드(내용 검사 포함)
            const size = Media.fitSize(asset.width, asset.height); // 삽입 크기
            const draft = { type: 'image', x: world.x - size.width / 2 + offset, y: world.y - size.height / 2 + offset, width: size.width, height: size.height, payload: { asset_id: asset.asset_id, url: asset.url }, style: {} }; // 이미지 객체 초안
            offset += 24; // 다음 장 위치
            await createObject('object:create', { type: 'image', x: draft.x, y: draft.y, width: draft.width, height: draft.height, payload: { asset_id: asset.asset_id } }, draft); // 보드 객체로 저장
        }
        catch (err)
        {
            setSaveStatus('failed'); // 실패 표시
            toast('이미지 업로드 실패: ' + err.message, 4000); // 안내
        }
    }
}

function attachMediaInputs()
{
    const stage = document.querySelector('.stage'); // 캔버스 영역
    $('tool-image').addEventListener('click', () => $('image-input').click()); // 파일 선택 열기
    $('image-input').addEventListener('change', (e) =>
    {
        insertImages([...e.target.files], viewCenterWorld()); // 선택한 파일 삽입(화면 중앙)
        e.target.value = ''; // 같은 파일 재선택 허용
    });

    stage.addEventListener('dragover', (e) =>
    {
        if (e.dataTransfer && [...e.dataTransfer.types].includes('Files'))
        {
            e.preventDefault(); // 드롭 허용
            stage.classList.add('dragging'); // 테두리 표시
            $('drop-hint').hidden = false; // 안내 표시
        }
    });
    stage.addEventListener('dragleave', (e) =>
    {
        if (!stage.contains(e.relatedTarget))
        {
            stage.classList.remove('dragging'); // 테두리 해제
            $('drop-hint').hidden = true; // 안내 숨김
        }
    });
    stage.addEventListener('drop', (e) =>
    {
        e.preventDefault(); // 브라우저 기본 열기 방지
        stage.classList.remove('dragging'); // 테두리 해제
        $('drop-hint').hidden = true; // 안내 숨김
        const rect = canvas.el.getBoundingClientRect(); // 캔버스 위치
        const files = [...(e.dataTransfer ? e.dataTransfer.files : [])].filter((f) => f.type.startsWith('image/')); // 이미지 파일만
        if (files.length > 0)
        {
            insertImages(files, canvas.toWorld(e.clientX - rect.left, e.clientY - rect.top)); // 놓은 위치에 삽입
        }
    });

    window.addEventListener('paste', (e) =>
    {
        if ($('view-board').hidden || !e.clipboardData)
        {
            return; // 보드 화면이 아닐 때 무시
        }
        const files = [...e.clipboardData.items].filter((item) => item.kind === 'file' && item.type.startsWith('image/')).map((item) => item.getAsFile()).filter(Boolean); // 클립보드 이미지
        if (files.length > 0)
        {
            e.preventDefault(); // 기본 붙여넣기 방지
            insertImages(files, viewCenterWorld()); // 화면 중앙에 삽입
        }
    });

    $('tool-video').addEventListener('click', () =>
    {
        $('video-url').value = ''; // 입력 초기화
        $('video-error').textContent = ''; // 오류 초기화
        $('video-dialog').showModal(); // 대화상자 열기
        $('video-url').focus(); // 입력 포커스
    });
    $('video-cancel').addEventListener('click', () => $('video-dialog').close()); // 취소
    $('video-form').addEventListener('submit', async (e) =>
    {
        e.preventDefault(); // 대화상자 자동 닫힘 방지
        const url = $('video-url').value.trim(); // 입력 URL
        if (!Media.parseVideoUrl(url))
        {
            $('video-error').textContent = 'YouTube 또는 Vimeo 영상 URL 만 추가할 수 있습니다.'; // 사전 검사 안내
            return;
        }
        $('video-dialog').close(); // 대화상자 닫기
        const center = viewCenterWorld(); // 화면 중앙
        const width = Media.VIDEO_WIDTH; // 카드 너비
        const height = Media.VIDEO_HEIGHT + BoardCanvas.VIDEO_BAR; // 카드 높이(막대 포함)
        const draft = { type: 'video', x: center.x - width / 2, y: center.y - height / 2, width, height, payload: { source_url: url }, style: {} }; // 영상 객체 초안
        await createObject('object:create', { type: 'video', x: draft.x, y: draft.y, width, height, payload: { source_url: url } }, draft); // 서버가 URL 검증 후 임베드 URL 생성
    });
}

// ---------- 공유 업무 블럭 (P1) ----------

const TASK_STATUS_LABELS = { todo: '할 일', doing: '진행 중', done: '완료' }; // 상태 이름

async function loadProjectData()
{
    const [members, tasks] = await Promise.all([
        window.api.get('/api/projects/' + state.project.project_id + '/members'), // 참여자 목록
        window.api.get('/api/projects/' + state.project.project_id + '/tasks'), // 공유 업무 목록
    ]); // 병렬 조회
    state.members = members.members; // 참여자 저장
    state.tasks.clear(); // 기존 업무 비움
    for (const t of tasks.tasks)
    {
        state.tasks.set(t.task_id, t); // 업무 등록
    }
    fillAssigneeSelects(); // 담당자 목록 갱신
    canvas.invalidate(); // 업무 블럭 다시 그리기
}

function fillAssigneeSelects()
{
    for (const id of ['task-assignee', 'task-new-assignee'])
    {
        const select = $(id); // 담당자 선택
        const current = select.value; // 기존 선택
        select.innerHTML = '<option value="">없음</option>'; // 초기화
        for (const m of state.members)
        {
            const opt = document.createElement('option'); // 항목
            opt.value = String(m.guest_id); // 게스트 ID
            opt.textContent = m.display_name; // 이름
            select.appendChild(opt); // 추가
        }
        select.value = current; // 기존 선택 유지
    }
}

function selectedTaskObject()
{
    const o = canvas ? canvas.primarySelected() : null; // 하나만 선택한 객체
    return o && o.type === 'task' ? o : null; // 업무 블럭만
}

function refreshTaskProps()
{
    const o = selectedTaskObject(); // 선택한 업무 블럭
    const task = o ? state.tasks.get(o.task_id) : null; // 업무 원본
    $('task-props').hidden = !task; // 업무 패널 표시 여부
    if (!task)
    {
        return;
    }
    $('task-title').value = task.title; // 제목
    $('task-status').value = task.status; // 상태
    $('task-assignee').value = task.assignee_id === null ? '' : String(task.assignee_id); // 담당자
    $('task-due').value = task.due_at ?? ''; // 마감일
}

async function saveTask()
{
    const o = selectedTaskObject(); // 선택한 업무 블럭
    const task = o ? state.tasks.get(o.task_id) : null; // 업무 원본
    if (!task || !canEdit() || !realtime || !realtime.joined)
    {
        return; // 저장 대상 없음
    }
    const changes = {
        title: $('task-title').value.trim(), // 제목
        status: $('task-status').value, // 상태
        assignee_id: $('task-assignee').value === '' ? null : Number($('task-assignee').value), // 담당자
        due_at: $('task-due').value || null, // 마감일
    }; // 변경 내용
    state.pendingSaves += 1; // 대기 수 증가
    setSaveStatus('saving'); // 저장 중 표시
    try
    {
        const reply = await realtime.request('task:update', { board_id: boardId(), task_id: task.task_id, version: task.version, changes, request_id: nextRequestId() }); // 업무 원본 변경(버전 검사)
        state.tasks.set(reply.task.task_id, reply.task); // 최신 업무 반영
        canvas.invalidate(); // 블럭 다시 그리기
        refreshTaskProps(); // 패널 갱신
        state.pendingSaves -= 1; // 대기 수 감소
        if (state.pendingSaves === 0)
        {
            setSaveStatus('saved'); // 모두 저장됨
        }
    }
    catch (err)
    {
        state.pendingSaves -= 1; // 대기 수 감소
        setSaveStatus('failed'); // 실패 표시
        toast(err.message, 4000); // 안내
        if (err.code === 'VERSION_CONFLICT' && err.task)
        {
            state.tasks.set(err.task.task_id, err.task); // 서버의 최신 업무로 교체
            canvas.invalidate(); // 다시 그리기
            refreshTaskProps(); // 패널 갱신
        }
    }
}

function openTaskDialog()
{
    if (!canEdit() || !realtime || !realtime.joined)
    {
        return toast('지금은 업무 블럭을 추가할 수 없습니다.'); // 권한·연결 확인
    }
    const select = $('task-existing'); // 기존 업무 목록
    select.innerHTML = ''; // 초기화
    for (const t of state.tasks.values())
    {
        const opt = document.createElement('option'); // 항목
        opt.value = String(t.task_id); // 업무 ID
        opt.textContent = '#' + t.task_id + ' ' + t.title + ' (' + (TASK_STATUS_LABELS[t.status] ?? t.status) + ')'; // 표시
        select.appendChild(opt); // 추가
    }
    const hasTasks = state.tasks.size > 0; // 기존 업무 유무
    $('task-mode-existing').disabled = !hasTasks; // 없으면 선택 불가
    $('task-mode-existing').checked = hasTasks; // 기본 모드
    $('task-mode-new').checked = !hasTasks; // 없으면 새 업무
    $('task-new-title').value = ''; // 입력 초기화
    $('task-new-status').value = 'todo'; // 상태 초기화
    $('task-new-assignee').value = ''; // 담당자 초기화
    $('task-new-due').value = ''; // 마감일 초기화
    $('task-error').textContent = ''; // 오류 초기화
    fillAssigneeSelects(); // 담당자 목록 갱신
    $('task-dialog').showModal(); // 대화상자 열기
}

async function submitTaskDialog(e)
{
    e.preventDefault(); // 대화상자 자동 닫힘 방지
    let taskId = null; // 참조할 업무
    try
    {
        if ($('task-mode-new').checked)
        {
            const title = $('task-new-title').value.trim(); // 새 업무 제목
            if (title === '')
            {
                $('task-error').textContent = '업무 제목을 입력하세요.'; // 필수값 안내
                return;
            }
            const reply = await realtime.request('task:create', { board_id: boardId(), title, status: $('task-new-status').value, assignee_id: $('task-new-assignee').value === '' ? null : Number($('task-new-assignee').value), due_at: $('task-new-due').value || null, request_id: nextRequestId() }); // 업무 원본 생성
            state.tasks.set(reply.task.task_id, reply.task); // 업무 등록
            taskId = reply.task.task_id; // 새 업무 참조
        }
        else
        {
            taskId = Number($('task-existing').value); // 선택한 업무
            if (!taskId)
            {
                $('task-error').textContent = '업무를 선택하세요.'; // 선택 안내
                return;
            }
        }
    }
    catch (err)
    {
        $('task-error').textContent = err.message; // 생성 실패 안내
        return;
    }
    $('task-dialog').close(); // 대화상자 닫기
    const center = viewCenterWorld(); // 화면 중앙
    const width = 240; // 블럭 너비
    const height = 110; // 블럭 높이
    const draft = { type: 'task', task_id: taskId, x: center.x - width / 2, y: center.y - height / 2, width, height, payload: {}, style: {} }; // 업무 블럭 초안
    await createObject('object:create', { type: 'task', x: draft.x, y: draft.y, width, height, payload: { task_id: taskId } }, draft); // 보드 객체로 저장(블럭마다 object_id 다름, task_id 공유)
}

function attachTaskInputs()
{
    $('tool-task').addEventListener('click', openTaskDialog); // 업무 블럭 버튼
    $('task-cancel').addEventListener('click', () => $('task-dialog').close()); // 취소
    $('task-form').addEventListener('submit', submitTaskDialog); // 추가
    $('task-save').addEventListener('click', saveTask); // 업무 저장
    $('prop-snap').addEventListener('change', (e) => { state.snap = e.target.checked; }); // 격자 맞춤
}

// ---------- 도구 → 실시간 이벤트 ----------

function nextRequestId()
{
    state.requestSeq += 1; // 일련번호 증가
    return 'req-' + Date.now().toString(36) + '-' + state.requestSeq; // 요청 ID
}

async function createObject(event, data, draft)
{
    const requestId = nextRequestId(); // 요청 ID
    canvas.pending.set(requestId, draft); // 저장 대기 표시
    state.pendingSaves += 1; // 대기 수 증가
    setSaveStatus('saving'); // 저장 중 표시
    try
    {
        const reply = await realtime.request(event, { ...data, board_id: boardId(), request_id: requestId }); // 서버 확정 요청
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
    getState: () => ({ tool: state.tool, style: state.style, snap: state.snap, canEdit: canEdit() && realtime && realtime.joined }), // 도구에 전달할 상태(격자 맞춤 포함)
    onToolShortcut: (tool) =>
    {
        if (!canEdit())
        {
            return; // 열람자 무시
        }
        if (tool === 'task')
        {
            openTaskDialog(); // T: 업무 블럭 대화상자
            return;
        }
        setTool(tool); // 도구 전환
    }, // 단축키
    onCursor: (x, y) => realtime && realtime.emit('cursor:move', { board_id: boardId(), x, y }), // 커서 공유
    onStrokePreview: (strokeId, delta, style) => realtime && realtime.emit('stroke:preview', { board_id: boardId(), stroke_id: strokeId, points_delta: delta, style }), // 미리보기 전송
    onStrokeCommit: (draft) =>
    {
        const box = strokeBounds(draft.payload.points); // 경계 계산
        createObject('stroke:commit', { stroke_id: draft.payload.stroke_id, points: draft.payload.points, style: draft.style }, { ...draft, ...box }); // 획 저장
    },
    onShapeCreate: (draft) => createObject('object:create', { type: draft.type, x: draft.x, y: draft.y, width: draft.width, height: draft.height, style: draft.style }, draft), // 도형 저장
    onSelectDown: (hit, w, shift) =>
    {
        if (!hit)
        {
            if (!shift)
            {
                setSelection([]); // 빈 곳 클릭 → 선택 해제(Shift 면 유지)
            }
            return false;
        }
        if (canvas.locks.has(hit.object_id))
        {
            toast(canvas.locks.get(hit.object_id).display_name + ' 님이 편집 중인 객체입니다.'); // 타인 잠금 안내
            return false;
        }
        if (move)
        {
            return false; // 이전 이동 처리 중
        }
        if (shift)
        {
            toggleSelection(hit.object_id); // Shift+클릭: 선택 토글(이동 없음)
            return false;
        }
        const ids = canvas.selectedIds.has(hit.object_id) ? [...canvas.selectedIds] : [hit.object_id]; // 이미 선택된 묶음을 클릭하면 함께 이동
        const objects = ids.map((id) => canvas.findObject(id)).filter(Boolean); // 이동 대상
        const blocked = objects.find((o) => canvas.locks.has(o.object_id)); // 타인 잠금 포함 여부
        if (blocked)
        {
            toast(canvas.locks.get(blocked.object_id).display_name + ' 님이 편집 중인 객체가 포함되어 이동할 수 없습니다.'); // 전체 취소 안내
            return false;
        }
        setSelection(objects.map((o) => o.object_id)); // 선택 확정
        beginMove(objects, w); // 모든 객체 잠금 후 이동 시작
        return true;
    },
    onMarquee: (m, shift) =>
    {
        const inside = canvas.objects.filter((o) =>
        {
            const pos = canvas.displayPosition(o); // 표시 위치
            return pos.x < m.x + m.width && pos.x + o.width > m.x && pos.y < m.y + m.height && pos.y + o.height > m.y; // 영역과 겹치는 객체
        }).map((o) => o.object_id); // 겹치는 객체 ID
        setSelection(shift ? [...new Set([...canvas.selectedIds, ...inside])] : inside); // Shift 면 기존 선택에 추가
    },
    onLinkSelect: (link) => setSelection([], link.link_id), // 연결선 선택
    onLinkCreate: (from, to) => createLink(from, to), // 연결선 생성
    onSelectMove: (w) => updateMove(w), // 이동 중
    onSelectUp: () => endMove(), // 이동 확정
    onEscape: () =>
    {
        cancelMove(); // 이동 취소
        setSelection([]); // 선택 해제
    },
    onDeleteKey: () => deleteSelected(), // 선택 객체 삭제
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
    getTicket: async (id) =>
    {
        const data = await window.api.post('/api/realtime-ticket', { board_id: id }); // 티켓 발급
        return data.ticket; // 티켓 원문
    },
    onStatus: (name) => setConnection(name), // 연결 상태
    onJoined: async (reply, rejoined) =>
    {
        renderParticipants(reply.participants); // 참여자 표시
        if (rejoined)
        {
            cancelMove(); // 끊긴 동안의 이동은 폐기
            await loadSnapshot(); // 재접속 시 서버의 마지막 저장 상태로 복원
            await loadProjectData(); // 참여자·업무 목록도 다시 조회
            toast('재접속되었습니다. 마지막 저장 상태를 불러왔습니다.'); // 안내
        }
        canvas.setLocks(reply.locks); // 현재 잠금 표시
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
    onStrokePreview: (data) => canvas.applyPreview(data), // 타인 펜 미리보기
    onObjectCreated: (object) => canvas.addObject(object), // 타인 확정 객체
    onObjectLocked: (lock) =>
    {
        canvas.locks.set(lock.object_id, lock); // 타인 잠금 표시
        canvas.invalidate(); // 다시 그리기
    },
    onObjectUnlocked: (data) =>
    {
        if (move && move.objects.some((o) => o.object_id === data.object_id) && data.reason === 'expired')
        {
            cancelMove(); // 내 잠금 만료 → 이동 취소
            toast('잠금 시간이 지나 이동이 취소되었습니다.'); // 안내
        }
        canvas.locks.delete(data.object_id); // 잠금 표시 제거
        if (!move || !move.objects.some((o) => o.object_id === data.object_id))
        {
            canvas.moves.delete(data.object_id); // 타인 이동 미리보기 제거
        }
        canvas.invalidate(); // 다시 그리기
    },
    onObjectPreview: (data) =>
    {
        canvas.moves.set(data.object_id, { x: data.x, y: data.y }); // 타인 이동 중 위치
        canvas.invalidate(); // 다시 그리기
    },
    onObjectUpdated: (object) =>
    {
        canvas.updateObject(object); // 타인 변경 반영
        updateSelectionInfo(); // 선택 안내 갱신
    },
    onObjectDeleted: (id) =>
    {
        if (move && move.objects.some((o) => o.object_id === id))
        {
            cancelMove(); // 이동 중이던 객체가 삭제됨
        }
        canvas.removeObject(id); // 화면에서 제거
        updateSelectionInfo(); // 선택 안내 갱신
        refreshTaskProps(); // 업무 패널 갱신
    },
    onTaskCreated: (task) =>
    {
        state.tasks.set(task.task_id, task); // 새 업무 등록
        canvas.invalidate(); // 다시 그리기
    },
    onTaskUpdated: (task) =>
    {
        state.tasks.set(task.task_id, task); // 다른 보드·사용자의 변경 반영
        canvas.invalidate(); // 블럭 다시 그리기
        refreshTaskProps(); // 선택 중이면 패널 갱신
    },
    onLinkCreated: (link) => canvas.addLink(link), // 타인 연결선 생성
    onLinkUpdated: (link) =>
    {
        canvas.updateLink(link); // 라벨 변경 반영
        refreshLinkProps(); // 선택 중이면 패널 갱신
    },
    onLinkDeleted: (id) =>
    {
        const wasSelected = canvas.selectedLinkId === id; // 선택 여부
        canvas.removeLink(id); // 화면에서 제거
        if (wasSelected)
        {
            setSelection([]); // 선택 해제
        }
    },
}; // 실시간 콜백

bootstrap(); // 시작
