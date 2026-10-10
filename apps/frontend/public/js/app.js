// 화면 전환과 상태 관리: 홈(소개 ↔ 입장 후 작업실) → 입장 → 화이트보드(스냅샷 복원 + 실시간 연동 + 선택·이동·삭제)
'use strict';

const state = {
    guest: null, // {guest_id, display_name}
    project: null, // {project_id, title, role}
    boards: [], // 프로젝트 보드 목록
    board: null, // 현재 보드
    tool: 'pen', // 현재 도구
    style: { color: '#222222', width: 3, fill: null, size: 16 }, // 그리기 스타일(size 는 메모·텍스트의 글자 크기)
    pendingSaves: 0, // 저장 응답 대기 수
    requestSeq: 0, // 요청 ID 일련번호
    tasks: new Map(), // 공유 업무 원본 task_id → task
    members: [], // 프로젝트 참여자(담당자 선택용)
    snap: false, // 격자 맞춤
}; // 전역 상태

const $ = (id) => document.getElementById(id); // 요소 조회 단축
let canvas = null; // BoardCanvas
let realtime = null; // Realtime(보드 연결)
let workspaceLink = null; // Realtime(작업실 연결: 업무 현황판용. 보드를 열면 끊고 보드 연결을 씀)
let workspaceOnline = false; // 작업실 연결이 참여까지 끝났는지(끝나야 업무를 바꿀 수 있음)
let taskBoard = null; // TaskBoard(작업실의 업무 현황판)
let workspaceTaskTarget = null; // 업무 대화상자에서 고치는 업무(null 이면 새 업무)
let workspaceChecklist = null; // 업무 대화상자의 체크리스트
let taskDeleteTarget = null; // 삭제 확인 대화상자가 가리키는 업무
let taskChecklist = null; // 보드의 업무 패널에 있는 체크리스트
let shownTaskKey = null; // 업무 패널의 입력란에 채워 둔 업무("번호:버전"). 같은 업무·같은 버전이면 적는 중인 값을 덮어쓰지 않음
let overlay = null; // VideoOverlay
let move = null; // 진행 중인 이동·크기 조절 세션 {kind, objects, tokens, start, dx, dy, corner?, shift?, armed, finished, lastPreviewAt}
let noteEdit = null; // 글을 편집 중인 메모 {object, token, heartbeat, isNew}
let busyOps = 0; // 진행 중인 잠금 요청·확정·삭제 수(다음 잠금 요청이 앞선 작업의 반납보다 먼저 나가지 않게 한다)
let boardDialogTarget = null; // 이름 변경·삭제 대화상자의 대상 보드
let participants = []; // 지금 보드의 참여자 목록(실시간 서버가 알려 준 그대로)
const lastSeen = new Map(); // guest_id → {x, y}: 다른 참여자가 마지막으로 있던 곳(따라가기가 찾아갈 자리)
let sentSelection = ''; // 서버에 마지막으로 알린 내 선택의 서명(같은 내용을 다시 보내지 않기 위함, 빈 문자열: 선택 없음)
let selectionTimer = 0; // 선택 알림 예약 타이머
const follow = { guestId: null, armed: null }; // 계속 따라가는 참여자, 방금 그 사람 자리로 한 번 이동한 참여자(한 번 더 누르면 따라가기 시작)

// 앞선 잠금 요청·확정이 모두 끝날 때까지 기다린다. 같은 객체를 연달아 잠글 때 서버에 도착하는 순서를 보장하기 위함
async function whenIdle()
{
    while (busyOps > 0)
    {
        await new Promise((resolve) => setTimeout(resolve, 15)); // 잠깐 대기 후 다시 확인
    }
}

function showView(name)
{
    for (const v of document.querySelectorAll('.view'))
    {
        v.hidden = v.id !== 'view-' + name; // 해당 화면만 표시
    }
    if (name !== 'board')
    {
        forgetBoard(); // 보드 밖으로 나오면 "보던 보드" 기억을 지움(새로고침하면 지금 화면으로 돌아오게)
    }
}

// ---------- 보던 보드 기억(새로고침 복원) ----------

const RESUME_KEY = 'tc_resume'; // 이 탭에서 보던 보드를 적어 두는 sessionStorage 키(탭마다 따로, 탭을 닫으면 사라짐)

function rememberBoard(boardId, view)
{
    try
    {
        sessionStorage.setItem(RESUME_KEY, JSON.stringify({ board_id: boardId, view: view ? { scale: view.scale, x: view.x, y: view.y } : null })); // 보드와 보던 위치·배율
    }
    catch (err)
    {
        // 저장소를 쓸 수 없는 브라우저 설정이면 기억하지 않음(새로고침하면 작업실로 돌아감)
    }
}

function forgetBoard()
{
    try
    {
        sessionStorage.removeItem(RESUME_KEY); // 기억 삭제
    }
    catch (err)
    {
        // 저장소를 쓸 수 없으면 지울 것도 없음
    }
}

function recallBoard()
{
    try
    {
        const saved = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? 'null'); // 기억해 둔 값
        if (saved && Number.isInteger(saved.board_id))
        {
            const v = saved.view; // 보던 위치·배율
            const valid = !!v && [v.scale, v.x, v.y].every(Number.isFinite) && v.scale >= 0.1 && v.scale <= 8; // 화면에 적용해도 되는 값인지
            return { board_id: saved.board_id, view: valid ? { scale: v.scale, x: v.x, y: v.y } : null }; // 복원 정보
        }
    }
    catch (err)
    {
        // 깨진 값은 무시
    }
    return null; // 기억 없음
}

