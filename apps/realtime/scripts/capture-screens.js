// 발표·문서용 실제 화면 캡처: 서버를 임시 포트로 띄우고 설치된 Chrome 을 조작해 assets/screenshots 에 PNG 로 저장한다
// 사용법: npm run capture   (MariaDB 실행 중, DB 스키마 적용 필요)
//   CHROME_BIN: Chrome·Edge 실행 파일 경로, PHP_BIN: PHP 실행 파일 경로, DB_NAME: 다른 DB 에서 찍고 싶을 때
// 실행할 때마다 '시연 프로젝트' 가 하나 새로 생긴다(예시 보드 포함). 찍는 김에 실제 입력으로 메모 저장·실행 취소도 확인한다
'use strict';

const { spawn, execFileSync } = require('child_process'); // 서버·CLI 실행
const fs = require('fs'); // 파일 읽기·쓰기
const path = require('path'); // 경로 계산
const puppeteer = require('puppeteer-core'); // 설치된 브라우저 조작(브라우저를 내려받지 않음)

const ROOT = path.resolve(__dirname, '..', '..', '..'); // 저장소 루트
const PHP_API = path.join(ROOT, 'apps', 'php-api'); // PHP API 폴더
const OUT = path.join(ROOT, 'assets', 'screenshots'); // 캡처 저장 폴더
const PHP = process.env.PHP_BIN || (process.platform === 'win32' ? 'C:/xampp/php/php.exe' : 'php'); // PHP 실행 파일
const API_PORT = Number(process.env.CAP_API_PORT || 8082); // 캡처용 PHP 포트
const RT_PORT = Number(process.env.CAP_RT_PORT || 3003); // 캡처용 실시간 포트
const BASE = 'http://127.0.0.1:' + API_PORT; // 접속 주소
const VIEW = { width: 1280, height: 800, deviceScaleFactor: 2 }; // 화면 크기(2배 해상도로 저장)

const wait = (ms) => new Promise((r) => setTimeout(r, ms)); // 대기
const checks = []; // 실제 입력 확인 결과

function check(label, ok)
{
    checks.push({ label, ok }); // 결과 기록
    console.log((ok ? 'PASS ' : 'FAIL ') + label); // 즉시 출력
}

function findChrome()
{
    const candidates = [
        process.env.CHROME_BIN,
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
    ].filter(Boolean); // 찾아볼 경로
    const found = candidates.find((p) => fs.existsSync(p)); // 처음 발견한 브라우저
    if (!found)
    {
        throw new Error('Chrome·Edge 를 찾지 못했습니다. CHROME_BIN 환경 변수로 실행 파일 경로를 지정하세요.'); // 안내
    }
    return found; // 실행 파일 경로
}

async function waitFor(url, tries = 50)
{
    for (let i = 0; i < tries; i++)
    {
        try
        {
            if ((await fetch(url)).ok)
            {
                return; // 준비 완료
            }
        }
        catch (err)
        {
            // 아직 준비 안 됨
        }
        await wait(200); // 재시도 간격
    }
    throw new Error(url + ' 가 응답하지 않습니다.'); // 시작 실패
}

function startServers()
{
    const php = spawn(PHP, ['-S', '127.0.0.1:' + API_PORT, '-t', 'apps/frontend/public', 'apps/php-api/public/index.php'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, RATE_LIMIT: '1000' } }); // PHP 내장 서버
    const rt = spawn(process.execPath, ['src/server.js'], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, PORT: String(RT_PORT) } }); // 실시간 서버
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
    const out = phpCli('create-project.php', ['시연 프로젝트', '기획 보드', '개발 보드']); // 프로젝트·보드 생성
    const projectId = Number(/project_id=(\d+)/.exec(out)[1]); // 프로젝트 ID
    const adminCode = /관리자 초대 코드: (\S+)/.exec(out)[1]; // 관리자 코드(화면에는 찍지 않음)
    console.log(phpCli('seed-demo.php', [String(projectId)]).trim()); // 예시 보드 채우기
    const editorCode = /초대 코드: (\S+)/.exec(phpCli('create-invite.php', [String(projectId), 'editor', '1']))[1]; // 편집자 코드
    return { projectId, adminCode, editorCode }; // 캡처 환경
}

// ---------- 브라우저 조작 도우미 ----------

