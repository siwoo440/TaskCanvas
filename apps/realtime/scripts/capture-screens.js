// 발표·문서용 실제 화면 캡처: 서버를 임시 포트로 띄우고 설치된 Chrome 을 조작해 assets/screenshots 에 PNG 로 저장한다
// 사용법: npm run capture   (MariaDB 실행 중, DB 스키마 적용 필요)
//   CHROME_BIN: Chrome·Edge 실행 파일 경로, PHP_BIN: PHP 실행 파일 경로, DB_NAME: 다른 DB 에서 찍고 싶을 때
// 실행할 때마다 '시연 프로젝트' 가 하나 새로 생긴다(예시 보드 포함). 찍는 김에 실제 입력으로 메모 저장·글자 크기·실행 취소·다시 실행도 확인한다
'use strict';

const fs = require('fs'); // 파일 쓰기
const path = require('path'); // 경로 계산
const puppeteer = require('puppeteer-core'); // 설치된 브라우저 조작(브라우저를 내려받지 않음)
const { ROOT, wait, findChrome, waitFor, startServers, phpCli, newUser, joinWorkspace, openBoard, screenPoint, centerOf } = require('./lib/browser-kit'); // 리허설 스크립트와 함께 쓰는 도우미

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
    await a.waitForFunction(() => document.querySelectorAll('#ws-members li').length >= 2 && document.querySelectorAll('#ws-tasks li .chip').length >= 3); // 참여자·업무 표시 대기
    await shot(a, '03-workspace'); // 작업실
    await (await a.$('#invite-admin')).screenshot({ path: path.join(OUT, '04-invite-admin.png') }); // 초대 코드 관리(코드는 발급하지 않아 화면에 원문 없음)
    console.log('saved assets/screenshots/04-invite-admin.png');

    // 4) 화이트보드: 두 사람이 같은 보드에
    await openBoard(b, '기획 보드'); // 편집자 입장
    await openBoard(a, '기획 보드'); // 관리자 입장
    await a.waitForFunction(() => document.querySelectorAll('#participants li').length === 2); // 참여자 2명 표시 대기
    const cursorAt = await screenPoint(b, 660, 500); // 편집자 커서를 둘 곳(빈 영역)
    await b.mouse.move(cursorAt.x - 40, cursorAt.y - 30); // 커서 이동 시작
    await b.mouse.move(cursorAt.x, cursorAt.y, { steps: 8 }); // 커서 위치 공유
    await a.mouse.move(640, 20); // 관리자 마우스는 상단으로 치움
    await a.waitForFunction(() => canvas.cursors.size === 1); // 상대 커서 표시 대기
    await wait(200); // 그리기 여유
    await shot(a, '05-board'); // 화이트보드 전체(상대 커서 포함)

    // 5) 선점 잠금: 편집자가 메모를 잡고 끄는 동안 관리자 화면
    await b.click('#toolbar [data-tool="select"]'); // 선택 도구
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
    await b.mouse.move(cursorAt.x, cursorAt.y); // 커서를 빈 곳으로

    // 6) 공유 업무 블럭 선택 → 오른쪽 업무 패널
    await a.click('#toolbar [data-tool="select"]'); // 선택 도구
    const taskAt = await centerOf(a, '로그인 화면 디자인'); // 업무 블럭
    await a.mouse.click(taskAt.x, taskAt.y); // 선택
    await a.waitForSelector('#task-props', { visible: true }); // 업무 패널 표시 대기
    await wait(300); // 그리기 여유
    await shot(a, '07-board-task'); // 업무 블럭과 편집 패널

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