// 새로고침 전에 보던 보드가 있으면 작업실을 거치지 않고 그 보드로 돌아간다. 없거나 사라졌으면 작업실
async function resumeOrWorkspace()
{
    const remembered = recallBoard(); // 이 탭에서 보던 보드
    if (!remembered)
    {
        return openWorkspace(); // 기억 없음: 작업실
    }
    try
    {
        state.boards = (await window.api.get('/api/projects/' + state.project.project_id + '/boards')).boards; // 보드 목록(상단 전환 목록에도 쓰임)
    }
    catch (err)
    {
        return openWorkspace(); // 목록을 받지 못하면 작업실에서 오류를 보여 줌
    }
    const target = state.boards.find((b) => b.board_id === remembered.board_id); // 보던 보드
    if (!target)
    {
        return openWorkspace(); // 그 사이 삭제되었거나 다른 프로젝트로 입장함
    }
    return openBoard(target, remembered.view); // 보던 위치·배율 그대로 다시 열기
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

// 초대 링크(http://서버:8080/#code=XXXX-XXXX-XXXX)의 코드를 꺼내고 주소창·방문 기록에서 지운다
function takeInviteCodeFromUrl()
{
    const match = /^#code=([A-Za-z0-9-]{4,120})$/.exec(location.hash); // # 뒤의 초대 코드
    if (!match)
    {
        return null; // 초대 링크 아님
    }
    history.replaceState(null, '', location.pathname + location.search); // 주소에서 코드 제거
    return match[1]; // 코드 원문
}

let pendingInviteCode = takeInviteCodeFromUrl(); // 초대 링크로 들어온 코드(입장 화면에 한 번만 채움)
let ownerCode = null; // 방금 만든 작업실의 재입장 코드 {code, days}. 만든 직후에만 받고, 확인하거나 나가면 지움(저장하지 않음)

async function bootstrap()
{
    try
    {
        const me = await window.api.get('/api/me'); // 기존 세션 확인
        state.guest = me.guest; // 게스트 저장
        state.project = me.projects[0] ?? null; // 첫 프로젝트 선택(MVP: 초대 코드당 프로젝트 1개)
        if (state.project)
        {
            pendingInviteCode = null; // 이미 입장한 상태면 링크의 코드는 쓰지 않음
            return resumeOrWorkspace(); // 입장한 상태: 새로고침 전에 보던 보드가 있으면 그 보드, 없으면 홈이 작업실로 구성됨
        }
    }
    catch (err)
    {
        // 세션 없음 → 소개 페이지
    }
    if (pendingInviteCode)
    {
        return showJoin(); // 초대 링크로 들어오면 소개를 건너뛰고 바로 입장 화면
    }
    showIntro(); // 처음 방문: 소개 홈페이지
}

// 홈 화면 구성 전환: 입장 전에는 소개 본문과 "입장하기", 입장 후에는 작업실 본문과 이름·역할·나가기
function setHomeMode(member)
{
    $('home-intro').hidden = member; // 소개 본문
    $('home-workspace').hidden = !member; // 작업실 본문
    $('nav-guest').hidden = member; // 입장하기 버튼
    $('nav-member').hidden = !member; // 이름·역할·나가기
}

function showIntro()
{
    $('home-notice').hidden = true; // 이전 알림은 지움(작업실이 삭제된 직후에만 다시 띄움)
    setHomeMode(false); // 소개 구성
    showView('home'); // 홈 화면
    window.scrollTo(0, 0); // 맨 위부터 표시
}

function showJoin()
{
    $('home-notice').hidden = true; // 소개 화면의 알림은 다른 화면으로 넘어가면 지움
    showView('join'); // 입장 화면
    if (pendingInviteCode)
    {
        $('join-code').value = pendingInviteCode; // 초대 링크의 코드 자동 입력
        $('join-hint').textContent = '초대 링크의 코드가 입력되었습니다. 이름만 입력하고 입장하세요.'; // 안내
        pendingInviteCode = null; // 한 번만 사용
    }
    $('join-name').focus(); // 이름 입력 포커스
}

function showCreate()
{
    $('home-notice').hidden = true; // 소개 화면의 알림은 다른 화면으로 넘어가면 지움
    showView('create'); // 작업실 만들기 화면
    $('create-error').textContent = ''; // 오류 초기화
    $('create-name').focus(); // 이름 입력 포커스
}

$('home-enter-top').addEventListener('click', showJoin); // 상단 "입장하기"
$('home-enter').addEventListener('click', showJoin); // 소개의 "초대 코드로 입장"
$('home-create-top').addEventListener('click', showCreate); // 상단 "작업실 만들기"
$('home-create').addEventListener('click', showCreate); // 소개의 "새 작업실 만들기"
$('join-to-create').addEventListener('click', showCreate); // 입장 화면에서 만들기로
$('create-to-join').addEventListener('click', showJoin); // 만들기 화면에서 입장으로
$('create-back').addEventListener('click', showIntro); // 만들기 화면에서 소개로 돌아가기

$('create-form').addEventListener('submit', async (e) =>
{
    e.preventDefault(); // 기본 제출 방지
    $('create-error').textContent = ''; // 오류 초기화
    try
    {
        const data = await window.api.post('/api/projects', { display_name: $('create-name').value.trim(), title: $('create-title').value.trim() }); // 작업실 만들기(만든 사람이 관리자로 입장한 상태가 됨)
        ownerCode = { code: data.owner_code, days: data.owner_code_days }; // 재입장 코드(이 응답에서만 받음)
        $('create-title').value = ''; // 입력 비움
        await bootstrap(); // 세션 기준으로 다시 진입 → 방금 만든 작업실
    }
    catch (err)
    {
        $('create-error').textContent = err.message; // 오류 표시
    }
});
$('home-more').addEventListener('click', () => $('home-features').scrollIntoView({ behavior: 'smooth' })); // 기능 소개로 스크롤
$('join-back').addEventListener('click', showIntro); // 입장 화면에서 소개로 돌아가기

$('join-form').addEventListener('submit', async (e) =>
{
    e.preventDefault(); // 기본 제출 방지
    $('join-error').textContent = ''; // 오류 초기화
    try
    {
        await window.api.post('/api/guest/join', { display_name: $('join-name').value.trim(), invite_code: $('join-code').value.trim() }); // 게스트 입장
        $('join-code').value = ''; // 코드 입력 비움
        $('join-hint').textContent = ''; // 초대 링크 안내 비움
        await bootstrap(); // 세션 기준으로 다시 진입
    }
    catch (err)
    {
        $('join-error').textContent = err.message; // 오류 표시
    }
});

// ---------- 작업실 (입장 후의 홈) ----------

async function openWorkspace()
{
    setHomeMode(true); // 같은 홈 화면을 작업실 구성으로 전환
    showView('home'); // 홈 화면
    window.scrollTo(0, 0); // 맨 위부터 표시
    $('ws-notice').hidden = true; // 이전 알림 숨김
    $('ws-task-error').textContent = ''; // 현황판 오류 초기화
    setWorkspaceConnection('connecting'); // 아래에서 새로 연결할 때까지 현황판은 보기만(지난번 연결 상태가 화면에 남지 않게 먼저 바꿈)
    $('boards-project-title').textContent = state.project.title; // 프로젝트 이름
    $('boards-guest-name').textContent = state.guest.display_name; // 게스트 이름
    $('boards-role').textContent = ROLE_LABELS[state.project.role] ?? state.project.role; // 역할 표시
    $('ws-summary').textContent = state.guest.display_name + (canEdit() ? ' 님, 보드를 골라 작업을 이어가세요.' : ' 님은 열람자로 입장했습니다. 보드를 열어 볼 수 있습니다.'); // 안내 문구
    $('ws-rename').hidden = state.project.role !== 'admin'; // 작업실 이름 변경은 관리자만
    $('ws-delete').hidden = state.project.role !== 'admin'; // 작업실 삭제도 관리자만(서버도 따로 검사)
    renderOwnerCode(); // 방금 만든 작업실이면 재입장 코드 안내
    $('board-create-form').hidden = !canEdit(); // 열람자는 생성 불가
    $('boards-error').textContent = ''; // 오류 초기화
    const isAdmin = state.project.role === 'admin'; // 관리자 여부
    $('invite-admin').hidden = !isAdmin; // 초대 코드 관리는 관리자에게만 표시(서버도 관리자만 허용)
    $('invite-result').hidden = true; // 이전 발급 결과 숨김
    $('invite-error').textContent = ''; // 오류 초기화
    if (isAdmin)
    {
        loadInvites(); // 초대 목록 조회
    }
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
    try
    {
        await loadProjectData(); // 참여자·공유 업무 조회
        renderWorkspaceInfo(); // 작업실 현황 표시
    }
    catch (err)
    {
        $('boards-error').textContent = err.message; // 오류 표시(보드 목록은 그대로 사용 가능)
    }
    connectWorkspace(); // 업무 현황판용 실시간 연결(기다리지 않음: 연결 전에도 작업실은 쓸 수 있음)
}

// 방금 만든 작업실의 재입장 코드 카드: 확인 버튼을 누르거나 나갈 때까지 작업실에 보인다
function renderOwnerCode()
{
    $('ws-owner').hidden = ownerCode === null; // 만든 직후에만 표시
    if (ownerCode === null)
    {
        return;
    }
    $('ws-owner-name').textContent = state.guest.display_name; // 다시 들어올 때 써야 하는 이름
    $('ws-owner-code').textContent = ownerCode.code; // 코드 원문(서버에는 해시만 있어 다시 볼 수 없음)
    $('ws-owner-note').textContent = '지금만 표시되고 다시 볼 수 없습니다. ' + ownerCode.days + '일 동안 쓸 수 있습니다. 이 코드로는 새 사람이 들어올 수 없으니 팀원에게는 아래 초대 코드 관리에서 따로 발급해 주세요. 코드를 잃어버렸다면 나가기 전에 초대 코드 관리에서 관리자 코드를 새로 발급하세요.'; // 안내
}

$('ws-owner-copy').addEventListener('click', async () =>
{
    const copied = await copyText($('ws-owner-code').textContent); // 클립보드 복사
    $('ws-owner-copy').textContent = copied ? '복사됨' : '복사 실패: 직접 선택해 복사하세요'; // 결과 표시
    setTimeout(() => { $('ws-owner-copy').textContent = '코드 복사'; }, 1500); // 기본 문구 복원
});
$('ws-owner-done').addEventListener('click', () =>
{
    ownerCode = null; // 화면에서 지움
    renderOwnerCode(); // 카드 숨김
});

// ---------- 작업실 삭제 (관리자) ----------

// 작업실이 지워졌을 때(내가 지웠거나, 관리자가 지웠다는 알림을 받았을 때): 연결과 화면 상태를 모두 정리하고 소개 화면으로 돌아간다
function leaveDeletedWorkspace(message)
{
    cancelMove(); // 진행 중 이동 취소
    finishNoteEdit(false); // 메모 편집 취소
    clearUndo(); // 실행 취소 기록 비움
    stopFollow(); // 따라가기 해제
    lastSeen.clear(); // 위치 기억 비움
    if (realtime)
    {
        realtime.leave(); // 보드 연결 종료
    }
    disconnectWorkspace(); // 작업실 연결 종료
    for (const dialog of document.querySelectorAll('dialog[open]'))
    {
        dialog.close(); // 열려 있던 대화상자 닫기
    }
    ownerCode = null; // 재입장 코드는 화면에서 지움
    state.board = null; // 보드 비움
    state.boards = []; // 보드 목록 비움
    state.members = []; // 참여자 비움
    state.tasks.clear(); // 업무 비움
    state.guest = null; // 게스트 비움(서버에서도 세션이 지워짐)
    state.project = null; // 작업실 비움
    showIntro(); // 소개 화면으로
    $('home-notice').textContent = message; // 무슨 일이 있었는지 안내
    $('home-notice').hidden = false; // 알림 표시
}

$('ws-delete').addEventListener('click', () =>
{
    $('project-delete-text').textContent = "'" + state.project.title + "' 작업실을 삭제합니다."; // 확인 문구(textContent 로만 표시)
    $('project-delete-detail').textContent = '보드 ' + state.boards.length + '개, 업무 ' + state.tasks.size + '건, 참여자 ' + state.members.length + '명의 참여 기록, 초대 코드, 올린 이미지가 모두 지워지며 되돌릴 수 없습니다. '
        + '지금 접속해 있는 사람은 소개 화면으로 돌아가고, 이 작업실의 초대 코드와 내 코드로는 다시 들어올 수 없습니다.'; // 지워지는 것
    $('project-delete-confirm').value = ''; // 입력 비움
    $('project-delete-error').textContent = ''; // 오류 초기화
    $('project-delete-submit').disabled = true; // 이름을 맞게 적어야 누를 수 있음
    $('project-delete-dialog').showModal(); // 대화상자 열기
    $('project-delete-confirm').focus(); // 바로 입력할 수 있게
});
$('project-delete-confirm').addEventListener('input', (e) =>
{
    $('project-delete-submit').disabled = !state.project || e.target.value.trim() !== state.project.title; // 작업실 이름과 같을 때만 삭제 버튼을 켬
});
$('project-delete-cancel').addEventListener('click', () => $('project-delete-dialog').close()); // 삭제 취소
$('project-delete-form').addEventListener('submit', async (e) =>
{
    e.preventDefault(); // 대화상자 자동 닫힘 방지
    const typed = $('project-delete-confirm').value.trim(); // 입력한 이름
    if (!state.project || typed !== state.project.title)
    {
        return; // Enter 로 제출해도 이름이 맞아야 함
    }
    try
    {
        const title = state.project.title; // 안내에 쓸 이름
        await window.api.post('/api/projects/' + state.project.project_id + '/delete', { confirm_title: typed }); // 작업실 삭제(관리자만, 서버도 이름을 다시 확인)
        leaveDeletedWorkspace("'" + title + "' 작업실을 삭제했습니다."); // 소개 화면으로
    }
    catch (err)
    {
        $('project-delete-error').textContent = err.message; // 오류 표시
    }
});

$('ws-rename').addEventListener('click', () =>
{
    $('project-rename-title').value = state.project.title; // 현재 이름
    $('project-rename-error').textContent = ''; // 오류 초기화
    $('project-rename-dialog').showModal(); // 대화상자 열기
    $('project-rename-title').select(); // 바로 고칠 수 있게 전체 선택
});
$('project-rename-cancel').addEventListener('click', () => $('project-rename-dialog').close()); // 이름 변경 취소
$('project-rename-form').addEventListener('submit', async (e) =>
{
    e.preventDefault(); // 대화상자 자동 닫힘 방지
    try
    {
        const data = await window.api.post('/api/projects/' + state.project.project_id + '/rename', { title: $('project-rename-title').value.trim() }); // 작업실 이름 변경(관리자만)
        state.project.title = data.project.title; // 새 이름 반영
        $('boards-project-title').textContent = data.project.title; // 작업실 제목
        $('project-rename-dialog').close(); // 닫기
    }
    catch (err)
    {
        $('project-rename-error').textContent = err.message; // 오류 표시
    }
});

function renderBoardList()
{
    const ul = $('boards-list'); // 목록 요소
    ul.innerHTML = ''; // 초기화
    $('ws-board-count').textContent = state.boards.length + '개'; // 보드 수
    if (state.boards.length === 0)
    {
        ul.innerHTML = '<li class="empty">아직 보드가 없습니다.</li>'; // 빈 안내
        return;
    }
    for (const b of state.boards)
    {
        const li = document.createElement('li'); // 항목
        const btn = document.createElement('button'); // 보드 카드
        const title = document.createElement('strong'); // 보드 이름
        const meta = document.createElement('span'); // 만든 날
        const open = document.createElement('span'); // 열기 표시
        btn.type = 'button'; // 제출 방지
        btn.className = 'open-board'; // 카드의 열기 영역
        title.textContent = b.title; // 서버 값은 textContent 로만 표시
        meta.className = 'muted small'; // 보조 글자
        meta.textContent = '만든 날 ' + String(b.created_at).slice(0, 10); // 생성일
        open.className = 'open'; // 강조 색
        open.textContent = '열기 →'; // 안내
        btn.append(title, meta, open); // 카드 구성
        btn.addEventListener('click', () => openBoard(b)); // 보드 열기
        li.appendChild(btn); // 카드 추가
        if (canEdit())
        {
            const actions = document.createElement('div'); // 카드 아래 동작
            const rename = document.createElement('button'); // 이름 변경
            actions.className = 'board-actions'; // 동작 줄
            rename.type = 'button'; // 제출 방지
            rename.className = 'text-link'; // 글자 버튼
            rename.textContent = '이름 변경'; // 문구
            rename.addEventListener('click', () => openBoardRename(b)); // 이름 변경 대화상자
            actions.appendChild(rename); // 추가
            if (state.project.role === 'admin')
            {
                const remove = document.createElement('button'); // 삭제(관리자만)
                remove.type = 'button'; // 제출 방지
                remove.className = 'text-link danger-link'; // 위험 동작 색
                remove.textContent = '삭제'; // 문구
                remove.addEventListener('click', () => openBoardDelete(b)); // 삭제 확인 대화상자
                actions.appendChild(remove); // 추가
            }
            li.appendChild(actions); // 동작 줄 추가
        }
        ul.appendChild(li); // 항목 추가
    }
}

function openBoardRename(board)
{
    boardDialogTarget = board; // 대상 보드
    $('board-rename-title').value = board.title; // 현재 이름
    $('board-rename-error').textContent = ''; // 오류 초기화
    $('board-rename-dialog').showModal(); // 대화상자 열기
    $('board-rename-title').select(); // 바로 고칠 수 있게 전체 선택
}

function openBoardDelete(board)
{
    boardDialogTarget = board; // 대상 보드
    $('board-delete-text').textContent = "'" + board.title + "' 보드를 삭제합니다."; // 확인 문구(textContent 로만 표시)
    $('board-delete-error').textContent = ''; // 오류 초기화
    $('board-delete-dialog').showModal(); // 대화상자 열기
}

function applyBoardTitle(id, title)
{
    const listed = state.boards.find((b) => b.board_id === id); // 목록의 보드
    if (listed)
    {
        listed.title = title; // 목록 이름 갱신
    }
    if (state.board && state.board.board_id === id)
    {
        state.board.title = title; // 열려 있는 보드 이름 갱신
        renderBoardSwitch(); // 상단 보드 전환 목록 갱신
    }
}

$('board-rename-cancel').addEventListener('click', () => $('board-rename-dialog').close()); // 이름 변경 취소
$('board-rename-form').addEventListener('submit', async (e) =>
{
    e.preventDefault(); // 대화상자 자동 닫힘 방지
    if (!boardDialogTarget)
    {
        return;
    }
    try
    {
        const data = await window.api.post('/api/boards/' + boardDialogTarget.board_id + '/rename', { title: $('board-rename-title').value.trim() }); // 이름 변경(편집자 이상)
        applyBoardTitle(data.board.board_id, data.board.title); // 목록 반영
        $('board-rename-dialog').close(); // 닫기
        renderBoardList(); // 카드 갱신
    }
    catch (err)
    {
        $('board-rename-error').textContent = err.message; // 오류 표시
    }
});

$('board-delete-cancel').addEventListener('click', () => $('board-delete-dialog').close()); // 삭제 취소
$('board-delete-form').addEventListener('submit', async (e) =>
{
    e.preventDefault(); // 대화상자 자동 닫힘 방지
    if (!boardDialogTarget)
    {
        return;
    }
    try
    {
        const id = boardDialogTarget.board_id; // 삭제할 보드
        await window.api.post('/api/boards/' + id + '/delete'); // 보드 삭제(관리자만, 되돌릴 수 없음)
        state.boards = state.boards.filter((b) => b.board_id !== id); // 목록에서 제거
        $('board-delete-dialog').close(); // 닫기
        renderBoardList(); // 카드 갱신
    }
    catch (err)
    {
        $('board-delete-error').textContent = err.message; // 오류 표시
    }
});

// 보드에서 작업실로 돌아가기: 진행 중인 이동·메모 편집을 정리하고, 필요하면 작업실에 알림을 띄운다
async function returnToWorkspace(notice)
{
    cancelMove(); // 진행 중 이동 취소
    finishNoteEdit(false); // 메모 편집 취소(잠금 반납)
    clearUndo(); // 실행 취소 기록 비움
    stopFollow(); // 따라가기 해제
    lastSeen.clear(); // 보드를 나가면 위치 기억도 버림
    if (realtime)
    {
        realtime.leave(); // 연결 종료
    }
    state.board = null; // 보드 비움
    await openWorkspace(); // 작업실 구성(업무 현황판용 연결을 새로 맺음)
    if (notice)
    {
        $('ws-notice').textContent = notice; // 알림 문구
        $('ws-notice').hidden = false; // 알림 표시
    }
}

// 작업실 현황: 참여자 목록과 업무 현황판
function renderWorkspaceInfo()
{
    const memberList = $('ws-members'); // 참여자 목록 요소
    memberList.innerHTML = ''; // 초기화
    for (const m of state.members)
    {
        const li = document.createElement('li'); // 항목
        const name = document.createElement('span'); // 이름
        const role = document.createElement('span'); // 역할
        name.textContent = m.display_name + (state.guest && m.guest_id === state.guest.guest_id ? ' (나)' : ''); // 이름
        role.className = 'chip'; // 역할 표시
        role.textContent = ROLE_LABELS[m.role] ?? m.role; // 역할 이름
        li.append(name, role); // 항목 구성
        memberList.appendChild(li); // 항목 추가
    }
    $('ws-member-count').textContent = state.members.length + '명'; // 참여자 수
    renderTaskBoard(); // 업무 현황판
}

// ---------- 작업실의 업무 현황판 ----------

// 현황판을 지금의 업무·역할·연결 상태로 다시 그린다. 편집자 이상이고 실시간 연결이 되어 있을 때만 바꿀 수 있다
function renderTaskBoard()
{
    if (!taskBoard)
    {
        taskBoard = TaskBoard.mount($('ws-taskboard'), { onMove: moveTask, onOpen: openWorkspaceTask }); // 처음 한 번만 만듦
    }
    const tasks = [...state.tasks.values()]; // 프로젝트의 모든 공유 업무(보드에 놓이지 않은 업무도 포함)
    const overdue = tasks.filter((t) => TaskBoard.dueInfo(t).state === 'overdue').length; // 마감이 지난 업무 수
    $('ws-task-count').textContent = tasks.length === 0 ? '' : tasks.length + '건' + (overdue > 0 ? ' · 마감 지남 ' + overdue + '건' : ''); // 요약
    $('ws-task-add').hidden = !canEdit(); // 열람자는 만들 수 없음
    $('ws-task-add').disabled = !workspaceOnline; // 연결 전에는 누를 수 없음
    $('ws-task-hint').textContent = !canEdit() ? '열람자는 업무를 볼 수만 있습니다.'
        : workspaceOnline ? '카드를 끌어 다른 열에 놓으면 상태가 바뀌고, 카드를 누르면 제목·담당자·마감일과 체크리스트를 고칩니다. 보드에 놓인 같은 업무 블럭도 함께 바뀝니다.'
            : '실시간 서버에 연결되면 업무를 만들고 바꿀 수 있습니다.'; // 사용 안내
    taskBoard.render(tasks, canEdit() && workspaceOnline); // 카드 그리기
    renderWorkspaceChecklist(); // 업무 대화상자가 열려 있으면 그 안의 체크리스트도 최신으로
}

// 업무 대화상자의 체크리스트: 고치는 중인 업무의 지금 항목을 보여 준다(새 업무를 만드는 중이면 안내만)
function renderWorkspaceChecklist()
{
    const task = workspaceTaskTarget ? state.tasks.get(workspaceTaskTarget.task_id) ?? null : null; // 대화상자가 고치는 업무의 최신 값
    $('ws-task-checklist').hidden = !task; // 새 업무에는 아직 항목을 달 수 없음
    $('ws-task-checklist-hint').textContent = task ? '체크리스트는 바꾸는 즉시 저장됩니다. 제목·상태·담당자·마감일은 저장을 눌러야 바뀝니다.' : '체크리스트는 업무를 만든 뒤 카드를 눌러 더합니다.'; // 저장 방식 안내
    if (!task || !$('ws-task-dialog').open)
    {
        return; // 보여 줄 대상 없음
    }
    if (!workspaceChecklist)
    {
        workspaceChecklist = Checklist.mount($('ws-task-checklist'), checklistActions); // 처음 한 번만 만듦
    }
    workspaceChecklist.render(task, canEdit() && workspaceOnline); // 항목 그리기
}

// ---------- 업무 체크리스트(보드의 업무 패널·작업실의 업무 대화상자 공용) ----------

// 체크리스트 요청: 보드에서는 보드 연결로, 작업실에서는 작업실 연결로 보낸다. 서버가 돌려준 업무(체크리스트 포함)를 화면에 반영한다
async function checklistRequest(event, payload)
{
    const onBoard = !!state.board; // 보드 화면에서 보낸 요청인지
    const link = onBoard ? realtime : workspaceLink; // 쓸 연결
    if (!link || !link.joined)
    {
        throw new Error('실시간 서버에 연결되어 있지 않습니다. 연결된 뒤 다시 시도하세요.'); // 연결 전·끊김
    }
    const reply = await link.request(event, onBoard ? { board_id: boardId(), ...payload } : payload); // 항목 저장(보드 연결은 보드 번호를 함께 보냄)
    state.tasks.set(reply.task.task_id, reply.task); // 서버가 저장한 업무
    if (onBoard)
    {
        canvas.invalidate(); // 업무 블럭의 진행률 다시 그리기
        refreshTaskProps(); // 업무 패널 갱신
    }
    else
    {
        renderTaskBoard(); // 현황판 카드와 대화상자 갱신
    }
}

const checklistActions = {
    onAdd: (task, title) => checklistRequest('checklist:add', { task_id: task.task_id, title }), // 항목 추가
    onToggle: (task, item, done) => checklistRequest('checklist:update', { task_id: task.task_id, item_id: item.item_id, changes: { done } }), // 체크·해제
    onRename: (task, item, title) => checklistRequest('checklist:update', { task_id: task.task_id, item_id: item.item_id, changes: { title } }), // 이름 변경
    onDelete: (task, item) => checklistRequest('checklist:delete', { task_id: task.task_id, item_id: item.item_id }), // 항목 삭제
}; // 체크리스트가 부르는 저장 요청

function setWorkspaceConnection(stateName)
{
    const labels = { connecting: '연결 중…', online: '실시간 연결됨', reconnecting: '재접속 중', offline: '연결 안 됨' }; // 표시 문구
    workspaceOnline = stateName === 'online'; // 참여까지 끝났을 때만 편집 가능
    $('ws-conn').dataset.state = stateName; // 색상 상태
    $('ws-conn').textContent = labels[stateName]; // 문구
    renderTaskBoard(); // 편집 가능 여부 반영
}

async function connectWorkspace()
{
    const projectId = state.project.project_id; // 연결할 프로젝트
    try
    {
        await Realtime.loadClient(window.TC_CONFIG.realtimeUrl); // Socket.IO 클라이언트 로드
        if (state.board || !state.project || state.project.project_id !== projectId)
        {
            return; // 그 사이 보드를 열었거나 나감
        }
        if (!workspaceLink)
        {
            workspaceLink = new Realtime(window.TC_CONFIG.realtimeUrl, workspaceHandlers); // 작업실 연결 관리자
        }
        workspaceLink.watchProject(projectId); // 프로젝트의 공유 업무 변경 받기 시작
    }
    catch (err)
    {
        setWorkspaceConnection('offline'); // 연결 실패
        $('ws-task-error').textContent = '실시간 서버에 연결하지 못해 업무를 바꿀 수 없습니다. 주소 끝에 /check.html 을 붙여 접속 점검을 열면 원인을 볼 수 있습니다.'; // 안내(보는 것은 가능)
    }
}

function disconnectWorkspace()
{
    if (workspaceLink)
    {
        workspaceLink.leave(); // 연결 종료
    }
    setWorkspaceConnection('connecting'); // 편집 불가 상태로 바꾸고 카드도 그에 맞게 다시 그림(다음에 작업실을 열 때 새로 연결)
    if ($('ws-task-dialog').open)
    {
        $('ws-task-dialog').close(); // 열려 있던 업무 대화상자 닫기
    }
}

// 카드를 다른 열에 놓음: 먼저 옮겨 보이고 서버에 상태 변경을 요청한다. 실패하면 서버의 최신 값이나 원래 값으로 되돌린다
async function moveTask(task, status)
{
    const moved = { ...task, status }; // 먼저 보여 줄 모습
    $('ws-task-error').textContent = ''; // 이전 오류 지움
    state.tasks.set(task.task_id, moved); // 화면에 먼저 반영
    renderTaskBoard(); // 옮겨진 모습으로 그리기
    try
    {
        const reply = await workspaceLink.request('task:update', { task_id: task.task_id, version: task.version, changes: { status }, request_id: nextRequestId() }); // 업무 원본 변경(버전 검사)
        state.tasks.set(reply.task.task_id, reply.task); // 서버가 저장한 값
    }
    catch (err)
    {
        if (err.task)
        {
            state.tasks.set(err.task.task_id, err.task); // 버전 충돌: 서버의 최신 업무로
        }
        else if (state.tasks.get(task.task_id) === moved)
        {
            state.tasks.set(task.task_id, task); // 그 밖의 실패: 원래대로(그 사이 다른 사람의 변경이 왔으면 그 값을 유지)
        }
        $('ws-task-error').textContent = err.code === 'VERSION_CONFLICT' ? '다른 사람이 먼저 이 업무를 바꿨습니다. 최신 상태를 불러왔습니다.' : '상태를 바꾸지 못했습니다: ' + err.message; // 안내
    }
    renderTaskBoard(); // 결과 반영
}

// 업무 대화상자 열기: task 가 있으면 수정, 없으면 새 업무
function openWorkspaceTask(task)
{
    workspaceTaskTarget = task ?? null; // 대상 업무
    $('ws-task-dialog-title').textContent = task ? '업무 수정' : '새 업무'; // 제목
    $('ws-task-title').value = task ? task.title : ''; // 업무 제목
    $('ws-task-status').value = task ? task.status : 'todo'; // 상태
    $('ws-task-assignee').value = task && task.assignee_id !== null ? String(task.assignee_id) : ''; // 담당자
    $('ws-task-due').value = task ? (task.due_at ?? '') : ''; // 마감일
    $('ws-task-dialog-error').textContent = ''; // 오류 초기화
    $('ws-task-delete').hidden = !task; // 삭제는 있는 업무를 고칠 때만
    $('ws-task-dialog').showModal(); // 대화상자 열기
    renderWorkspaceChecklist(); // 고치는 업무의 체크리스트(새 업무면 안내만)
    $('ws-task-title').focus(); // 바로 입력할 수 있게
}

$('ws-task-add').addEventListener('click', () => openWorkspaceTask(null)); // 새 업무
$('ws-task-delete').addEventListener('click', () =>
{
    if (workspaceTaskTarget)
    {
        openTaskDelete(state.tasks.get(workspaceTaskTarget.task_id) ?? workspaceTaskTarget); // 삭제 확인(고치던 창 위에 뜸)
    }
});

// ---------- 업무 삭제(작업실의 업무 대화상자·보드의 업무 패널 공용) ----------

function openTaskDelete(task)
{
    taskDeleteTarget = task; // 지울 업무
    $('task-delete-text').textContent = "'" + task.title + "' 업무를 삭제합니다."; // 확인 문구(textContent 로만 표시)
    $('task-delete-error').textContent = ''; // 오류 초기화
    $('task-delete-dialog').showModal(); // 대화상자 열기
}

// 화면에서 업무를 치운다(내가 지웠을 때와 다른 사람이 지웠다는 알림을 받았을 때 모두). 보드에서는 그 업무의 블럭도 함께 치운다
function forgetTask(taskId, notice)
{
    const known = state.tasks.delete(taskId); // 목록에서 제거(이미 없었으면 false)
    if ($('task-delete-dialog').open && taskDeleteTarget && taskDeleteTarget.task_id === taskId)
    {
        $('task-delete-dialog').close(); // 지우려던 업무가 이미 사라짐
    }
    if (state.board)
    {
        for (const o of canvas.objects.filter((x) => x.type === 'task' && x.task_id === taskId))
        {
            realtimeHandlers.onObjectDeleted(o.object_id); // 블럭 제거(블럭 삭제 알림을 놓쳐도 화면에 남지 않게)
        }
        canvas.invalidate(); // 다시 그리기
        refreshTaskProps(); // 업무 패널 갱신
        if (known && notice)
        {
            toast(notice, 3500); // 다른 사람이 지웠음을 안내
        }
        return;
    }
    if ($('ws-task-dialog').open && workspaceTaskTarget && workspaceTaskTarget.task_id === taskId)
    {
        $('ws-task-dialog').close(); // 고치던 업무가 사라짐
        $('ws-task-error').textContent = notice ?? ''; // 왜 닫혔는지 안내(내가 지운 경우는 안내 없음)
    }
    renderTaskBoard(); // 현황판 갱신
}

$('task-delete-cancel').addEventListener('click', () => $('task-delete-dialog').close()); // 삭제 취소
$('task-delete-form').addEventListener('submit', async (e) =>
{
    e.preventDefault(); // 대화상자 자동 닫힘 방지
    const task = taskDeleteTarget; // 지울 업무
    if (!task)
    {
        return;
    }
    const onBoard = !!state.board; // 보드 화면에서 지우는지
    try
    {
        const link = onBoard ? realtime : workspaceLink; // 쓸 연결
        if (!link || !link.joined)
        {
            throw new Error('실시간 서버에 연결되어 있지 않습니다. 연결된 뒤 다시 시도하세요.'); // 연결 전·끊김
        }
        await link.request('task:delete', onBoard ? { board_id: boardId(), task_id: task.task_id, request_id: nextRequestId() } : { task_id: task.task_id, request_id: nextRequestId() }); // 업무와 모든 보드의 블럭 삭제(되돌릴 수 없음)
    }
    catch (err)
    {
        if (err.code !== 'NOT_FOUND')
        {
            $('task-delete-error').textContent = err.message; // 오류 표시
            return;
        }
        // 다른 사람이 먼저 지운 업무: 화면에서만 치우면 됨
    }
    $('task-delete-dialog').close(); // 닫기
    forgetTask(task.task_id, null); // 화면에서 치움
    if (onBoard)
    {
        toast("'" + task.title + "' 업무를 삭제했습니다."); // 안내
    }
});
$('ws-task-cancel').addEventListener('click', () => $('ws-task-dialog').close()); // 취소
$('ws-task-form').addEventListener('submit', async (e) =>
{
    e.preventDefault(); // 대화상자 자동 닫힘 방지
    const fields = {
        title: $('ws-task-title').value.trim(), // 제목
        status: $('ws-task-status').value, // 상태
        assignee_id: $('ws-task-assignee').value === '' ? null : Number($('ws-task-assignee').value), // 담당자
        due_at: $('ws-task-due').value || null, // 마감일
    }; // 입력한 내용
    if (fields.title === '')
    {
        $('ws-task-dialog-error').textContent = '업무 제목을 입력하세요.'; // 필수값 안내
        return;
    }
    const target = workspaceTaskTarget; // 고치는 업무(새 업무면 null)
    try
    {
        const reply = target
            ? await workspaceLink.request('task:update', { task_id: target.task_id, version: target.version, changes: fields, request_id: nextRequestId() }) // 대화상자를 열 때의 버전으로 변경 요청
            : await workspaceLink.request('task:create', { ...fields, request_id: nextRequestId() }); // 새 업무 원본 생성
        state.tasks.set(reply.task.task_id, reply.task); // 저장된 업무 반영
        $('ws-task-error').textContent = ''; // 현황판 오류 지움
        $('ws-task-dialog').close(); // 닫기
        renderTaskBoard(); // 현황판 갱신
    }
    catch (err)
    {
        if (err.code === 'VERSION_CONFLICT' && err.task)
        {
            state.tasks.set(err.task.task_id, err.task); // 서버의 최신 업무로 교체
            renderTaskBoard(); // 현황판 갱신
            openWorkspaceTask(err.task); // 최신 내용으로 다시 채움(다음 저장은 새 버전 기준)
            $('ws-task-dialog-error').textContent = '다른 사람이 먼저 이 업무를 바꿨습니다. 최신 내용으로 다시 채웠으니 확인하고 저장하세요.'; // 안내
            return;
        }
        $('ws-task-dialog-error').textContent = err.message; // 그 밖의 오류
    }
});

// 작업실 연결의 콜백: 프로젝트의 공유 업무 생성·변경만 받는다(보드 이벤트는 오지 않음)
const workspaceHandlers = {
    getTicket: async (scope) => (await window.api.post('/api/realtime-ticket', scope)).ticket, // 작업실용 티켓 발급
    onStatus: (name) => setWorkspaceConnection(name), // 연결 상태
    onRefused: () =>
    {
        $('ws-task-error').textContent = '실시간 서버에 연결하지 못해 업무를 바꿀 수 없습니다. 주소 끝에 /check.html 을 붙여 접속 점검을 열면 원인을 볼 수 있습니다.'; // 첫 연결 실패 안내(보는 것은 가능)
    },
    onJoined: async () =>
    {
        $('ws-task-error').textContent = ''; // 연결되었으므로 이전 안내 지움
        try
        {
            await loadProjectData(); // 화면을 그린 뒤 연결되기 전까지(또는 끊긴 동안)의 변경을 놓치지 않게 다시 조회
        }
        catch (err)
        {
            // 다시 읽지 못해도 이후의 변경은 실시간으로 들어옴
        }
        renderWorkspaceInfo(); // 참여자·현황판 갱신
    },
    onJoinError: (err) =>
    {
        if (err instanceof window.api.ApiError && err.status === 401)
        {
            disconnectWorkspace(); // 연결 정리
            showView('join'); // 세션 만료 → 입장 화면
            $('join-error').textContent = '세션이 만료되었습니다. 다시 입장해 주세요.'; // 안내
            return;
        }
        $('ws-task-error').textContent = '업무 현황판을 실시간으로 연결하지 못했습니다: ' + err.message; // 안내(보는 것은 가능)
    },
    onTaskCreated: (task) =>
    {
        state.tasks.set(task.task_id, task); // 보드나 다른 작업실에서 만든 업무
        renderTaskBoard(); // 현황판 갱신
    },
    onTaskUpdated: (task) =>
    {
        state.tasks.set(task.task_id, task); // 보드나 다른 작업실에서 바꾼 업무
        renderTaskBoard(); // 현황판 갱신
    },
    onTaskDeleted: (taskId) => forgetTask(taskId, '고치던 업무를 다른 사람이 삭제했습니다.'), // 보드나 다른 작업실에서 지운 업무
    onProjectDeleted: (data) =>
    {
        if (state.project && data.project_id === state.project.project_id)
        {
            leaveDeletedWorkspace('이 작업실은 관리자가 삭제했습니다.'); // 소개 화면으로
        }
    },
}; // 작업실 실시간 콜백

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
        // 이미 만료된 세션이어도 소개 페이지로 이동
    }
    disconnectWorkspace(); // 작업실 연결 종료
    ownerCode = null; // 재입장 코드는 화면에서 지움
    state.guest = null; // 게스트 비움
    state.project = null; // 프로젝트 비움
    showIntro(); // 홈이 다시 소개 페이지로 구성됨
});