async function newUser(browser)
{
    const context = await browser.createBrowserContext(); // 사용자마다 쿠키가 분리된 창
    const page = await context.newPage(); // 새 탭
    const config = fs.readFileSync(path.join(ROOT, 'apps', 'frontend', 'public', 'js', 'config.js'), 'utf8').replace("':3001'", "':" + RT_PORT + "'"); // 캡처용 실시간 포트를 가리키는 설정
    await page.setViewport(VIEW); // 화면 크기
    await page.setRequestInterception(true); // 설정 파일만 바꿔치기
    page.on('request', (req) =>
    {
        if (req.url().endsWith('/js/config.js'))
        {
            req.respond({ status: 200, contentType: 'application/javascript; charset=utf-8', body: config }); // 캡처용 설정 응답(제품 코드는 그대로)
        }
        else
        {
            req.continue(); // 나머지 요청은 그대로
        }
    });
    page.on('pageerror', (err) => console.error('[page] ' + err.message)); // 화면 스크립트 오류 표시
    return page; // 조작할 탭
}

async function shot(page, name)
{
    const file = path.join(OUT, name + '.png'); // 저장 경로
    await page.screenshot({ path: file }); // 보이는 화면 캡처
    console.log('saved assets/screenshots/' + name + '.png'); // 저장 안내
}

async function joinWorkspace(page, name, code)
{
    await page.type('#join-name', name); // 표시 이름
    if (code)
    {
        await page.$eval('#join-code', (el) => { el.value = ''; }); // 자리 표시 글 지움
        await page.type('#join-code', code); // 초대 코드
    }
    await page.click('#join-form button[type="submit"]'); // 입장
    await page.waitForSelector('#home-workspace', { visible: true }); // 작업실 구성 대기
    await page.waitForSelector('#boards-list .open-board'); // 보드 카드 대기
}

async function openBoard(page, title)
{
    const cards = await page.$$('#boards-list .open-board'); // 보드 카드
    for (const card of cards)
    {
        if ((await card.$eval('strong', (el) => el.textContent)) === title)
        {
            await card.click(); // 보드 열기
            break;
        }
    }
    await page.waitForSelector('#conn-status[data-state="online"]'); // 실시간 연결 대기
    await wait(600); // 첫 화면 맞춤·이미지 로드 여유
}

// 월드 좌표 → 브라우저 화면 좌표
function screenPoint(page, wx, wy)
{
    return page.evaluate((x, y) =>
    {
        const rect = canvas.el.getBoundingClientRect(); // 캔버스 위치
        const s = canvas.toScreen(x, y); // 화면 좌표
        return { x: rect.left + s.x, y: rect.top + s.y };
    }, wx, wy);
}

// 글에 특정 낱말이 들어 있는 메모(또는 제목이 일치하는 업무 블럭)의 사각형
function findObject(page, text)
{
    return page.evaluate((needle) =>
    {
        const hit = canvas.objects.find((o) => (o.type === 'note' && o.payload.text.includes(needle)) || (o.type === 'task' && state.tasks.get(o.task_id) && state.tasks.get(o.task_id).title === needle)); // 대상 객체
        return hit ? { id: hit.object_id, x: hit.x, y: hit.y, width: hit.width, height: hit.height } : null;
    }, text);
}

async function centerOf(page, text)
{
    const o = await findObject(page, text); // 대상 객체
    if (!o)
    {
        throw new Error("'" + text + "' 객체를 찾지 못했습니다."); // 예시 보드가 바뀐 경우
    }
    return screenPoint(page, o.x + o.width / 2, o.y + o.height / 2); // 가운데 화면 좌표
}

const snapshotCount = (page) => page.evaluate(async () => (await window.api.get('/api/boards/' + state.board.board_id + '/snapshot')).objects.length); // 서버에 저장된 객체 수

// ---------- 캡처 순서 ----------

async function capture(browser, env)
{
    const a = await newUser(browser); // 관리자 '기획 담당'
    const b = await newUser(browser); // 편집자 '프론트 담당'

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
    await a.keyboard.down('Control'); // Ctrl
    await a.keyboard.press('z'); // Z
    await a.keyboard.up('Control'); // Ctrl 해제
    await a.waitForFunction((n) => canvas.objects.length === n, {}, before); // 화면에서 사라짐 대기
    await wait(300); // 서버 반영 여유
    check('실행 취소: Ctrl+Z 로 방금 만든 메모 제거', (await snapshotCount(a)) === before);

    // 9) PNG 내보내기 결과(화면 요소 없이 보드 내용만)
    const dataUrl = await a.evaluate(() => canvas.exportDataUrl()); // 내보내기 그림
    fs.writeFileSync(path.join(OUT, '09-board-export.png'), Buffer.from(dataUrl.split(',')[1], 'base64')); // 파일로 저장
    console.log('saved assets/screenshots/09-board-export.png');
}

async function main()
{
    fs.mkdirSync(OUT, { recursive: true }); // 저장 폴더 준비
    const servers = startServers(); // 서버 시작
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
