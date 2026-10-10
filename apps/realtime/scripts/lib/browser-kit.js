// 브라우저 조작 공통 도우미(화면 캡처·시연 리허설 스크립트 공용):
// 임시 서버 실행, 설치된 Chrome 찾기, 사용자별 탭 만들기, 입장·보드 열기, 보드 좌표 → 화면 좌표 변환
'use strict';

const { spawn, execFileSync } = require('child_process'); // 서버·CLI 실행
const fs = require('fs'); // 파일 읽기
const path = require('path'); // 경로 계산

const ROOT = path.resolve(__dirname, '..', '..', '..', '..'); // 저장소 루트
const PHP_API = path.join(ROOT, 'apps', 'php-api'); // PHP API 폴더
const REALTIME = path.join(ROOT, 'apps', 'realtime'); // 실시간 서버 폴더
const PHP = process.env.PHP_BIN || (process.platform === 'win32' ? 'C:/xampp/php/php.exe' : 'php'); // PHP 실행 파일

const wait = (ms) => new Promise((r) => setTimeout(r, ms)); // 대기

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

// PHP 내장 서버와 실시간 서버를 임시 포트로 띄운다. rtEnv 는 실시간 서버에만 더할 환경 변수
function startServers(apiPort, rtPort, rtEnv = {})
{
    const php = spawn(PHP, ['-S', '127.0.0.1:' + apiPort, '-t', 'apps/frontend/public', 'apps/php-api/public/index.php'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, RATE_LIMIT: '1000' } }); // PHP 내장 서버(입장이 잦으므로 요청 제한 완화)
    const rt = spawn(process.execPath, ['src/server.js'], { cwd: REALTIME, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, PORT: String(rtPort), ...rtEnv } }); // 실시간 서버
    php.stderr.on('data', (d) => { if (/PHP (Fatal|Parse|Warning)/.test(String(d))) { console.error('[php] ' + String(d).trim()); } }); // PHP 오류만 표시
    rt.stderr.on('data', (d) => console.error('[realtime] ' + String(d).trim())); // 실시간 서버 오류 표시
    return { php, rt }; // 프로세스 핸들
}

function phpCli(script, args)
{
    return execFileSync(PHP, [path.join(PHP_API, 'bin', script), ...args], { cwd: PHP_API, encoding: 'utf8' }); // 개발용 CLI 실행
}

// 사용자 한 명의 탭을 만든다(쿠키가 분리된 창). options: rtPort(임시 실시간 포트), view(화면 크기), block(막을 요청 주소 정규식), onError(화면 스크립트 오류 콜백)
async function newUser(browser, options)
{
    const context = await browser.createBrowserContext(); // 사용자마다 쿠키가 분리된 창
    const page = await context.newPage(); // 새 탭
    const config = fs.readFileSync(path.join(ROOT, 'apps', 'frontend', 'public', 'js', 'config.js'), 'utf8').replace("':3001'", "':" + options.rtPort + "'"); // 임시 실시간 포트를 가리키는 설정
    await page.setViewport(options.view); // 화면 크기
    await page.setRequestInterception(true); // 설정 파일만 바꿔치기
    page.on('request', (req) =>
    {
        if (req.url().endsWith('/js/config.js'))
        {
            req.respond({ status: 200, contentType: 'application/javascript; charset=utf-8', body: config }); // 임시 포트용 설정 응답(제품 코드는 그대로)
        }
        else if (options.block && options.block.test(req.url()))
        {
            req.abort(); // 외부 영상 등 시험에 필요 없는 요청은 보내지 않음
        }
        else
        {
            req.continue(); // 나머지 요청은 그대로
        }
    });
    page.on('pageerror', (err) => (options.onError ? options.onError(err.message) : console.error('[page] ' + err.message))); // 화면 스크립트 오류 전달
    return page; // 조작할 탭
}

async function joinWorkspace(page, name, code)
{
    await page.$eval('#join-name', (el) => { el.value = ''; }); // 이전 입력 지움
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
    let opened = false; // 카드를 눌렀는지
    for (let i = 0; i < 30 && !opened; i++)
    {
        opened = await page.evaluate((wanted) =>
        {
            const card = [...document.querySelectorAll('#boards-list .open-board')].find((el) => el.querySelector('strong') && el.querySelector('strong').textContent === wanted); // 제목이 같은 보드 카드
            if (card)
            {
                card.click(); // 보드 열기(목록이 다시 그려지는 중이어도 찾기와 누르기를 한 번에 처리)
            }
            return !!card;
        }, title);
        if (!opened)
        {
            await wait(100); // 목록이 아직 그려지지 않았으면 잠시 뒤 다시 시도
        }
    }
    if (!opened)
    {
        throw new Error("작업실에서 '" + title + "' 보드 카드를 찾지 못했습니다."); // 보드 이름이 바뀐 경우
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

// 작업실 업무 현황판이 실시간으로 연결되어 카드를 끌 수 있게 될 때까지 기다린다
function waitTaskBoard(page, cards)
{
    return page.waitForFunction((n) => document.getElementById('ws-conn').dataset.state === 'online' && document.querySelectorAll('#ws-taskboard .tb-card.draggable').length >= n, {}, cards);
}

// 현황판의 카드 상태: 제목 → { status(놓인 열), due(마감 표시의 종류와 글) }
function taskCards(page)
{
    return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#ws-taskboard .tb-card')].map((card) =>
    {
        const due = card.querySelector('.tb-due'); // 마감 표시
        return [card.querySelector('strong').textContent, { status: card.closest('.tb-col').dataset.status, due: due ? due.className.replace('tb-due ', '') + ':' + due.textContent : '' }];
    })));
}

// 현황판의 카드를 실제 마우스 입력으로 끌어 다른 열에 놓는다
async function dragCard(page, title, status)
{
    const points = await page.evaluate((wanted, target) =>
    {
        const card = [...document.querySelectorAll('#ws-taskboard .tb-card')].find((el) => el.querySelector('strong').textContent === wanted); // 끌 카드
        const col = document.querySelector('#ws-taskboard .tb-col[data-status="' + target + '"]'); // 놓을 열
        if (!card || !col)
        {
            return null;
        }
        col.scrollIntoView({ block: 'center' }); // 현황판을 화면 안으로
        const from = card.getBoundingClientRect(); // 카드 위치
        const to = col.getBoundingClientRect(); // 열 위치
        return { from: { x: from.left + from.width / 2, y: from.top + from.height / 2 }, to: { x: to.left + to.width / 2, y: to.top + Math.min(to.height - 16, 70) } };
    }, title, status);
    if (!points)
    {
        throw new Error("현황판에서 '" + title + "' 카드나 '" + status + "' 열을 찾지 못했습니다."); // 예시 업무가 바뀐 경우
    }
    await page.mouse.move(points.from.x, points.from.y); // 카드 위로
    await page.mouse.down(); // 잡기
    await page.mouse.move(points.from.x + 14, points.from.y + 10, { steps: 3 }); // 조금 움직여 끌기 시작
    await page.mouse.move(points.to.x, points.to.y, { steps: 10 }); // 다른 열로
    await page.mouse.up(); // 놓기
}

module.exports = { ROOT, PHP_API, wait, findChrome, waitFor, startServers, phpCli, newUser, joinWorkspace, openBoard, screenPoint, findObject, centerOf, waitTaskBoard, taskCards, dragCard };