// ---------- 초대 코드 관리 (관리자) ----------

const ROLE_LABELS = { admin: '관리자', editor: '편집자', viewer: '열람자' }; // 역할 이름
const INVITE_STATUS_LABELS = { active: '사용 가능', expired: '만료', revoked: '취소됨', exhausted: '인원 마감' }; // 초대 상태 이름
const COPY_LABELS = { 'invite-copy-code': '코드 복사', 'invite-copy-link': '링크 복사' }; // 복사 버튼 기본 문구

async function loadInvites()
{
    try
    {
        const data = await window.api.get('/api/projects/' + state.project.project_id + '/invites'); // 초대 목록 조회(관리자만 허용)
        renderInvites(data.invites); // 목록 표시
    }
    catch (err)
    {
        $('invite-error').textContent = err.message; // 오류 표시
    }
}

function renderInvites(invites)
{
    const tbody = $('invite-list'); // 목록 본문
    tbody.innerHTML = ''; // 초기화
    for (const invite of invites)
    {
        const tr = document.createElement('tr'); // 행
        const uses = invite.reentry_only ? '재입장 전용' : invite.used_count + '명' + (invite.max_uses === null ? '' : ' / ' + invite.max_uses + '명'); // 이 코드로 새로 입장한 인원(제한이 있으면 한도와 함께). 재입장 전용 코드는 새 사람을 받지 않음
        for (const text of [ROLE_LABELS[invite.role] ?? invite.role, invite.expires_at.slice(0, 16), uses, INVITE_STATUS_LABELS[invite.status] ?? invite.status])
        {
            const td = document.createElement('td'); // 칸
            td.textContent = text; // 서버 값은 textContent 로만 표시
            tr.appendChild(td); // 칸 추가
        }
        const action = document.createElement('td'); // 동작 칸
        if (invite.status === 'active')
        {
            const btn = document.createElement('button'); // 취소 버튼
            btn.type = 'button'; // 제출 방지
            btn.textContent = '취소'; // 버튼 문구
            btn.addEventListener('click', () => revokeInvite(invite.invite_id)); // 초대 취소
            action.appendChild(btn); // 버튼 추가
        }
        tr.appendChild(action); // 동작 칸 추가
        tbody.appendChild(tr); // 행 추가
    }
}

