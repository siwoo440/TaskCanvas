// 발표·문서용 실제 화면 캡처: 서버를 임시 포트로 띄우고 설치된 Chrome 을 조작해 assets/screenshots 에 PNG 로 저장한다
// 사용법: npm run capture   (MariaDB 실행 중, DB 스키마 적용 필요)
//   CHROME_BIN: Chrome·Edge 실행 파일 경로, PHP_BIN: PHP 실행 파일 경로, DB_NAME: 다른 DB 에서 찍고 싶을 때
// 실행할 때마다 '시연 프로젝트' 가 하나 새로 생긴다(예시 보드 포함). 찍는 김에 실제 입력으로 업무 현황판·선택 표시·체크리스트·업무 삭제·메모 저장·글자 크기·실행 취소·다시 실행·작업실 직접 만들기와 삭제도 확인한다. 직접 만든 작업실('나만의 작업실')은 마지막에 화면에서 지운다
'use strict';

const fs = require('fs'); // 파일 쓰기
const path = require('path'); // 경로 계산
const puppeteer = require('puppeteer-core'); // 설치된 브라우저 조작(브라우저를 내려받지 않음)
const { ROOT, wait, findChrome, waitFor, startServers, phpCli, newUser, joinWorkspace, openBoard, screenPoint, findObject, centerOf, waitTaskBoard, taskCards, dragCard, checklistItems, clickChecklist, addChecklistItem, renameChecklistItem } = require('./lib/browser-kit'); // 리허설 스크립트와 함께 쓰는 도우미

const OUT = path.join(ROOT, 'assets', 'screenshots'); // 캡처 저장 폴더
const API_PORT = Number(process.env.CAP_API_PORT || 8082); // 캡처용 PHP 포트
const RT_PORT = Number(process.env.CAP_RT_PORT || 3003); // 캡처용 실시간 포트
const BASE = 'http://127.0.0.1:' + API_PORT; // 접속 주소
const USER = { rtPort: RT_PORT, view: { width: 1280, height: 800, deviceScaleFactor: 2 } }; // 탭 설정(2배 해상도로 저장)

const checks = []; // 실제 입력 확인 결과

function check(label, ok)
{
    checks.push({ label, ok }); // 결과 기록
    console.log((ok ? 'PASS ' : 'FAIL ') + label); // 즉시 출력
}

function setupProject()
{
    const out = phpCli('create-project.php', ['시연 프로젝트', '기획 보드', '개발 보드']); // 프로젝트·보드 생성
    const projectId = Number(/project_id=(\d+)/.exec(out)[1]); // 프로젝트 ID
    const adminCode = /관리자 초대 코드: (\S+)/.exec(out)[1]; // 관리자 코드(화면에는 찍지 않음)
    console.log(phpCli('seed-demo.php', [String(projectId)]).trim()); // 예시 보드 채우기
    const editorCode = /초대 코드: (\S+)/.exec(phpCli('create-invite.php', [String(projectId), 'editor', '1']))[1]; // 편집자 코드
    return { projectId, adminCode, editorCode }; // 캡처 환경
}

async function shot(page, name)
{
    const file = path.join(OUT, name + '.png'); // 저장 경로
    await page.screenshot({ path: file }); // 보이는 화면 캡처
    console.log('saved assets/screenshots/' + name + '.png'); // 저장 안내
}

const snapshotCount = (page) => page.evaluate(async () => (await window.api.get('/api/boards/' + state.board.board_id + '/snapshot')).objects.length); // 서버에 저장된 객체 수

// ---------- 캡처 순서 ----------