async function revokeInvite(inviteId)
{
    $('invite-error').textContent = ''; // 오류 초기화
    try
    {
        await window.api.post('/api/invites/' + inviteId + '/revoke'); // 초대 취소(이미 입장한 참여자는 유지)
        await loadInvites(); // 목록 갱신
    }
    catch (err)
    {
        $('invite-error').textContent = err.message; // 오류 표시
    }
}

function inviteLink(code)
{
    return location.origin + location.pathname + '#code=' + code; // # 뒤 값은 서버로 전송되지 않아 접속 로그에 남지 않음
}

async function copyText(text)
{
    try
    {
        if (navigator.clipboard && window.isSecureContext)
        {
            await navigator.clipboard.writeText(text); // HTTPS·localhost 에서만 동작하는 표준 방식
            return true;
        }
    }
    catch (err)
    {
        // 아래 대체 방식으로 진행
    }
    const area = document.createElement('textarea'); // LAN 의 http 접속용 대체 방식
    area.value = text; // 복사할 글
    area.style.position = 'fixed'; // 화면 흔들림 방지
    area.style.opacity = '0'; // 보이지 않게
    document.body.appendChild(area); // 문서에 추가
    area.select(); // 전체 선택
    let ok = false; // 복사 성공 여부
    try
    {
        ok = document.execCommand('copy'); // 선택 영역 복사
    }
    catch (err)
    {
        ok = false; // 복사 실패
    }
    area.remove(); // 임시 요소 제거
    return ok; // 결과
}

$('invite-form').addEventListener('submit', async (e) =>
{
    e.preventDefault(); // 기본 제출 방지
    $('invite-error').textContent = ''; // 오류 초기화
    try
    {
        const data = await window.api.post('/api/projects/' + state.project.project_id + '/invites', { role: $('invite-role').value, days: Number($('invite-days').value), max_uses: $('invite-uses').value === '' ? null : Number($('invite-uses').value) }); // 초대 코드 발급(인원 제한을 비우면 제한 없음)
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname); // 서버 PC 자신으로 접속 중인지
        $('invite-code').textContent = data.code; // 코드 원문(이 응답에서만 받음)
        $('invite-link').textContent = inviteLink(data.code); // 초대 링크
        $('invite-link-note').textContent = (local ? '지금은 localhost 로 접속 중입니다. 다른 PC 에 보낼 때는 링크의 localhost 를 이 PC 의 IP 주소로 바꾸세요. ' : '') + '링크를 열면 초대 코드가 자동으로 입력되고 주소창에서는 바로 지워집니다.'; // 안내
        $('invite-result').hidden = false; // 발급 결과 표시
        await loadInvites(); // 목록 갱신
    }
    catch (err)
    {
        $('invite-error').textContent = err.message; // 오류 표시
    }
});

for (const [buttonId, sourceId] of [['invite-copy-code', 'invite-code'], ['invite-copy-link', 'invite-link']])
{
    $(buttonId).addEventListener('click', async () =>
    {
        const copied = await copyText($(sourceId).textContent); // 클립보드 복사
        $(buttonId).textContent = copied ? '복사됨' : '복사 실패: 직접 선택해 복사하세요'; // 결과 표시
        setTimeout(() => { $(buttonId).textContent = COPY_LABELS[buttonId]; }, 1500); // 기본 문구 복원
    });
}

// ---------- 화이트보드 ----------

async function openBoard(board, resumeView = null)
{
    cancelMove(); // 진행 중 이동 취소
    finishNoteEdit(false); // 다른 보드로 옮기기 전에 메모 편집 취소
    clearUndo(); // 실행 취소 기록은 보드마다 따로
    stopFollow(); // 따라가기는 보드마다 따로
    lastSeen.clear(); // 다른 보드의 위치는 버림
    disconnectWorkspace(); // 작업실 연결은 끊고 보드 연결을 씀(업무 변경은 보드 연결로도 받음)
    state.board = board; // 현재 보드
    state.pendingSaves = 0; // 저장 대기 초기화
    showView('board'); // 보드 화면
    rememberBoard(board.board_id, null); // 새로고침하면 이 보드로 돌아오도록 기억
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
        canvas.afterRender = () =>
        {
            overlay.sync(canvas); // 렌더마다 영상 iframe 위치 동기화
            positionNoteEditor(); // 확대·이동 중에도 메모 입력 위치 유지
        };
        attachNoteEditor(); // 메모 글 입력 연결
        attachMediaInputs(); // 이미지·영상 입력 연결
        canvas.tasks = state.tasks; // 업무 블럭 렌더링용 공유 Map
        canvas.onSelectionChange = announceSelection; // 지워진 객체가 내 선택에서 빠지면 다른 참여자에게도 알림
        attachTaskInputs(); // 업무 블럭 입력 연결
        attachLinkInputs(); // 연결선 입력 연결
    }
    canvas.reset(); // 화면 비움
    if (resumeView)
    {
        canvas.view = { ...resumeView }; // 새로고침 전에 보던 위치·배율(기본값이 아니므로 전체 보기 맞춤을 건너뜀)
    }
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

$('board-back').addEventListener('click', () => returnToWorkspace('')); // 작업실로 돌아가기

function renderParticipants(list)
{
    participants = list; // 목록 기억(따라가기 표시를 다시 그릴 때 사용)
    const ul = $('participants'); // 참여자 목록 요소
    ul.innerHTML = ''; // 초기화
    for (const p of list)
    {
        const li = document.createElement('li'); // 항목
        const dot = document.createElement('span'); // 색상 점
        const mine = state.guest && p.guest_id === state.guest.guest_id; // 나 자신인지
        dot.className = 'dot'; // 스타일
        dot.style.background = p.color; // 참여자 색
        if (mine)
        {
            li.appendChild(dot); // 점 추가
            li.appendChild(document.createTextNode(p.display_name + ' (나)')); // 이름
        }
        else
        {
            const btn = document.createElement('button'); // 누를 수 있는 이름표
            btn.type = 'button'; // 제출 방지
            btn.className = 'participant' + (follow.guestId === p.guest_id ? ' following' : follow.armed === p.guest_id ? ' armed' : ''); // 따라가는 중·방금 이동함 표시
            btn.dataset.guestId = String(p.guest_id); // 대상 참여자
            btn.title = follow.guestId === p.guest_id ? '따라가는 중입니다. 누르면 그만 따라갑니다'
                : follow.armed === p.guest_id ? '한 번 더 누르면 이 사람을 계속 따라갑니다' : '누르면 이 사람이 있는 곳으로 이동합니다'; // 다음에 일어날 일
            btn.append(dot, document.createTextNode(p.display_name + (follow.guestId === p.guest_id ? ' · 따라가는 중' : ''))); // 점과 이름
            btn.addEventListener('click', () => onParticipantClick(p.guest_id)); // 이동 → 따라가기 → 해제 순서
            li.className = 'other'; // 이름표가 칸을 채움
            li.appendChild(btn); // 이름표 추가
            if (p.cursor)
            {
                lastSeen.set(p.guest_id, { x: p.cursor.x, y: p.cursor.y }); // 서버가 기억한 마지막 위치(내가 들어오기 전에 움직인 사람도 찾아갈 수 있음)
            }
        }
        ul.appendChild(li); // 항목 추가
    }
    if (follow.guestId !== null && !list.some((p) => p.guest_id === follow.guestId))
    {
        stopFollow('따라가던 참여자가 나가서 따라가기를 멈췄습니다.'); // 대상이 보드를 떠남
    }
    else if (follow.armed !== null && !list.some((p) => p.guest_id === follow.armed))
    {
        follow.armed = null; // 방금 찾아갔던 사람이 떠남
    }
    renderFollowBanner(); // 따라가는 중 안내 갱신
    if (canvas)
    {
        canvas.syncParticipants(list, state.guest ? state.guest.guest_id : null); // 나간 사람의 커서·선택 제거, 다른 사람의 선택과 마지막 위치 표시
    }
}