async function capture(browser, env)
{
    const a = await newUser(browser, USER); // 관리자 '기획 담당'
    const b = await newUser(browser, USER); // 편집자 '프론트 담당'

    // 1) 소개 페이지, 입장 화면
    await a.goto(BASE + '/'); // 첫 화면
    await a.waitForSelector('#home-intro', { visible: true }); // 소개 구성 대기
    await shot(a, '01-intro'); // 소개 홈페이지

    // 실제 입력 확인: 소개의 기능 카드를 화살표·점·방향키로 넘기면 그 카드가 화면에 들어오고, 끝에서는 처음으로 이어지는지
    const featureShown = (title) => a.waitForFunction((want) =>
    {
        const car = document.getElementById('feature-carousel'); // 넘겨 보는 카드
        const stage = car.querySelector('.carousel-track').getBoundingClientRect(); // 보이는 영역
        const inView = [...car.querySelectorAll('.feature-card')].filter((card) => { const r = card.getBoundingClientRect(); return r.left >= stage.left - 1 && r.right <= stage.right + 1; }).map((card) => card.querySelector('h3').textContent); // 온전히 보이는 카드
        return !car.carousel.state.moving && inView.length === 1 && inView[0] === want; // 넘기기가 끝나고 그 카드만 보임
    }, { timeout: 5000 }, title).then(() => a.$eval('#feature-carousel .carousel-count', (el) => el.textContent), () => 'timeout'); // 통과하면 "n / 6" 표시, 아니면 timeout
    const flips = []; // 넘길 때마다의 표시
    await a.click('#feature-carousel .carousel-arrow.next'); // 오른쪽 화살표
    flips.push(await featureShown('겹치지 않는 편집'));
    await a.click('#feature-carousel .carousel-dot:nth-child(4)'); // 네 번째 점
    flips.push(await featureShown('여러 보드가 공유하는 업무'));
    await a.focus('#feature-carousel .carousel-track'); // 카드 영역에 초점
    await a.keyboard.press('ArrowRight'); // 방향키
    flips.push(await featureShown('연결선과 다중 선택'));
    await a.click('#feature-carousel .carousel-arrow.next'); // 마지막 카드로
    flips.push(await featureShown('놓는 순간 저장'));
    await a.click('#feature-carousel .carousel-arrow.next'); // 마지막에서 다음 → 처음
    flips.push(await featureShown('그리는 순간 함께 보기'));
    await a.click('#feature-carousel .carousel-arrow.prev'); // 처음에서 이전 → 마지막
    flips.push(await featureShown('놓는 순간 저장'));
    check('기능 카드: 화살표·점·방향키로 넘기면 그 카드가 보이고 끝과 처음이 이어짐', flips.join(',') === '2 / 6,4 / 6,5 / 6,6 / 6,1 / 6,6 / 6' && (await a.$$eval('#feature-carousel .carousel-dot', (els) => els.length)) === 6);
    await a.click('#home-enter-top'); // 입장하기
    await a.waitForSelector('#view-join', { visible: true }); // 입장 화면 대기
    await a.type('#join-code', 'XXXX-XXXX-XXXX'); // 화면에는 실제 코드 대신 자리 표시 글만 찍음
    await a.type('#join-name', '기획 담당'); // 표시 이름
    await shot(a, '02-join'); // 입장 화면
    await a.$eval('#join-name', (el) => { el.value = ''; }); // 이름은 아래에서 다시 입력
    await joinWorkspace(a, '기획 담당', env.adminCode); // 관리자로 입장

    // 2) 두 번째 사용자는 초대 링크로 입장
    await b.goto(BASE + '/#code=' + env.editorCode); // 초대 링크
    await b.waitForSelector('#view-join', { visible: true }); // 소개를 건너뛰고 입장 화면
    check('초대 링크: 코드 자동 입력 후 주소에서 제거', (await b.$eval('#join-code', (el) => el.value)) === env.editorCode && !b.url().includes('code=')); // 링크 동작 확인
    await joinWorkspace(b, '프론트 담당', null); // 편집자로 입장

    // 3) 작업실(관리자), 초대 코드 관리
    await a.reload(); // 참여자 목록에 두 번째 사용자 반영
    await a.waitForSelector('#home-workspace', { visible: true }); // 작업실 대기
    await a.waitForFunction(() => document.querySelectorAll('#ws-members li').length >= 2); // 참여자 표시 대기
    await waitTaskBoard(a, 4); // 업무 현황판의 카드 네 장과 실시간 연결 대기
    await a.mouse.move(640, 20); // 마우스는 상단으로 치움(카드 강조가 찍히지 않게)
    await shot(a, '03-workspace'); // 작업실(보드 목록과 업무 현황판)
    await (await a.$('#invite-admin')).screenshot({ path: path.join(OUT, '04-invite-admin.png') }); // 초대 코드 관리(코드는 발급하지 않아 화면에 원문 없음)
    console.log('saved assets/screenshots/04-invite-admin.png');

    // 4) 화이트보드: 두 사람이 같은 보드에
    await openBoard(b, '기획 보드'); // 편집자 입장

    // 실제 입력 확인: 관리자가 작업실 현황판에서 카드를 끌어 옮기면 보드에 있는 편집자의 화면에도 전달되는지
    const TASK = '실시간 서버 방 구현'; // 옮겨 볼 업무(예시에서는 '할 일', 마감 이틀 전)
    const statusOnBoard = (want) => b.waitForFunction((title, status) => [...state.tasks.values()].some((t) => t.title === title && t.status === status), {}, TASK, want); // 보드 화면의 업무 상태 대기
    const seeded = await taskCards(a); // 옮기기 전 카드
    await dragCard(a, TASK, 'doing'); // 진행 중 열로 끌어 놓기
    await statusOnBoard('doing'); // 보드에 있는 편집자에게 전달
    const dragged = await taskCards(a); // 옮긴 뒤 카드
    check('업무 현황판: 카드를 끌어 놓으면 상태가 바뀌고 보드 화면에도 전달됨, 마감 임박·지남 표시', seeded[TASK].status === 'todo' && seeded[TASK].due === 'soon:D-2' && seeded['발표 자료 초안'].due === 'overdue:1일 지남'
        && dragged[TASK].status === 'doing' && (await a.$eval('#ws-task-error', (el) => el.textContent)) === '');
    await dragCard(a, TASK, 'todo'); // 정리: 원래 열로(이후 캡처가 예시 그대로 찍히게)
    await statusOnBoard('todo'); // 되돌린 것도 전달
    await a.waitForFunction((title) => [...document.querySelectorAll('#ws-taskboard .tb-col[data-status="todo"] .tb-card strong')].some((el) => el.textContent === title), {}, TASK); // 작업실 화면도 원래대로

    // 실제 입력 확인: 카드를 눌러 수정. 대화상자를 연 사이 보드의 편집자가 같은 업무를 바꾸면 덮어쓰지 않고 최신 내용으로 다시 채우는지
    const openCard = async () =>
    {
        const at = await a.evaluate((title) =>
        {
            const r = [...document.querySelectorAll('#ws-taskboard .tb-card')].find((el) => el.querySelector('strong').textContent === title).getBoundingClientRect(); // 카드 위치
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, TASK);
        await a.mouse.click(at.x, at.y); // 끌지 않고 누르기
        await a.waitForSelector('#ws-task-dialog[open]'); // 업무 대화상자
    }; // 카드 열기
    const saveDialog = async (due, assignee) =>
    {
        await a.$eval('#ws-task-due', (el, value) => { el.value = value; }, due); // 마감일(날짜 입력란은 지역 설정마다 입력 순서가 달라 값을 직접 넣음)
        if (assignee !== undefined)
        {
            await a.select('#ws-task-assignee', assignee); // 담당자
        }
        await a.click('#ws-task-form button[type="submit"]'); // 저장
    }; // 대화상자 저장
    const dueOnBoard = (want) => b.waitForFunction((title, due) => [...state.tasks.values()].some((t) => t.title === title && t.due_at === due && (t.assignee_id === null) === (due !== new Date().toLocaleDateString('sv-SE'))), {}, TASK, want); // 보드 화면의 마감일(오늘로 바꾼 동안에는 담당자도 있어야 함)
    const today = await a.evaluate(() => new Date().toLocaleDateString('sv-SE')); // 이 PC 의 오늘(YYYY-MM-DD)
    await openCard(); // 관리자가 카드를 열어 둠
    const opened = { title: await a.$eval('#ws-task-title', (el) => el.value), due: await a.$eval('#ws-task-due', (el) => el.value) }; // 대화상자에 채워진 값
    await b.evaluate(async (title) =>
    {
        const t = [...state.tasks.values()].find((x) => x.title === title); // 같은 업무
        const reply = await realtime.request('task:update', { board_id: state.board.board_id, task_id: t.task_id, version: t.version, changes: { assignee_id: state.guest.guest_id }, request_id: 'capture-first' }); // 그 사이 편집자가 담당자를 자기로 바꿈
        state.tasks.set(reply.task.task_id, reply.task); // 편집자 화면 반영
    }, TASK);
    await saveDialog(today); // 예전 버전을 본 채로 저장 시도
    await a.waitForFunction(() => document.getElementById('ws-task-dialog-error').textContent.includes('먼저')); // 충돌 안내
    const refilled = { open: await a.$eval('#ws-task-dialog', (el) => el.open), due: await a.$eval('#ws-task-due', (el) => el.value), assignee: await a.$eval('#ws-task-assignee', (el) => el.selectedOptions[0].textContent) }; // 다시 채워진 값
    await saveDialog(today); // 최신 내용을 확인하고 다시 저장
    await a.waitForFunction(() => !document.getElementById('ws-task-dialog').open); // 저장되어 닫힘
    await dueOnBoard(today); // 보드 화면에도 전달
    const edited = (await taskCards(a))[TASK]; // 고친 뒤 카드
    check('업무 수정: 카드를 눌러 고치고, 그 사이 다른 사람이 바꾼 업무는 덮어쓰지 않고 최신 내용으로 다시 채움', opened.title === TASK && opened.due !== '' && opened.due !== today
        && refilled.open && refilled.due === opened.due && refilled.assignee === '프론트 담당' && edited.due === 'today:오늘 마감' && edited.status === 'todo');
    await openCard(); // 정리: 마감일과 담당자를 예시 그대로
    await saveDialog(opened.due, ''); // 원래 마감일, 담당자 없음
    await a.waitForFunction(() => !document.getElementById('ws-task-dialog').open); // 닫힘
    await dueOnBoard(opened.due); // 보드 화면도 원래대로
    await a.evaluate(() => window.scrollTo(0, 0)); // 끌 때 내려간 화면을 맨 위로
    await openBoard(a, '기획 보드'); // 관리자 입장
    await a.waitForFunction(() => document.querySelectorAll('#participants li').length === 2); // 참여자 2명 표시 대기
    const cursorAt = await screenPoint(b, 660, 500); // 편집자 커서를 둘 곳(빈 영역)

    // 실제 입력 확인: 편집자가 메모를 눌러 고르면 관리자 화면에 그 사람의 이름과 색으로 표시되고, 풀면 사라지는지
    await b.click('#toolbar [data-tool="select"]'); // 편집자는 선택 도구
    const picked = await findObject(b, '아이디어'); // 고를 메모
    const pickAt = await centerOf(b, '아이디어'); // 메모 가운데
    await b.mouse.move(pickAt.x - 40, pickAt.y - 30); // 커서 이동 시작
    await b.mouse.move(pickAt.x, pickAt.y, { steps: 8 }); // 메모 위로(커서 위치 공유)
    await b.mouse.click(pickAt.x, pickAt.y); // 눌러서 선택
    await b.mouse.move(pickAt.x + 46, pickAt.y + 28, { steps: 4 }); // 커서를 조금 비켜 둠
    await a.mouse.move(640, 20); // 관리자 마우스는 상단으로 치움
    const shownTo = (id) => a.evaluate((oid) =>
    {
        const mine = state.guest.guest_id; // 관리자 자신
        const other = participants.find((p) => p.guest_id !== mine); // 편집자
        const sel = other ? canvas.selections.get(other.guest_id) : null; // 관리자 화면에 표시된 편집자의 선택
        return { cursors: canvas.cursors.size, named: !!sel && sel.display_name === other.display_name && sel.color === other.color, ids: sel ? sel.object_ids : [], mineSelected: canvas.selectedIds.has(oid) };
    }, id); // 관리자 화면의 표시 상태
    await a.waitForFunction((id) => canvas.cursors.size === 1 && canvas.locks.size === 0 && [...canvas.selections.values()].some((s) => s.object_ids.includes(id)), {}, picked.id); // 상대 커서와 선택 표시 대기(누르는 동안의 잠금은 풀린 뒤)
    const whilePicked = await shownTo(picked.id); // 고른 동안
    await wait(200); // 그리기 여유
    await shot(a, '05-board'); // 화이트보드 전체(상대 커서와 상대가 고른 메모 포함)
    await b.keyboard.press('Escape'); // 편집자가 선택을 풂
    await a.waitForFunction(() => canvas.selections.size === 0); // 표시 사라짐
    const afterEscape = await shownTo(picked.id); // 푼 뒤
    check('선택 표시: 다른 사람이 고른 메모가 그 사람의 이름과 색으로 표시되고, 풀면 사라짐', whilePicked.cursors === 1 && whilePicked.named && whilePicked.ids.length === 1 && whilePicked.ids[0] === picked.id
        && !whilePicked.mineSelected && afterEscape.ids.length === 0 && afterEscape.cursors === 1);

    // 5) 선점 잠금: 편집자가 메모를 잡고 끄는 동안 관리자 화면
    const grab = await centerOf(b, '이번 주 할 일'); // 잡을 메모
    await b.mouse.move(grab.x, grab.y); // 메모 위로
    await b.mouse.down(); // 잡기(잠금 요청)
    await wait(500); // 잠금 획득 대기
    await b.mouse.move(grab.x + 46, grab.y + 34, { steps: 10 }); // 끌기
    await a.waitForFunction(() => canvas.locks.size === 1 && canvas.moves.size === 1); // 잠금·이동 미리보기 표시 대기
    await wait(200); // 그리기 여유
    await shot(a, '06-board-lock'); // "프론트 담당 편집 중" 표시
    await b.mouse.move(grab.x, grab.y, { steps: 6 }); // 제자리로 되돌림
    await b.mouse.up(); // 놓기(이동 없음 → 잠금만 해제)
    await a.waitForFunction(() => canvas.locks.size === 0); // 잠금 해제 대기
    await b.keyboard.press('Escape'); // 잡았던 메모의 선택을 풂(뒤의 화면에 선택 표시가 남지 않게)
    await a.waitForFunction(() => canvas.selections.size === 0); // 표시 사라짐
    await b.mouse.move(cursorAt.x, cursorAt.y); // 커서를 빈 곳으로

    // 6) 공유 업무 블럭 선택 → 오른쪽 업무 패널
    await a.click('#toolbar [data-tool="select"]'); // 선택 도구
    const taskAt = await centerOf(a, '로그인 화면 디자인'); // 업무 블럭
    await a.mouse.click(taskAt.x, taskAt.y); // 선택
    await a.waitForSelector('#task-props', { visible: true }); // 업무 패널 표시 대기
    await a.$eval('#task-props', (el) => el.scrollIntoView({ block: 'start' })); // 오른쪽 패널을 업무 부분까지 내려 체크리스트가 보이게
    await wait(300); // 그리기 여유
    await shot(a, '07-board-task'); // 업무 블럭과 편집 패널(체크리스트 포함)

    // 실제 입력 확인: 업무 패널의 체크리스트에 항목을 더하고 체크하고 이름을 고치고 지우면, 그때마다 서버에 저장되고 같은 보드의 편집자 화면에도 전달되는지
    const LISTED = '로그인 화면 디자인'; // 고른 업무
    const listText = (items) => items.map((i) => (i.done ? '[v] ' : '[ ] ') + i.title).join(' / '); // 항목들을 한 줄로
    const listOnOther = () => b.evaluate((title) => [...state.tasks.values()].find((t) => t.title === title).checklist.map((i) => ({ title: i.title, done: i.done })), LISTED); // 편집자 화면의 그 업무
    const listOnServer = () => a.evaluate(async (title) => (await window.api.get('/api/projects/' + state.project.project_id + '/tasks')).tasks.find((t) => t.title === title).checklist.map((i) => ({ title: i.title, done: i.done })), LISTED); // 서버에 저장된 그 업무
    const reached = async (want) =>
    {
        await b.waitForFunction((title, text) => [...state.tasks.values()].find((t) => t.title === title).checklist.map((i) => (i.done ? '[v] ' : '[ ] ') + i.title).join(' / ') === text, {}, LISTED, want); // 편집자 화면에 전달될 때까지
        return listText(await listOnServer()) === want && listText(await checklistItems(a, '#task-checklist')) === want; // 서버와 내 패널도 같은지
    }; // 세 곳이 모두 그 모습인지
    const listSeed = listText(await listOnOther()); // 예시 체크리스트
    const listVersion = () => a.evaluate((title) => [...state.tasks.values()].find((t) => t.title === title).version, LISTED); // 업무 버전
    const listVersionBefore = await listVersion(); // 바꾸기 전 버전
    await addChecklistItem(a, '#task-checklist', '캡처 확인 항목'); // 적고 Enter
    const itemAdded = await reached(listSeed + ' / [ ] 캡처 확인 항목'); // 추가됨
    await clickChecklist(a, '#task-checklist', '캡처 확인 항목', 'box'); // 체크
    const itemChecked = await reached(listSeed + ' / [v] 캡처 확인 항목'); // 체크됨
    await renameChecklistItem(a, '#task-checklist', '캡처 확인 항목', '고친 항목'); // 이름 고치기
    const itemRenamed = await reached(listSeed + ' / [v] 고친 항목'); // 이름 바뀜
    await clickChecklist(a, '#task-checklist', '고친 항목', 'delete'); // 지우기
    const itemRemoved = await reached(listSeed); // 예시 그대로 돌아옴
    check('체크리스트: 항목을 더하고 체크하고 고치고 지우면 바로 저장되고 다른 화면에도 전달됨', listSeed === '[v] 시안 그리기 / [v] 팀 확인받기 / [ ] 수정 반영'
        && itemAdded && itemChecked && itemRenamed && itemRemoved && (await listVersion()) === listVersionBefore && (await a.$eval('#task-checklist .error', (el) => el.textContent)) === '');
    await a.$eval('.props', (el) => { el.scrollTop = 0; }); // 체크리스트를 누르느라 내려간 패널을 맨 위로

    // 실제 입력 확인: 업무 블럭을 하나 새로 놓고 오른쪽 패널의 "업무 삭제"로 지우면, 업무와 블럭이 내 화면·편집자 화면·서버에서 모두 사라지는지
    const DOOMED_TASK = '캡처에서 지울 업무'; // 지울 업무
    await a.click('#tool-task'); // 업무 블럭 추가
    await a.waitForSelector('#task-dialog[open]'); // 추가 대화상자
    await a.click('#task-mode-new'); // 새 업무 만들기
    await a.type('#task-new-title', DOOMED_TASK); // 제목
    await a.click('#task-form button[type="submit"]'); // 보드에 추가
    await b.waitForFunction((title) => [...state.tasks.values()].some((t) => t.title === title) && canvas.objects.some((o) => o.type === 'task' && state.tasks.get(o.task_id) && state.tasks.get(o.task_id).title === title), {}, DOOMED_TASK); // 편집자 화면에도 블럭이 생김
    const doomedAt = await centerOf(a, DOOMED_TASK); // 새 블럭 가운데
    await a.mouse.click(doomedAt.x, doomedAt.y); // 블럭 선택
    await a.waitForFunction((title) => !document.getElementById('task-props').hidden && document.getElementById('task-title').value === title, {}, DOOMED_TASK); // 패널이 그 업무를 보여 줌
    const countBefore = await snapshotCount(a); // 지우기 전 서버의 객체 수
    await a.click('#task-delete'); // 업무 삭제
    await a.waitForSelector('#task-delete-dialog[open]'); // 확인 대화상자
    const askedFor = await a.$eval('#task-delete-text', (el) => el.textContent); // 무엇을 지우는지 묻는 문구
    await a.click('#task-delete-form button[type="submit"]'); // 삭제
    const taskGone = (page) => page.waitForFunction((title) => ![...state.tasks.values()].some((t) => t.title === title) && !canvas.objects.some((o) => o.type === 'task' && !state.tasks.get(o.task_id)), {}, DOOMED_TASK); // 업무와 블럭이 화면에서 사라질 때까지
    await taskGone(a); // 내 화면
    await taskGone(b); // 편집자 화면
    const afterTaskDelete = await a.evaluate(async (title) => ({
        listed: (await window.api.get('/api/projects/' + state.project.project_id + '/tasks')).tasks.some((t) => t.title === title), // 서버의 업무 목록
        dialog: document.getElementById('task-delete-dialog').open, // 확인 대화상자
        panel: document.getElementById('task-props').hidden, // 업무 패널(선택이 사라져 닫힘)
    }), DOOMED_TASK); // 지운 뒤 상태
    check('업무 삭제: 패널에서 지우면 업무와 블럭이 내 화면·다른 화면·서버에서 모두 사라짐', askedFor.includes(DOOMED_TASK) && !afterTaskDelete.listed && !afterTaskDelete.dialog && afterTaskDelete.panel
        && (await snapshotCount(a)) === countBefore - 1);

    // 7) 메모 글 편집(더블클릭) — 찍은 뒤 Esc 로 취소
    const noteAt = await centerOf(a, '아이디어'); // 편집할 메모
    await a.mouse.click(noteAt.x, noteAt.y, { count: 2 }); // 더블클릭(두 번 누르고 떼는 실제 순서)
    await a.waitForSelector('#note-editor', { visible: true }); // 입력란 표시 대기
    await wait(200); // 그리기 여유
    await shot(a, '08-note-edit'); // 메모 글 편집 중
    await a.keyboard.press('Escape'); // 취소
    await a.waitForSelector('#note-editor', { hidden: true }); // 입력란 닫힘 대기

    // 8) 실제 입력 확인: 메모 만들기 → 글 입력 → 바깥 클릭으로 저장 → Ctrl+Z 로 되돌리기
    const before = await snapshotCount(a); // 저장된 객체 수
    const empty = await screenPoint(a, 420, 470); // 빈 영역
    await a.click('#toolbar [data-tool="note"]'); // 메모 도구
    await a.mouse.click(empty.x, empty.y); // 메모 놓기
    await a.waitForSelector('#note-editor', { visible: true }); // 입력란 표시 대기
    await a.keyboard.type('캡처 확인 메모'); // 실제 키 입력
    const outside = await screenPoint(a, 700, 520); // 바깥 빈 영역
    await a.mouse.click(outside.x, outside.y); // 바깥 클릭(포커스 이동으로 저장)
    await a.waitForFunction(() => document.getElementById('save-status').dataset.state === 'saved' && !noteEdit); // 저장 대기
    const saved = await a.evaluate(async () => (await window.api.get('/api/boards/' + state.board.board_id + '/snapshot')).objects.some((o) => o.type === 'note' && o.payload.text === '캡처 확인 메모')); // 서버 저장 확인
    check('메모: 실제 키 입력 후 바깥 클릭으로 저장', saved && (await snapshotCount(a)) === before + 1);
    const noteState = () => a.evaluate(async () =>
    {
        const o = (await window.api.get('/api/boards/' + state.board.board_id + '/snapshot')).objects.find((x) => x.type === 'note' && x.payload.text === '캡처 확인 메모'); // 서버에 저장된 그 메모
        return o ? { size: o.style.size, height: o.height } : null;
    }); // 서버 기준 메모 상태
    const sizeOnScreen = (size) => a.waitForFunction((want) =>
    {
        const o = canvas.objects.find((x) => x.type === 'note' && x.payload.text === '캡처 확인 메모'); // 화면의 그 메모
        return (want === null ? !o : !!o && o.style.size === want) && document.getElementById('save-status').dataset.state === 'saved';
    }, {}, size); // 화면의 메모가 그 글자 크기가 될 때까지(null 이면 사라질 때까지)
    const ctrl = async (key) =>
    {
        await a.keyboard.down('Control'); // Ctrl
        await a.keyboard.press(key); // 조합 키
        await a.keyboard.up('Control'); // Ctrl 해제
    }; // Ctrl 조합 입력
    await a.click('#toolbar [data-tool="select"]'); // 선택 도구
    const made = await centerOf(a, '캡처 확인 메모'); // 방금 만든 메모
    await a.mouse.click(made.x, made.y); // 메모 선택
    const small = await noteState(); // 바꾸기 전 상태
    await a.select('#prop-size', '40'); // 오른쪽 패널에서 글자 크기를 아주 크게
    await sizeOnScreen(40); // 저장 대기
    const large = await noteState(); // 바꾼 뒤 상태
    check('글자 크기: 패널에서 고르면 저장되고 글이 넘치지 않게 높이도 맞춰짐', small.size === 16 && large.size === 40 && large.height >= small.height);
    await ctrl('z'); // 글자 크기 되돌리기
    await sizeOnScreen(16); // 원래 크기로
    await ctrl('z'); // 메모 만들기 되돌리기
    await sizeOnScreen(null); // 화면에서 사라짐
    check('실행 취소: Ctrl+Z 두 번으로 글자 크기와 방금 만든 메모를 차례로 되돌림', (await snapshotCount(a)) === before);
    await ctrl('y'); // 메모 다시 만들기
    await sizeOnScreen(16); // 메모가 다시 나타남(새 ID)
    await ctrl('y'); // 글자 크기 다시 적용
    await sizeOnScreen(40); // 다시 큰 글자
    const redone = await noteState(); // 다시 실행한 뒤 상태
    check('다시 실행: Ctrl+Y 두 번으로 메모와 글자 크기가 돌아옴', (await snapshotCount(a)) === before + 1 && redone !== null && redone.size === 40 && redone.height === large.height);
    await ctrl('z'); // 정리: 글자 크기
    await sizeOnScreen(16); // 원래 크기로
    await ctrl('z'); // 정리: 메모
    await sizeOnScreen(null); // 화면에서 사라짐
    if ((await snapshotCount(a)) !== before)
    {
        throw new Error('확인용 메모가 정리되지 않았습니다.'); // 캡처에 남으면 안 됨
    }

    // 9) PNG 내보내기 결과(화면 요소 없이 보드 내용만)
    const dataUrl = await a.evaluate(() => canvas.exportDataUrl()); // 내보내기 그림
    fs.writeFileSync(path.join(OUT, '09-board-export.png'), Buffer.from(dataUrl.split(',')[1], 'base64')); // 파일로 저장
    console.log('saved assets/screenshots/09-board-export.png');

    // 10) 작업실 직접 만들기: 초대 코드가 없는 세 번째 사람이 자기 작업실을 만든다
    const c = await newUser(browser, USER); // 혼자 시작하는 사람
    const OWNER = '혼자 시작'; // 만드는 사람의 표시 이름
    await c.goto(BASE + '/'); // 소개 페이지
    await c.waitForSelector('#home-intro', { visible: true }); // 소개 구성 대기
    await c.click('#home-create'); // 새 작업실 만들기
    await c.waitForSelector('#view-create', { visible: true }); // 만들기 화면
    await c.type('#create-name', OWNER); // 표시 이름
    await c.type('#create-title', '내 작업실'); // 작업실 이름
    await shot(c, '10-create'); // 작업실 만들기 화면
    await c.click('#create-form button[type="submit"]'); // 만들기
    await c.waitForSelector('#ws-owner', { visible: true }); // 작업실로 들어와 내 코드 카드가 보임
    await c.waitForSelector('#boards-list .open-board'); // 첫 보드 카드
    const fresh = await c.evaluate(() => ({
        role: document.getElementById('boards-role').textContent, // 역할 표시
        title: document.getElementById('boards-project-title').textContent, // 작업실 이름
        boards: [...document.querySelectorAll('#boards-list .open-board strong')].map((el) => el.textContent), // 보드 이름
        code: document.getElementById('ws-owner-code').textContent, // 재입장 코드(아래 재입장 확인에만 쓰고 출력하지 않음)
        name: document.getElementById('ws-owner-name').textContent, // 다시 들어올 때 쓸 이름
        admin: !document.getElementById('invite-admin').hidden && !document.getElementById('ws-rename').hidden, // 초대 코드 관리와 이름 변경이 보이는지
    })); // 만든 직후의 작업실
    check('작업실 만들기: 초대 코드 없이 이름과 작업실 이름만으로 만들어 관리자로 들어가고 첫 보드와 내 코드가 보임', fresh.role === '관리자' && fresh.title === '내 작업실'
        && fresh.boards.length === 1 && fresh.boards[0] === '첫 보드' && /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(fresh.code) && fresh.name === OWNER && fresh.admin);
    await c.$eval('#ws-owner-code', (el) => { el.textContent = 'XXXX-XXXX-XXXX'; }); // 화면에는 실제 코드 대신 자리 표시 글만 찍음
    await waitTaskBoard(c, 0); // 업무 현황판 연결 표시까지 기다림
    await c.mouse.move(640, 20); // 마우스는 상단으로 치움
    await shot(c, '11-workspace-new'); // 방금 만든 작업실(내 코드 안내)
    await c.click('#ws-rename'); // 작업실 이름 변경
    await c.waitForSelector('#project-rename-dialog[open]'); // 이름 변경 대화상자(현재 이름이 선택된 상태)
    await c.keyboard.type('나만의 작업실'); // 새 이름
    await c.keyboard.press('Enter'); // 저장
    await c.waitForFunction(() => !document.getElementById('project-rename-dialog').open && document.getElementById('boards-project-title').textContent === '나만의 작업실'); // 제목 반영
    await c.click('#ws-owner-done'); // 내 코드를 보관했다고 확인
    await c.click('#boards-leave'); // 나가기
    await c.waitForSelector('#home-intro', { visible: true }); // 소개 페이지로 돌아옴
    await c.click('#home-enter-top'); // 입장하기
    await c.waitForSelector('#view-join', { visible: true }); // 입장 화면
    await c.type('#join-name', '다른 사람'); // 만든 사람이 아닌 이름
    await c.type('#join-code', fresh.code); // 내 코드
    await c.click('#join-form button[type="submit"]'); // 입장 시도
    await c.waitForFunction(() => document.getElementById('join-error').textContent !== ''); // 거부 안내
    const refused = await c.$eval('#join-error', (el) => el.textContent); // 안내 문구
    await joinWorkspace(c, OWNER, fresh.code); // 같은 이름과 내 코드로 다시 입장
    const back = await c.evaluate(() => ({
        role: document.getElementById('boards-role').textContent, // 역할
        title: document.getElementById('boards-project-title').textContent, // 작업실 이름
        cardHidden: document.getElementById('ws-owner').hidden, // 내 코드 카드는 만든 직후에만
    })); // 다시 들어온 작업실
    check('재입장: 내 코드는 같은 이름으로만 통하고, 다시 들어오면 관리자와 바꾼 작업실 이름 그대로', refused.includes('다시 들어올 때만') && back.role === '관리자' && back.title === '나만의 작업실' && back.cardHidden);

    // 실제 입력 확인: 방금 만든 작업실을 화면에서 지운다. 이름을 그대로 적어야 지워지고, 지운 뒤에는 소개 화면으로 돌아가며 세션과 내 코드가 더는 통하지 않는지
    await c.click('#ws-delete'); // 작업실 삭제
    await c.waitForSelector('#project-delete-dialog[open]'); // 확인 대화상자(입력 칸에 초점)
    await c.keyboard.type('나만의 작업'); // 이름을 한 글자 덜 적음
    const lockedWhileWrong = await c.$eval('#project-delete-submit', (el) => el.disabled); // 이름이 다르면 버튼이 꺼져 있음
    await c.keyboard.type('실'); // 이름을 끝까지 적음
    await c.mouse.move(640, 20); // 마우스는 상단으로 치움
    await wait(200); // 그리기 여유
    await shot(c, '12-workspace-delete'); // 작업실 삭제 확인 창(이름을 적어야 삭제 버튼이 켜짐)
    await c.click('#project-delete-submit'); // 삭제
    await c.waitForFunction(() => !document.getElementById('home-intro').hidden && !document.getElementById('home-notice').hidden); // 소개 화면과 안내
    const afterDelete = await c.evaluate(async () => ({
        notice: document.getElementById('home-notice').textContent, // 안내 문구
        session: await window.api.get('/api/me').then(() => 200, (err) => err.status), // 세션
    })); // 지운 뒤 상태
    await c.click('#home-enter-top'); // 입장하기
    await c.waitForSelector('#view-join', { visible: true }); // 입장 화면
    await c.type('#join-name', OWNER); // 만든 사람의 이름
    await c.type('#join-code', fresh.code); // 지워진 작업실의 내 코드
    await c.click('#join-form button[type="submit"]'); // 입장 시도
    await c.waitForFunction(() => document.getElementById('join-error').textContent !== ''); // 거부 안내
    const codeRefused = await c.$eval('#join-error', (el) => el.textContent); // 안내 문구
    check('작업실 삭제: 이름을 그대로 적어야 지워지고, 지운 뒤에는 소개 화면으로 돌아가며 세션과 내 코드가 통하지 않음', lockedWhileWrong && afterDelete.notice.includes('나만의 작업실') && afterDelete.notice.includes('삭제했습니다')
        && afterDelete.session === 401 && codeRefused !== '');
}

async function main()
{
    fs.mkdirSync(OUT, { recursive: true }); // 저장 폴더 준비
    const servers = startServers(API_PORT, RT_PORT); // 서버 시작
    let browser = null; // 브라우저 핸들
    let exitCode = 0; // 종료 코드
    try
    {
        await waitFor(BASE + '/api/health'); // PHP 준비
        await waitFor('http://127.0.0.1:' + RT_PORT + '/health'); // 실시간 준비
        const env = setupProject(); // 프로젝트·예시 보드·초대 코드
        browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--window-size=1280,800', '--lang=ko-KR'] }); // 설치된 브라우저 실행
        await capture(browser, env); // 캡처 실행
    }
    catch (err)
    {
        console.error('캡처 실패', err); // 오류 출력
        exitCode = 1; // 실패
    }
    finally
    {
        if (browser)
        {
            await browser.close(); // 브라우저 종료
        }
        servers.php.kill(); // PHP 종료
        servers.rt.kill(); // 실시간 종료
    }
    const failed = checks.filter((c) => !c.ok).length; // 실패한 확인
    console.log('실제 입력 확인: ' + (checks.length - failed) + ' 통과, ' + failed + ' 실패'); // 요약
    process.exit(exitCode || (failed > 0 ? 1 : 0)); // 종료
}

main(); // 시작