// ---------- 참여자 따라가기 ----------

function participantOf(guestId)
{
    return participants.find((p) => p.guest_id === guestId) ?? null; // 목록의 그 참여자
}

function renderFollowBanner()
{
    const target = follow.guestId === null ? null : participantOf(follow.guestId); // 따라가는 대상
    $('follow-banner').hidden = target === null; // 따라가는 중에만 표시
    if (target)
    {
        $('follow-dot').style.background = target.color; // 그 사람의 커서 색
        $('follow-text').textContent = target.display_name + ' 님을 따라가는 중'; // 안내 문구(textContent 로만 표시)
    }
}

// 이름표를 누를 때마다: 그 사람 자리로 이동 → (한 번 더) 계속 따라가기 → (한 번 더) 해제
function onParticipantClick(guestId)
{
    const target = participantOf(guestId); // 누른 참여자
    if (!target || !canvas)
    {
        return;
    }
    if (follow.guestId === guestId)
    {
        stopFollow(target.display_name + ' 님 따라가기를 멈췄습니다.'); // 따라가는 중 → 해제
        return;
    }
    const at = lastSeen.get(guestId) ?? null; // 마지막으로 있던 곳
    if (follow.armed === guestId)
    {
        follow.guestId = guestId; // 계속 따라가기 시작
        follow.armed = null; // 한 번 이동 상태 종료
        if (at)
        {
            canvas.centerOn(at.x, at.y); // 지금 자리부터 맞춤
        }
        renderParticipants(participants); // 이름표·안내 갱신
        toast(target.display_name + ' 님을 따라갑니다. 보드를 직접 움직이거나 Esc 를 누르면 멈춥니다.', 3500); // 해제 방법 안내
        return;
    }
    follow.guestId = null; // 다른 사람을 따라가던 중이면 해제
    follow.armed = guestId; // 한 번 더 누르면 따라가기
    if (at)
    {
        canvas.centerOn(at.x, at.y); // 그 사람이 있는 곳을 화면 가운데로
        toast(target.display_name + ' 님이 있는 곳으로 이동했습니다. 이름을 한 번 더 누르면 계속 따라갑니다.', 3500); // 안내
    }
    else
    {
        toast(target.display_name + ' 님의 위치를 아직 모릅니다. 그분이 마우스를 움직이면 알 수 있습니다. 이름을 한 번 더 누르면 움직일 때부터 따라갑니다.', 4500); // 아직 커서를 받은 적 없음
    }
    renderParticipants(participants); // 이름표 갱신
}

function stopFollow(message)
{
    if (follow.guestId === null && follow.armed === null)
    {
        return; // 따라가는 중이 아님
    }
    const wasFollowing = follow.guestId !== null; // 실제로 따라가던 중이었는지
    follow.guestId = null; // 따라가기 해제
    follow.armed = null; // 한 번 이동 상태도 해제
    renderParticipants(participants); // 이름표·안내 갱신
    if (wasFollowing && message)
    {
        toast(message); // 왜 멈췄는지 안내
    }
}

// 다른 참여자의 커서가 올 때마다: 위치를 기억하고, 따라가는 대상이면 화면 가장자리로 나가기 전에 가운데로 다시 맞춘다
function noteCursor(data)
{
    lastSeen.set(data.guest_id, { x: data.x, y: data.y }); // 마지막 위치
    if (follow.guestId === data.guest_id && !canvas.isWellInView(data.x, data.y))
    {
        canvas.centerOn(data.x, data.y); // 화면 안쪽을 벗어나면 따라감(조금 움직일 때마다 화면이 흔들리지 않게)
    }
}

$('follow-stop').addEventListener('click', () => stopFollow('따라가기를 멈췄습니다.')); // 안내의 "그만 따라가기"

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
    updateUndoButton(); // 열람자는 실행 취소 불가
    $('task-save').disabled = !editable; // 열람자는 업무 수정 불가
    $('task-delete').disabled = !editable; // 열람자는 업무 삭제 불가
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
$('fit-view').addEventListener('click', () =>
{
    stopFollow('화면을 직접 맞춰 따라가기를 멈췄습니다.'); // 내가 화면을 정했으므로 따라가기 해제
    if (canvas)
    {
        canvas.fitAll(); // 화면 맞춤
    }
});

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
$('prop-size').addEventListener('change', (e) =>
{
    state.style.size = Number(e.target.value); // 글자 크기 변경(새 메모에도 적용)
    restyleSelected(); // 선택한 메모·텍스트에 적용
});

// 글자 크기 목록에서 값을 고른다. 목록에 없는 크기(다른 경로로 저장된 값)는 항목을 하나 만들어 보여 준다
function showNoteSize(size)
{
    const select = $('prop-size'); // 글자 크기 목록
    if (![...select.options].some((opt) => Number(opt.value) === size))
    {
        const opt = document.createElement('option'); // 임시 항목
        opt.value = String(size); // 값
        opt.textContent = '사용자 지정 (' + size + ')'; // 표시 이름
        select.appendChild(opt); // 목록에 추가
    }
    select.value = String(size); // 선택
}

// ---------- 선택·이동·삭제 (다중 선택, 연결선 선택) ----------

function selectedObjects()
{
    return [...canvas.selectedIds].map((id) => canvas.findObject(id)).filter(Boolean); // 선택된 객체 목록
}

function updateSelectionInfo()
{
    const names = { stroke: '펜 획', rect: '사각형', ellipse: '원', image: '이미지', video: '영상', task: '업무 블럭', note: '메모' }; // 유형 이름
    const list = canvas ? selectedObjects() : []; // 선택 객체
    let text = ''; // 안내 문구
    if (list.length === 1)
    {
        text = '선택: ' + (names[list[0].type] ?? list[0].type) + ' #' + list[0].object_id + ' (v' + list[0].version + ') — Delete 키로 삭제' + (BoardCanvas.RESIZABLE.includes(list[0].type) ? ', 모서리를 끌어 크기 조절' : '') + (list[0].type === 'note' ? ', 더블클릭해 글 수정' : ''); // 단일 선택
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
    syncPropsToSelection(); // 하나만 선택하면 그 객체의 색·굵기·채우기를 속성 패널에 표시
    canvas.invalidate(); // 다시 그리기
    updateSelectionInfo(); // 안내 갱신
    refreshTaskProps(); // 업무 패널 갱신
    refreshLinkProps(); // 연결선 패널 갱신
    announceSelection(); // 다른 참여자 화면에 내 선택 표시
}

// ---------- 내 선택을 다른 참여자에게 알리기 ----------

function selectionSignature()
{
    const ids = [...canvas.selectedIds].sort((x, y) => x - y).join(','); // 고른 객체 번호(순서 무관)
    return ids + (canvas.selectedLinkId !== null ? '|' + canvas.selectedLinkId : ''); // 연결선까지 포함한 서명
}

// 선택이 바뀔 때마다 부른다. 영역 선택처럼 연달아 바뀌는 경우를 묶어 잠시 뒤 한 번만 보낸다
function announceSelection()
{
    if (!selectionTimer)
    {
        selectionTimer = setTimeout(flushSelection, 80); // 묶음 전송 예약
    }
}

function flushSelection()
{
    selectionTimer = 0; // 타이머 해제
    if (!canvas || !realtime || !realtime.joined || realtime.boardId === null)
    {
        return; // 보드에 연결되지 않음(연결되면 onJoined 가 다시 알림)
    }
    const signature = selectionSignature(); // 지금 선택
    if (signature === sentSelection)
    {
        return; // 서버가 이미 아는 내용
    }
    sentSelection = signature; // 알린 내용 기록
    realtime.emit('selection:set', { board_id: boardId(), object_ids: [...canvas.selectedIds].slice(0, 200), link_id: canvas.selectedLinkId }); // 고른 객체들과 연결선(서버가 받는 최대 200개까지)
}

// 속성 패널을 선택한 객체의 스타일로 맞춘다. 패널이 실제 값을 보여 줘야 한 항목만 바꿔도 나머지가 유지된다
function syncPropsToSelection()
{
    const o = canvas ? canvas.primarySelected() : null; // 하나만 선택한 객체
    if (!o || !o.style)
    {
        return; // 대상 없음
    }
    let color = null; // 색상
    let width = null; // 굵기
    let fill; // 채우기(undefined: 이 유형에는 없음, null: 채우기 없음)
    if (o.type === 'stroke')
    {
        color = o.style.color; // 선 색
        width = o.style.width; // 선 굵기
    }
    else if (o.type === 'rect' || o.type === 'ellipse')
    {
        color = o.style.stroke; // 테두리 색
        width = o.style.width; // 테두리 굵기
        fill = o.style.fill ?? null; // 채우기
    }
    else if (o.type === 'note')
    {
        color = o.style.color; // 글자 색
        fill = o.style.fill ?? null; // 배경
        state.style.size = BoardCanvas.noteFont(o).size; // 글자 크기
        showNoteSize(state.style.size); // 패널 반영
    }
    else
    {
        return; // 이미지·영상·업무 블럭은 스타일 없음
    }
    if (color)
    {
        state.style.color = color; // 상태 반영
        $('prop-color').value = color; // 패널 반영
    }
    if (width)
    {
        state.style.width = width; // 상태 반영
        $('prop-width').value = String(width); // 패널 반영
        $('prop-width-out').value = String(width); // 숫자 표시
    }
    if (fill !== undefined)
    {
        state.style.fill = fill; // 상태 반영
        $('prop-fill-on').checked = fill !== null; // 채우기 여부
        $('prop-fill').disabled = fill === null; // 채우기 색 활성화
        if (fill)
        {
            $('prop-fill').value = fill; // 채우기 색
        }
    }
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

function beginMove(objects, w)
{
    return startSession({ kind: 'move', objects, start: w }); // 이동 세션(여러 객체)
}

function beginResize(object, corner, w)
{
    return startSession({ kind: 'resize', objects: [object], start: w, corner, shift: false }); // 크기 조절 세션(객체 하나)
}

async function startSession(base)
{
    const session = { ...base, tokens: new Map(), dx: 0, dy: 0, armed: false, finished: false, lastPreviewAt: 0 }; // 잠금 토큰과 누적 이동량을 가진 세션
    move = session; // 현재 세션
    await whenIdle(); // 직전 확정·반납이 끝난 뒤에 잠금 요청
    if (move !== session)
    {
        return; // 기다리는 사이 취소됨
    }
    session.objects = session.objects.map((o) => canvas.findObject(o.object_id)).filter(Boolean); // 기다리는 동안 확정된 최신 객체(버전)로 교체
    const objects = session.objects; // 대상 객체
    if (objects.length === 0)
    {
        move = null; // 그 사이 모두 삭제됨
        return;
    }
    busyOps += 1; // 잠금 요청 진행 중
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
    finally
    {
        busyOps -= 1; // 잠금 요청 종료
    }
}

// 크기 조절 결과 사각형: 잡은 모서리의 반대편 모서리를 고정하고 최소 크기·비율·격자 맞춤을 적용
function resizedRect(o, corner, dx, dy, keepRatio)
{
    const MIN = 10; // 최소 변 길이
    const west = corner.includes('w'); // 왼쪽 모서리를 잡았는지
    const north = corner.includes('n'); // 위쪽 모서리를 잡았는지
    const anchorX = west ? o.x + o.width : o.x; // 고정되는 X
    const anchorY = north ? o.y + o.height : o.y; // 고정되는 Y
    let px = (west ? o.x : o.x + o.width) + dx; // 움직이는 모서리 X
    let py = (north ? o.y : o.y + o.height) + dy; // 움직이는 모서리 Y
    if (state.snap)
    {
        px = Math.round(px / 10) * 10; // 격자 맞춤 X
        py = Math.round(py / 10) * 10; // 격자 맞춤 Y
    }
    let width = Math.max(MIN, west ? anchorX - px : px - anchorX); // 새 너비(뒤집힘 방지)
    let height = Math.max(MIN, north ? anchorY - py : py - anchorY); // 새 높이
    if (keepRatio)
    {
        const scale = Math.max(width / o.width, height / o.height, MIN / o.width, MIN / o.height); // 더 많이 늘린 축 기준 배율
        width = o.width * scale; // 비율 유지 너비
        height = o.height * scale; // 비율 유지 높이
    }
    return { x: west ? anchorX - width : anchorX, y: north ? anchorY - height : anchorY, width, height }; // 결과 사각형
}

function previewOf(s, o)
{
    if (s.kind === 'resize')
    {
        return resizedRect(o, s.corner, s.dx, s.dy, s.shift || o.type === 'image' || o.type === 'video'); // 이미지·영상은 항상 비율 유지
    }
    return { x: o.x + s.dx, y: o.y + s.dy }; // 이동
}

function applyMovePreview(s)
{
    for (const o of s.objects)
    {
        canvas.moves.set(o.object_id, previewOf(s, o)); // 로컬 미리보기
    }
    canvas.invalidate(); // 다시 그리기
    const now = Date.now(); // 현재 시각
    if (now - s.lastPreviewAt >= window.TC_CONFIG.cursorIntervalMs)
    {
        s.lastPreviewAt = now; // 전송 시각 갱신
        for (const o of s.objects)
        {
            realtime.emit('object:preview', { board_id: boardId(), object_id: o.object_id, lock_token: s.tokens.get(o.object_id), ...previewOf(s, o) }); // 이동·크기 조절 중 상태 공유
        }
    }
}

function updateMove(w, shift = false)
{
    if (!move)
    {
        return;
    }
    move.shift = shift; // Shift: 크기 조절 시 비율 유지
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
    if (s.kind === 'resize')
    {
        const target = s.objects[0]; // 크기 조절 대상
        await commitObject(target, s.tokens.get(target.object_id), previewOf(s, target)); // 위치·크기 저장
        return;
    }
    const items = (await Promise.all(s.objects.map((o) =>
    {
        const targetX = state.snap ? Math.round((o.x + s.dx) / 10) * 10 : o.x + s.dx; // 이동 후 X(격자 맞춤 반영)
        const targetY = state.snap ? Math.round((o.y + s.dy) / 10) * 10 : o.y + s.dy; // 이동 후 Y
        return commitObject(o, s.tokens.get(o.object_id), { x: targetX, y: targetY }, false); // 객체마다 이동 저장(실행 취소 기록은 아래에서 묶음)
    }))).filter(Boolean); // 저장된 항목
    if (items.length > 0)
    {
        pushUndo({ kind: 'update', items }); // 함께 옮긴 객체는 한 번에 되돌림
    }
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

// 변경 확정. 성공하면 되돌리기 정보({id, before})를 돌려주고, record 가 참이면 실행 취소 기록에도 쌓는다. 실패하면 null
async function commitObject(object, token, changes, record = true)
{
    state.pendingSaves += 1; // 대기 수 증가
    busyOps += 1; // 확정 진행 중(끝나야 같은 객체를 다시 잠글 수 있음)
    setSaveStatus('saving'); // 저장 중 표시
    try
    {
        const reply = await realtime.request('object:commit', { board_id: boardId(), object_id: object.object_id, lock_token: token, version: object.version, changes, request_id: nextRequestId() }); // 변경 확정 요청
        const item = { id: object.object_id, before: previousValues(object, changes) }; // 되돌릴 때 다시 보낼 이전 값
        canvas.updateObject(reply.object); // 확정 결과 반영(미리보기 제거)
        myVersions.set(reply.object.object_id, reply.object.version); // 내가 바꾼 직후 버전
        if (record)
        {
            pushUndo({ kind: 'update', items: [item] }); // 실행 취소 기록
        }
        updateSelectionInfo(); // 버전 표시 갱신
        state.pendingSaves -= 1; // 대기 수 감소
        if (state.pendingSaves === 0)
        {
            setSaveStatus('saved'); // 모두 저장됨
        }
        return item; // 되돌리기 정보
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
        return null; // 저장 실패
    }
    finally
    {
        busyOps -= 1; // 확정 종료
    }
}

async function withLock(object, action)
{
    await whenIdle(); // 직전 확정·반납이 끝난 뒤에 잠금 요청
    busyOps += 1; // 잠금~작업 진행 중
    try
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
    finally
    {
        busyOps -= 1; // 작업 종료
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
    const removed = []; // 지운 객체(실행 취소용)
    const removedLinks = new Map(); // 함께 사라진 연결선 link_id → 연결선
    for (const object of list)
    {
        state.pendingSaves += 1; // 대기 수 증가
        setSaveStatus('saving'); // 저장 중 표시
        try
        {
            await withLock(object, (token) => realtime.request('object:delete', { board_id: boardId(), object_id: object.object_id, lock_token: token, version: object.version, request_id: nextRequestId() })); // 잠금 후 삭제
            for (const l of canvas.links)
            {
                if (l.from_object_id === object.object_id || l.to_object_id === object.object_id)
                {
                    removedLinks.set(l.link_id, { ...l }); // 객체와 함께 지워지는 연결선 기억
                }
            }
            removed.push(object); // 지운 객체 기억
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
    if (removed.length > 0)
    {
        pushUndo({ kind: 'delete', objects: removed, links: [...removedLinks.values()] }); // 한 번에 지운 것은 한 번에 되살림
    }
    setSelection([]); // 선택 해제
}

async function restyleSelected()
{
    const list = selectedObjects().filter((o) => o.type === 'stroke' || o.type === 'rect' || o.type === 'ellipse' || o.type === 'note'); // 스타일이 있는 객체만
    if (list.length === 0 || !canEdit() || move || !realtime || !realtime.joined)
    {
        return; // 적용 대상 없음
    }
    const items = []; // 실행 취소용 이전 스타일
    for (const object of list)
    {
        if (canvas.locks.has(object.object_id))
        {
            toast(canvas.locks.get(object.object_id).display_name + ' 님이 편집 중인 객체입니다.'); // 타인 잠금
            continue;
        }
        let style = { stroke: state.style.color, fill: state.style.fill, width: state.style.width }; // 도형 스타일
        if (object.type === 'stroke')
        {
            style = { color: state.style.color, width: state.style.width }; // 획 스타일
        }
        const changes = { style }; // 저장할 변경
        if (object.type === 'note')
        {
            changes.style = { color: state.style.color, fill: state.style.fill, size: state.style.size }; // 메모: 글자 색·배경·글자 크기
            const text = object.payload && typeof object.payload.text === 'string' ? object.payload.text : ''; // 메모 글
            const needed = canvas.noteHeightFor(text, object.width, state.style.size); // 이 글자 크기에서 글이 모두 보이는 높이
            if (needed > object.height)
            {
                changes.height = needed; // 글자를 키워 글이 넘치면 높이도 함께 늘림(되돌리면 함께 돌아감)
            }
        }
        try
        {
            const item = await withLock(object, (token) => commitObject(object, token, changes, false)); // 잠금 후 스타일 저장
            if (item)
            {
                items.push(item); // 이전 스타일 기억
            }
        }
        catch (err)
        {
            toast(lockMessage(err)); // 잠금 실패 안내
        }
    }
    if (items.length > 0)
    {
        pushUndo({ kind: 'update', items }); // 함께 바꾼 스타일은 한 번에 되돌림
    }
}

// ---------- 실행 취소·복제·내보내기 ----------

const UNDO_LIMIT = 50; // 기억할 작업 수
const undoStack = []; // 이 보드에서 내가 한 작업(최근 것이 뒤). 보드를 바꾸거나 재접속하면 비움
const redoStack = []; // 방금 되돌린 작업(다시 실행용). 새 작업을 하면 비움
const myVersions = new Map(); // object_id → 내가 만들거나 바꾼 직후의 버전. 지금 버전과 다르면 그 뒤에 다른 사람이 고친 것
const idAlias = new Map(); // 삭제를 되돌려 다시 만든 객체의 예전 ID → 새 ID
const linkAlias = new Map(); // 다시 만든 연결선의 예전 ID → 새 ID
let undoRunning = false; // 되돌리거나 다시 실행하는 중(이 동안 일어나는 저장은 새 기록으로 쌓지 않음)

function resolveAlias(map, id)
{
    let current = id; // 따라갈 ID
    while (map.has(current))
    {
        current = map.get(current); // 다시 만들어진 최신 ID
    }
    return current; // 지금 유효한 ID
}

function updateUndoButton()
{
    $('tool-undo').disabled = undoStack.length === 0 || !canEdit(); // 되돌릴 작업이 있을 때만 활성화
    $('tool-redo').disabled = redoStack.length === 0 || !canEdit(); // 다시 실행할 작업이 있을 때만 활성화
}

function pushUndo(entry)
{
    if (undoRunning)
    {
        return; // 되돌리기 자체는 기록하지 않음
    }
    undoStack.push(entry); // 작업 기록
    redoStack.length = 0; // 새 작업을 하면 다시 실행할 것은 없어짐
    if (undoStack.length > UNDO_LIMIT)
    {
        undoStack.shift(); // 오래된 기록부터 버림
    }
    updateUndoButton(); // 버튼 상태 갱신
}

function clearUndo()
{
    undoStack.length = 0; // 기록 비움
    redoStack.length = 0; // 다시 실행 기록 비움
    myVersions.clear(); // 버전 기록 비움
    idAlias.clear(); // ID 대응 비움
    linkAlias.clear(); // 연결선 ID 대응 비움
    updateUndoButton(); // 버튼 상태 갱신
}

// 방금 만든 객체의 생성 기록을 지운다(비워 둔 새 메모가 자동 삭제될 때)
function dropCreateEntry(objectId)
{
    for (let i = undoStack.length - 1; i >= 0; i--)
    {
        const entry = undoStack[i]; // 기록
        if (entry.kind === 'create' && entry.ids.length === 1 && entry.ids[0] === objectId)
        {
            undoStack.splice(i, 1); // 해당 기록 제거
            break;
        }
    }
    updateUndoButton(); // 버튼 상태 갱신
}

// 바꾸려는 항목들의 지금 값(되돌릴 때 다시 보낼 값)
function previousValues(object, changes)
{
    const before = {}; // 이전 값
    for (const key of ['x', 'y', 'width', 'height'])
    {
        if (changes[key] !== undefined)
        {
            before[key] = object[key]; // 위치·크기
        }
    }
    if (changes.style !== undefined)
    {
        before.style = { ...(object.style || {}) }; // 스타일
    }
    if (changes.text !== undefined)
    {
        before.text = object.payload && typeof object.payload.text === 'string' ? object.payload.text : ''; // 메모 글
    }
    return before; // 이전 값 묶음
}

// 되돌려도 되는 객체인지 확인: 없어졌거나, 누가 잡고 있거나, 내 작업 뒤에 버전이 달라졌으면(다른 사람이 수정) null
function undoTarget(id)
{
    const object = canvas.findObject(resolveAlias(idAlias, id)); // 지금 객체
    if (!object || canvas.locks.has(object.object_id) || myVersions.get(object.object_id) !== object.version)
    {
        return null; // 되돌리지 않음
    }
    return object; // 되돌릴 대상
}

// 저장해 둔 내용으로 같은 객체를 새로 만든다(삭제 되돌리기·복제 공용). dx·dy 는 복제할 때 옆으로 옮기는 거리
async function recreateObject(o, dx = 0, dy = 0)
{
    const base = { board_id: boardId(), request_id: nextRequestId() }; // 공통 필드
    let created = null; // 새 객체
    if (o.type === 'stroke')
    {
        const points = ((o.payload && o.payload.points) || []).map(([x, y]) => [x + dx, y + dy]); // 획 좌표
        const strokeId = 'r-' + Date.now().toString(36) + '-' + state.requestSeq; // 임시 획 ID
        const reply = await realtime.request('stroke:commit', { ...base, stroke_id: strokeId, points, style: o.style }); // 획 다시 저장
        created = { object_id: reply.object_id, task_id: null, type: 'stroke', ...strokeBounds(points), payload: { stroke_id: strokeId, points }, style: { ...o.style }, version: reply.new_version }; // 서버가 저장한 것과 같은 모양
    }
    else
    {
        const payloads = {
            image: () => ({ asset_id: o.payload.asset_id }), // 업로드된 이미지 참조
            video: () => ({ source_url: o.payload.source_url }), // 영상 원본 URL(서버가 다시 검증)
            task: () => ({ task_id: o.task_id }), // 공유 업무 참조
            note: () => ({ text: o.payload && typeof o.payload.text === 'string' ? o.payload.text : '' }), // 메모 글
        }; // 유형별 본문
        const reply = await realtime.request('object:create', { ...base, type: o.type, x: o.x + dx, y: o.y + dy, width: o.width, height: o.height, style: o.style, payload: payloads[o.type] ? payloads[o.type]() : undefined }); // 같은 내용으로 다시 생성
        created = reply.object; // 서버가 돌려준 객체
    }
    canvas.addObject(created); // 화면에 추가
    myVersions.set(created.object_id, created.version); // 내가 만든 직후 버전
    return created; // 새 객체
}

async function restoreLink(link)
{
    const from = resolveAlias(idAlias, link.from_object_id); // 출발 객체의 지금 ID
    const to = resolveAlias(idAlias, link.to_object_id); // 도착 객체의 지금 ID
    if (!canvas.findObject(from) || !canvas.findObject(to))
    {
        return false; // 끝 객체가 없으면 연결선을 되살릴 수 없음
    }
    try
    {
        const reply = await realtime.request('link:create', { board_id: boardId(), from_object_id: from, to_object_id: to, label: link.label ?? '', request_id: nextRequestId() }); // 연결선 다시 생성
        canvas.addLink(reply.link); // 화면에 추가
        linkAlias.set(link.link_id, reply.link.link_id); // 예전 ID → 새 ID
        return true;
    }
    catch (err)
    {
        return false; // 복원 실패
    }
}

// 기록 하나를 되돌린다. done: 되돌린 항목 수, skipped: 다른 사람이 손대서(또는 실패해서) 그대로 둔 항목 수,
// inverse: 방금 되돌린 것을 다시 적용하는 기록(다시 실행용. 되돌린 것이 없으면 null). 다시 실행도 이 함수로 처리한다
async function applyUndo(entry)
{
    const result = { done: 0, skipped: 0, inverse: null }; // 결과
    if (entry.kind === 'create')
    {
        const removed = []; // 지운 객체(반대 기록용)
        const removedLinks = new Map(); // 함께 사라진 연결선 link_id → 연결선
        for (const id of entry.ids)
        {
            if (!canvas.findObject(resolveAlias(idAlias, id)))
            {
                continue; // 이미 없어진 객체는 되돌릴 것이 없음
            }
            const object = undoTarget(id); // 되돌릴 대상
            if (!object)
            {
                result.skipped += 1; // 다른 사람이 수정·편집 중
                continue;
            }
            try
            {
                await withLock(object, (token) => realtime.request('object:delete', { board_id: boardId(), object_id: object.object_id, lock_token: token, version: object.version, request_id: nextRequestId() })); // 만든 객체 삭제
                for (const l of canvas.links)
                {
                    if (l.from_object_id === object.object_id || l.to_object_id === object.object_id)
                    {
                        removedLinks.set(l.link_id, { ...l }); // 객체와 함께 지워지는 연결선 기억
                    }
                }
                removed.push(object); // 지운 객체 기억
                canvas.removeObject(object.object_id); // 화면에서 제거
                result.done += 1;
            }
            catch (err)
            {
                result.skipped += 1; // 삭제 실패
            }
        }
        if (removed.length > 0)
        {
            result.inverse = { kind: 'delete', objects: removed, links: [...removedLinks.values()] }; // 반대: 지운 것을 다시 만들기
        }
    }
    else if (entry.kind === 'update')
    {
        const items = []; // 되돌리기 직전 값(반대 기록용)
        for (const item of entry.items)
        {
            const object = undoTarget(item.id); // 되돌릴 대상
            if (!object)
            {
                result.skipped += 1; // 없어졌거나 다른 사람이 수정
                continue;
            }
            try
            {
                const restored = await withLock(object, (token) => commitObject(object, token, item.before, false)); // 이전 값으로 다시 저장(돌려받는 값은 저장 직전의 값)
                if (restored)
                {
                    items.push(restored); // 반대 기록에 추가
                }
                result[restored ? 'done' : 'skipped'] += 1;
            }
            catch (err)
            {
                result.skipped += 1; // 잠금 실패
            }
        }
        if (items.length > 0)
        {
            result.inverse = { kind: 'update', items }; // 반대: 되돌리기 직전 값으로
        }
    }
    else if (entry.kind === 'delete')
    {
        const ids = []; // 다시 만든 객체 ID(반대 기록용)
        for (const o of entry.objects)
        {
            try
            {
                const created = await recreateObject(o); // 지운 객체 다시 생성(새 ID)
                idAlias.set(o.object_id, created.object_id); // 예전 ID → 새 ID
                ids.push(created.object_id); // 반대 기록에 추가
                result.done += 1;
            }
            catch (err)
            {
                result.skipped += 1; // 다시 만들지 못함
            }
        }
        for (const link of entry.links)
        {
            await restoreLink(link); // 함께 사라졌던 연결선 복원(끝 객체가 없으면 건너뜀)
        }
        if (ids.length > 0)
        {
            result.inverse = { kind: 'create', ids }; // 반대: 다시 만든 것을 지우기
        }
    }
    else if (entry.kind === 'link-create')
    {
        const id = resolveAlias(linkAlias, entry.id); // 지금 연결선 ID
        const link = canvas.links.find((l) => l.link_id === id); // 지울 연결선
        if (link)
        {
            try
            {
                await realtime.request('link:delete', { board_id: boardId(), link_id: id, request_id: nextRequestId() }); // 만든 연결선 삭제
                canvas.removeLink(id); // 화면에서 제거
                result.inverse = { kind: 'link-delete', link: { ...link } }; // 반대: 연결선 되살리기
                result.done += 1;
            }
            catch (err)
            {
                result.skipped += 1; // 삭제 실패
            }
        }
    }
    else if (entry.kind === 'link-delete')
    {
        if (await restoreLink(entry.link))
        {
            result.inverse = { kind: 'link-create', id: resolveAlias(linkAlias, entry.link.link_id) }; // 반대: 되살린 연결선 지우기
            result.done += 1;
        }
        else
        {
            result.skipped += 1; // 끝 객체가 없어 되살리지 못함
        }
    }
    else if (entry.kind === 'link-label')
    {
        const id = resolveAlias(linkAlias, entry.id); // 지금 연결선 ID
        const current = canvas.links.find((l) => l.link_id === id); // 바꾸기 전 연결선
        try
        {
            const reply = await realtime.request('link:update', { board_id: boardId(), link_id: id, label: entry.before, request_id: nextRequestId() }); // 이전 라벨로
            canvas.updateLink(reply.link); // 반영
            refreshLinkProps(); // 패널 갱신
            result.inverse = { kind: 'link-label', id, before: current ? current.label ?? '' : '' }; // 반대: 바꾸기 직전 라벨로
            result.done += 1;
        }
        catch (err)
        {
            result.skipped += 1; // 연결선이 없어졌거나 실패
        }
    }
    return result; // 결과
}

// 실행 취소(redo=false) 또는 다시 실행(redo=true) 한 단계. 한쪽 기록에서 꺼내 적용하고, 그 반대 작업을 다른 쪽 기록에 쌓는다
async function stepHistory(redo)
{
    if (undoRunning || move || noteEdit || !canEdit() || !realtime || !realtime.joined)
    {
        return; // 다른 작업 중·권한 없음·미연결
    }
    const entry = (redo ? redoStack : undoStack).pop(); // 가장 최근 기록
    if (!entry)
    {
        updateUndoButton(); // 버튼 상태 갱신
        return toast(redo ? '다시 실행할 작업이 없습니다.' : '되돌릴 작업이 없습니다.'); // 안내
    }
    let result = { done: 0, skipped: 0, inverse: null }; // 결과
    undoRunning = true; // 기록을 적용하는 중(이 동안의 저장은 새 기록으로 쌓지 않음)
    state.pendingSaves += 1; // 저장 대기 표시
    setSaveStatus('saving'); // 저장 중
    try
    {
        result = await applyUndo(entry); // 기록 적용
    }
    catch (err)
    {
        result.skipped += 1; // 예상하지 못한 실패
    }
    finally
    {
        undoRunning = false; // 종료
        if (result.inverse)
        {
            const target = redo ? undoStack : redoStack; // 반대 기록을 쌓을 곳
            target.push(result.inverse); // 되돌린 것은 다시 실행할 수 있게, 다시 실행한 것은 다시 되돌릴 수 있게
            if (target.length > UNDO_LIMIT)
            {
                target.shift(); // 오래된 기록부터 버림
            }
        }
        state.pendingSaves -= 1; // 대기 수 감소
        if (state.pendingSaves === 0 && $('save-status').dataset.state !== 'failed')
        {
            setSaveStatus('saved'); // 모두 저장됨
        }
        updateUndoButton(); // 버튼 상태 갱신
        setSelection([...canvas.selectedIds].filter((id) => canvas.findObject(id))); // 사라진 객체는 선택에서 제외
    }
    const verb = redo ? '다시 실행' : '실행 취소'; // 안내에 쓸 낱말
    if (result.skipped === 0)
    {
        toast(verb + '했습니다.'); // 모두 적용
    }
    else if (result.done === 0)
    {
        toast('다른 사용자가 이후에 수정했거나 편집 중이라 ' + (redo ? '다시 실행하지' : '되돌리지') + ' 않았습니다.', 4000); // 적용하지 않음
    }
    else
    {
        toast('일부만 ' + (redo ? '다시 실행했습니다' : '되돌렸습니다') + '. 다른 사용자가 이후에 수정한 항목은 그대로 둡니다.', 4000); // 일부만
    }
}

function undoLast()
{
    return stepHistory(false); // 실행 취소
}

function redoLast()
{
    return stepHistory(true); // 다시 실행
}

async function duplicateSelected()
{
    const list = selectedObjects(); // 복제 대상
    if (list.length === 0 || undoRunning || move || noteEdit || !canEdit() || !realtime || !realtime.joined)
    {
        return; // 대상 없음·다른 작업 중
    }
    const ids = []; // 새로 만든 객체
    state.pendingSaves += 1; // 저장 대기 표시
    setSaveStatus('saving'); // 저장 중
    for (const o of list)
    {
        try
        {
            ids.push((await recreateObject(o, 20, 20)).object_id); // 오른쪽 아래로 20 옮긴 사본
        }
        catch (err)
        {
            toast('복제 실패: ' + err.message, 4000); // 안내
        }
    }
    state.pendingSaves -= 1; // 대기 수 감소
    if (state.pendingSaves === 0)
    {
        setSaveStatus(ids.length === list.length ? 'saved' : 'failed'); // 결과 표시
    }
    if (ids.length > 0)
    {
        pushUndo({ kind: 'create', ids }); // 복제도 한 번에 되돌릴 수 있게 기록
        setSelection(ids); // 사본을 선택(바로 옮길 수 있게)
    }
}

function exportBoard()
{
    const url = canvas ? canvas.exportDataUrl() : null; // PNG 데이터
    if (!url)
    {
        return toast('내보낼 객체가 없습니다.'); // 빈 보드
    }
    const title = (state.board ? state.board.title : 'board').replace(/[\\/:*?"<>|]/g, '_').trim() || 'board'; // 파일 이름에 쓸 수 없는 문자 치환
    const link = document.createElement('a'); // 내려받기 링크
    link.href = url; // 그림 데이터
    link.download = 'TaskCanvas_' + title + '.png'; // 파일 이름
    document.body.appendChild(link); // 문서에 추가
    link.click(); // 내려받기 시작
    link.remove(); // 임시 링크 제거
    toast('보드를 PNG 로 저장했습니다. 영상은 자리 표시만 그려집니다.'); // 안내
}

$('tool-undo').addEventListener('click', () => undoLast()); // 실행 취소 버튼
$('tool-redo').addEventListener('click', () => redoLast()); // 다시 실행 버튼
$('tool-export').addEventListener('click', exportBoard); // PNG 내보내기 버튼

// ---------- 메모 글 편집 ----------

async function beginNoteEdit(object, isNew = false)
{
    if (!canEdit() || !realtime || !realtime.joined || noteEdit)
    {
        return; // 권한 없음·미연결·이미 편집 중
    }
    if (canvas.locks.has(object.object_id))
    {
        return toast(canvas.locks.get(object.object_id).display_name + ' 님이 편집 중인 객체입니다.'); // 타인 잠금
    }
    cancelMove(); // 더블클릭의 두 번째 클릭이 시작한 이동 세션 취소
    await whenIdle(); // 앞선 잠금 요청·반납이 끝난 뒤에 새 잠금 요청(서버 도착 순서 보장)
    const current = canvas.findObject(object.object_id); // 최신 객체
    if (!current || noteEdit || move)
    {
        return; // 그 사이 삭제되었거나 다른 작업이 시작됨
    }
    let reply = null; // 잠금 응답
    busyOps += 1; // 잠금 요청 진행 중
    try
    {
        reply = await realtime.request('object:lock', { board_id: boardId(), object_id: current.object_id }); // 글 수정용 선점 잠금
    }
    catch (err)
    {
        return toast(lockMessage(err)); // 잠금 실패 안내
    }
    finally
    {
        busyOps -= 1; // 잠금 요청 종료
    }
    const area = $('note-editor'); // 글 입력 요소
    noteEdit = {
        object: current, // 편집 대상
        token: reply.lock_token, // 잠금 토큰
        isNew, // 방금 만든 메모인지(비워 두면 삭제)
        heartbeat: setInterval(() => realtime.emit('object:preview', { board_id: boardId(), object_id: current.object_id, lock_token: reply.lock_token, x: current.x, y: current.y }), 10000), // 입력이 길어져도 잠금이 만료되지 않게 10초마다 연장
    }; // 편집 상태
    setSelection([current.object_id]); // 선택 표시
    canvas.editingId = current.object_id; // 캔버스는 편집 중인 메모의 글을 그리지 않음
    area.value = current.payload && typeof current.payload.text === 'string' ? current.payload.text : ''; // 현재 글
    area.hidden = false; // 입력 표시
    positionNoteEditor(); // 메모 위에 겹쳐 배치
    canvas.invalidate(); // 다시 그리기
    area.focus({ preventScroll: true }); // 바로 입력 가능(화면 밖에 걸친 메모여도 영역을 스크롤하지 않음)
    area.setSelectionRange(area.value.length, area.value.length); // 커서를 글 끝으로
}

function positionNoteEditor()
{
    if (!noteEdit)
    {
        return; // 편집 중 아님
    }
    const o = canvas.findObject(noteEdit.object.object_id) ?? noteEdit.object; // 최신 객체
    const r = canvas.displayRect(o); // 표시 사각형
    const s = canvas.toScreen(r.x, r.y); // 화면 좌표
    const scale = canvas.view.scale; // 확대 배율
    const n = BoardCanvas.NOTE; // 안쪽 여백
    const f = BoardCanvas.noteFont(o); // 글자 크기·줄 높이
    const area = $('note-editor'); // 글 입력 요소
    area.style.transform = 'translate(' + s.x + 'px, ' + s.y + 'px)'; // 위치
    area.style.width = r.width * scale + 'px'; // 너비
    area.style.height = r.height * scale + 'px'; // 높이
    area.style.fontSize = f.size * scale + 'px'; // 글자 크기
    area.style.lineHeight = f.line * scale + 'px'; // 줄 높이
    area.style.padding = Math.max(0, n.pad * scale - 2) + 'px'; // 테두리 2px 를 뺀 안쪽 여백
    area.style.background = (o.style && o.style.fill) || '#ffffff'; // 메모 배경
    area.style.color = (o.style && o.style.color) || '#222222'; // 글자 색
}

async function finishNoteEdit(save)
{
    if (!noteEdit)
    {
        return; // 편집 중 아님
    }
    const edit = noteEdit; // 끝낼 편집
    const area = $('note-editor'); // 글 입력 요소
    const text = area.value; // 입력한 글
    noteEdit = null; // 편집 종료(입력을 숨길 때 blur 가 다시 불러도 무시되게 먼저 비움)
    clearInterval(edit.heartbeat); // 잠금 연장 중지
    canvas.editingId = null; // 캔버스가 다시 글을 그림
    area.hidden = true; // 입력 숨김
    canvas.invalidate(); // 다시 그리기
    const o = canvas.findObject(edit.object.object_id); // 최신 객체
    if (!o || !realtime || !realtime.joined)
    {
        return; // 삭제되었거나 연결이 끊김(잠금은 서버가 정리, 저장 전 글은 복구하지 않음)
    }
    const lockRef = { board_id: boardId(), object_id: o.object_id, lock_token: edit.token }; // 잠금 식별 정보
    const before = o.payload && typeof o.payload.text === 'string' ? o.payload.text : ''; // 기존 글
    if (edit.isNew && text.trim() === '')
    {
        busyOps += 1; // 삭제 진행 중
        try
        {
            await realtime.request('object:delete', { ...lockRef, version: o.version, request_id: nextRequestId() }); // 방금 만든 메모를 비워 둔 채 끝내면 삭제
            canvas.removeObject(o.object_id); // 화면에서 제거
            dropCreateEntry(o.object_id); // 만들자마자 사라진 메모는 실행 취소 기록에 남기지 않음
            setSelection([]); // 선택 해제
        }
        catch (err)
        {
            realtime.emit('object:unlock', lockRef); // 삭제 실패 시 잠금만 반납
        }
        finally
        {
            busyOps -= 1; // 삭제 종료
        }
        return;
    }
    if (!save || text === before)
    {
        realtime.emit('object:unlock', lockRef); // 변경 없음·취소 → 잠금 해제
        return;
    }
    const changes = { text }; // 글 변경
    const needed = canvas.noteHeightFor(text, o.width, BoardCanvas.noteFont(o).size); // 글이 모두 보이는 높이
    if (needed > o.height)
    {
        changes.height = needed; // 글이 넘치면 메모를 아래로 늘림
    }
    await commitObject(o, edit.token, changes, !edit.isNew); // 저장(성공하면 잠금 해제). 새 메모의 첫 글은 생성 기록에 포함되어 한 번에 되돌려짐
}

function attachNoteEditor()
{
    const area = $('note-editor'); // 글 입력 요소
    area.addEventListener('blur', () => finishNoteEdit(true)); // 바깥을 누르면 저장
    area.addEventListener('keydown', (e) =>
    {
        e.stopPropagation(); // 도구 단축키로 전달되지 않게
        if (e.key === 'Escape')
        {
            e.preventDefault(); // 기본 동작 방지
            finishNoteEdit(false); // 취소
        }
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey))
        {
            e.preventDefault(); // 줄바꿈 방지
            finishNoteEdit(true); // Ctrl+Enter 저장
        }
    });
    $('board-canvas').addEventListener('pointerdown', () => finishNoteEdit(true), true); // 캔버스를 누르면 저장부터 하고 그 클릭을 처리(blur 이벤트에만 기대지 않음)
    const stage = document.querySelector('.stage'); // 캔버스 영역
    stage.addEventListener('scroll', () =>
    {
        stage.scrollLeft = 0; // 입력 중 커서를 따라 영역이 밀리면 캔버스와 좌표가 어긋나므로 되돌림
        stage.scrollTop = 0; // (overflow: clip 을 지원하지 않는 브라우저 대비)
    });
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
        pushUndo({ kind: 'link-create', id: reply.link.link_id }); // 실행 취소 기록
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
    const previous = canvas.links.find((l) => l.link_id === linkId); // 바꾸기 전 연결선
    const before = previous && previous.label ? previous.label : ''; // 이전 라벨
    try
    {
        const reply = await realtime.request('link:update', { board_id: boardId(), link_id: linkId, label: $('link-label').value.trim(), request_id: nextRequestId() }); // 라벨 저장
        canvas.updateLink(reply.link); // 반영
        if ((reply.link.label ?? '') !== before)
        {
            pushUndo({ kind: 'link-label', id: linkId, before }); // 실행 취소 기록
        }
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
    const removedLink = canvas.links.find((l) => l.link_id === linkId); // 지우기 전 연결선
    try
    {
        await realtime.request('link:delete', { board_id: boardId(), link_id: linkId, request_id: nextRequestId() }); // 연결선 삭제
        canvas.removeLink(linkId); // 화면에서 제거
        if (removedLink)
        {
            pushUndo({ kind: 'link-delete', link: { ...removedLink } }); // 실행 취소 기록
        }
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
    if (canvas)
    {
        canvas.invalidate(); // 업무 블럭 다시 그리기(작업실에서는 캔버스가 아직 없을 수 있음)
    }
}

function fillAssigneeSelects()
{
    for (const id of ['task-assignee', 'task-new-assignee', 'ws-task-assignee'])
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
        shownTaskKey = null; // 다시 고르면 입력란을 새로 채움
        return;
    }
    const key = task.task_id + ':' + task.version; // 지금 보여 줄 업무와 버전
    if (key !== shownTaskKey)
    {
        shownTaskKey = key; // 채운 내용 기억
        $('task-title').value = task.title; // 제목
        $('task-status').value = task.status; // 상태
        $('task-assignee').value = task.assignee_id === null ? '' : String(task.assignee_id); // 담당자
        $('task-due').value = task.due_at ?? ''; // 마감일
    }
    if (!taskChecklist)
    {
        taskChecklist = Checklist.mount($('task-checklist'), checklistActions); // 처음 한 번만 만듦
    }
    taskChecklist.render(task, canEdit() && !!realtime && realtime.joined); // 체크리스트(버전이 같아도 항목은 바뀔 수 있으므로 매번 그림)
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
    $('task-delete').addEventListener('click', () =>
    {
        const o = selectedTaskObject(); // 선택한 업무 블럭
        const task = o ? state.tasks.get(o.task_id) : null; // 업무 원본
        if (task && canEdit())
        {
            openTaskDelete(task); // 삭제 확인
        }
    });
    $('prop-snap').addEventListener('change', (e) => { state.snap = e.target.checked; }); // 격자 맞춤
}

// ---------- 도구 → 실시간 이벤트 ----------

function nextRequestId()
{
    state.requestSeq += 1; // 일련번호 증가
    return 'req-' + Date.now().toString(36) + '-' + state.requestSeq; // 요청 ID
}

async function createObject(event, data, draft, record = true)
{
    const requestId = nextRequestId(); // 요청 ID
    canvas.pending.set(requestId, draft); // 저장 대기 표시
    state.pendingSaves += 1; // 대기 수 증가
    setSaveStatus('saving'); // 저장 중 표시
    try
    {
        const reply = await realtime.request(event, { ...data, board_id: boardId(), request_id: requestId }); // 서버 확정 요청
        const created = reply.object ?? { ...draft, object_id: reply.object_id, version: reply.new_version }; // 확정 객체
        canvas.pending.delete(requestId); // 대기 해제
        canvas.addObject(created); // 확정 객체 반영
        myVersions.set(created.object_id, created.version); // 내가 만든 직후 버전
        if (record)
        {
            pushUndo({ kind: 'create', ids: [created.object_id] }); // 실행 취소 기록
        }
        state.pendingSaves -= 1; // 대기 수 감소
        if (state.pendingSaves === 0)
        {
            setSaveStatus('saved'); // 모두 저장됨
        }
        return created; // 만든 객체(메모는 이어서 글 입력)
    }
    catch (err)
    {
        canvas.pending.delete(requestId); // 대기 해제(초안 폐기)
        canvas.invalidate(); // 다시 그리기
        state.pendingSaves -= 1; // 대기 수 감소
        setSaveStatus('failed'); // 저장 실패 표시
        toast('저장 실패: ' + err.message, 4000); // 안내
        return null; // 생성 실패
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
    onNoteCreate: async (draft) =>
    {
        setTool('select'); // 메모를 놓은 뒤에는 선택 도구로(글 입력을 끝내려고 바깥을 눌러도 새 메모가 생기지 않게)
        const created = await createObject('object:create', { type: 'note', x: draft.x, y: draft.y, width: draft.width, height: draft.height, style: draft.style, payload: { text: '' } }, draft); // 빈 메모 저장
        if (created)
        {
            beginNoteEdit(created, true); // 바로 글 입력
        }
    },
    onDoubleClick: (hit) =>
    {
        if (hit.type === 'note')
        {
            beginNoteEdit(hit); // 메모 글 수정
        }
    },
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
    onResizeDown: (object, corner, w) =>
    {
        if (move || canvas.locks.has(object.object_id))
        {
            return false; // 다른 작업 처리 중이거나 타인이 잠근 객체
        }
        beginResize(object, corner, w); // 잠금 요청 후 크기 조절 시작
        return true;
    },
    onResizeMove: (w, shift) => updateMove(w, shift), // 크기 조절 중
    onSelectUp: () => endMove(), // 이동·크기 조절 확정
    onEscape: () =>
    {
        stopFollow('따라가기를 멈췄습니다.'); // 따라가는 중이면 해제
        cancelMove(); // 이동 취소
        setSelection([]); // 선택 해제
    },
    onCanvasTouch: () => stopFollow('보드를 직접 움직여 따라가기를 멈췄습니다.'), // 보드를 누르거나 휠을 굴리면 내 화면은 내가 정함
    onDeleteKey: () => deleteSelected(), // 선택 객체 삭제
    onUndo: () => undoLast(), // Ctrl+Z
    onRedo: () => redoLast(), // Ctrl+Y, Ctrl+Shift+Z
    onDuplicate: () => duplicateSelected(), // Ctrl+D
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
    getTicket: async (scope) =>
    {
        const data = await window.api.post('/api/realtime-ticket', scope); // 티켓 발급({board_id})
        return data.ticket; // 티켓 원문
    },
    onStatus: (name) => setConnection(name), // 연결 상태
    onRefused: () => toast('실시간 서버에 연결하지 못했습니다. 주소 끝에 /check.html 을 붙여 접속 점검을 열면 원인을 볼 수 있습니다.', 8000), // 첫 연결 실패 안내(원인은 점검 화면이 구분해 줌)
    onJoined: async (reply, rejoined) =>
    {
        renderParticipants(reply.participants); // 참여자 표시
        if (reply.board_title && state.board)
        {
            applyBoardTitle(state.board.board_id, reply.board_title); // 작업실을 본 뒤 이름이 바뀌었으면 최신 이름으로
        }
        if (rejoined)
        {
            cancelMove(); // 끊긴 동안의 이동은 폐기
            finishNoteEdit(false); // 끊긴 동안의 메모 편집도 폐기(잠금은 서버에서 이미 해제됨)
            clearUndo(); // 다시 불러온 상태와 맞지 않을 수 있는 기록은 버림
            await loadSnapshot(); // 재접속 시 서버의 마지막 저장 상태로 복원
            await loadProjectData(); // 참여자·업무 목록도 다시 조회
            toast('재접속되었습니다. 마지막 저장 상태를 불러왔습니다.'); // 안내
        }
        canvas.setLocks(reply.locks); // 현재 잠금 표시
        sentSelection = ''; // 새 연결의 서버는 내 선택을 모름
        announceSelection(); // 이미 고른 것이 있으면(재접속) 다시 알림
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
        if (err instanceof window.api.ApiError && err.status === 404)
        {
            returnToWorkspace('보드를 찾을 수 없어 작업실로 돌아왔습니다. 삭제되었을 수 있습니다.'); // 삭제된 보드
            return;
        }
        toast('보드 참여 실패: ' + err.message, 5000); // 안내
    },
    onPresence: (participants) => renderParticipants(participants), // 참여자 갱신
    onCursor: (data) =>
    {
        canvas.setCursor(data); // 타인 커서
        noteCursor(data); // 위치 기억, 따라가는 대상이면 화면 이동
    },
    onSelection: (data) => canvas.setRemoteSelection(data), // 타인이 고른 객체·연결선
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
        if (noteEdit && noteEdit.object.object_id === data.object_id && data.reason === 'expired')
        {
            finishNoteEdit(false); // 내 잠금 만료 → 메모 편집 취소
            toast('잠금 시간이 지나 메모 편집이 취소되었습니다.'); // 안내
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
        const preview = { x: data.x, y: data.y }; // 타인 이동 중 위치
        if (data.width !== undefined && data.height !== undefined)
        {
            preview.width = data.width; // 타인 크기 조절 중 너비
            preview.height = data.height; // 타인 크기 조절 중 높이
        }
        canvas.moves.set(data.object_id, preview); // 미리보기 반영
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
        if (noteEdit && noteEdit.object.object_id === id)
        {
            finishNoteEdit(false); // 편집 중이던 메모가 삭제됨
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
    onTaskDeleted: (taskId) =>
    {
        const task = state.tasks.get(taskId); // 지워진 업무(안내에 쓸 이름)
        forgetTask(taskId, task ? "'" + task.title + "' 업무를 다른 사람이 삭제했습니다." : null); // 업무와 이 보드의 블럭을 화면에서 치움
    },
    onProjectDeleted: (data) =>
    {
        if (state.project && data.project_id === state.project.project_id)
        {
            leaveDeletedWorkspace('이 작업실은 관리자가 삭제했습니다.'); // 보던 보드를 닫고 소개 화면으로
        }
    },
    onBoardRenamed: (data) =>
    {
        applyBoardTitle(data.board_id, data.title); // 작업실에서 바뀐 이름 반영
        toast("보드 이름이 '" + data.title + "'(으)로 바뀌었습니다."); // 안내
    },
    onBoardDeleted: (data) =>
    {
        if (state.board && state.board.board_id === data.board_id)
        {
            returnToWorkspace('열려 있던 보드가 삭제되어 작업실로 돌아왔습니다.'); // 삭제된 보드에서 나가기
        }
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

window.addEventListener('pagehide', () =>
{
    if (state.board && canvas && !$('view-board').hidden)
    {
        rememberBoard(state.board.board_id, canvas.view); // 새로고침·탭 이동 직전의 위치·배율까지 기억
    }
});

bootstrap(); // 시작
