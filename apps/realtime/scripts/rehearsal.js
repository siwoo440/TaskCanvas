// 시연 리허설 자동화: 브라우저 네 개(A·B·C·D)로 docs/16 시연 대본의 장면을 순서대로 실행하고, 장면별 통과·실패와 화면 사이 전달 지연을 출력한다
// 사용법: npm run rehearsal   (MariaDB 실행 중, DB 스키마 적용 필요)
//   CHROME_BIN·PHP_BIN: 실행 파일 경로, DB_NAME: 다른 DB 에서 돌릴 때, REH_API_PORT·REH_RT_PORT: 임시 포트(기본 8083·3004)
//   REH_MAX_PREVIEW_MS(기본 150)·REH_MAX_COMMIT_MS(기본 500): 지연 통과 기준(중앙값)
// 네 화면이 모두 이 PC 안에서 돌기 때문에 지연 값에는 실제 LAN 구간이 들어 있지 않다. 학교 PC 4대 검증(AC15)을 대신하지 않는다
// 실행할 때마다 '리허설 프로젝트' 가 하나 생기고, 끝나면 이 스크립트가 만든 초대 코드는 모두 취소한다
'use strict';

const fs = require('fs'); // 내려받은 파일 확인
const os = require('os'); // 임시 폴더
const path = require('path'); // 경로 계산
const puppeteer = require('puppeteer-core'); // 설치된 브라우저 조작(브라우저를 내려받지 않음)
const { wait, findChrome, waitFor, startServers, phpCli, newUser, joinWorkspace, openBoard, screenPoint, findObject, centerOf, waitTaskBoard, taskCards, dragCard, checklistItems, clickChecklist, addChecklistItem } = require('./lib/browser-kit'); // 캡처 스크립트와 함께 쓰는 도우미

const API_PORT = Number(process.env.REH_API_PORT || 8083); // 리허설용 PHP 포트
const RT_PORT = Number(process.env.REH_RT_PORT || 3004); // 리허설용 실시간 포트
const BASE = 'http://127.0.0.1:' + API_PORT; // 접속 주소
const MAX_PREVIEW_MS = Number(process.env.REH_MAX_PREVIEW_MS || 150); // 미리보기 전달 지연 기준(중앙값)
const MAX_COMMIT_MS = Number(process.env.REH_MAX_COMMIT_MS || 500); // 확정 저장 응답 지연 기준(중앙값)
const TIMEOUT = 6000; // 화면 변화를 기다리는 최대 시간(ms)
const VIDEO_URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'; // 영상 장면에 넣을 주소(재생은 하지 않고 객체 생성만 확인)
const NAMES = { a: 'A 진행', b: 'B 프론트', c: 'C 실시간', d: 'D 백엔드', viewer: 'D 열람' }; // 표시 이름

const results = []; // 장면별 결과 {no, title, ok, detail}
const pageErrors = []; // 화면 스크립트 오류
const labels = new Map(); // 탭 → 사람 이름(오류 안내용)

function expect(condition, message)
{
    if (!condition)
    {
        throw new Error(message); // 장면 실패
    }
}

// 화면 상태가 조건을 만족할 때까지 기다린다. 시간 안에 안 되면 무엇을 기다렸는지 알려 준다
async function waitOn(page, what, fn, ...args)
{
    try
    {
        await page.waitForFunction(fn, { timeout: TIMEOUT }, ...args); // 조건 대기
    }
    catch (err)
    {
        throw new Error(labels.get(page) + ' 화면: ' + what + ' — ' + TIMEOUT / 1000 + '초 안에 되지 않음'); // 대기 실패
    }
}

const all = (pages, fn) => Promise.all(pages.map(fn)); // 여러 화면을 동시에 확인

async function step(no, title, fn)
{
    const started = Date.now(); // 시작 시각
    let ok = false; // 통과 여부
    let detail = ''; // 비고
    try
    {
        detail = (await fn()) ?? ''; // 장면 실행
        ok = true; // 통과
    }
    catch (err)
    {
        detail = String(err.message).split('\n')[0]; // 실패 이유 한 줄
    }
    results.push({ no, title, ok, detail }); // 결과 기록
    console.log((ok ? 'PASS ' : 'FAIL ') + no + ' ' + title + (detail ? ' — ' + detail : '') + ' (' + ((Date.now() - started) / 1000).toFixed(1) + '초)'); // 즉시 출력
}

function setupProject()
{
    const out = phpCli('create-project.php', ['리허설 프로젝트', '기획 보드', '개발 보드']); // 프로젝트·보드 생성
    const boards = [...out.matchAll(/board_id=(\d+)/g)].map((m) => Number(m[1])); // 보드 ID
    const projectId = Number(/project_id=(\d+)/.exec(out)[1]); // 프로젝트 ID
    const adminCode = /관리자 초대 코드: (\S+)/.exec(out)[1]; // 관리자 코드(출력하지 않음)
    phpCli('seed-demo.php', [String(projectId)]); // 시연과 같은 예시 보드 채우기
    const editorCode = /초대 코드: (\S+)/.exec(phpCli('create-invite.php', [String(projectId), 'editor', '1']))[1]; // 편집자 코드
    const viewerCode = /초대 코드: (\S+)/.exec(phpCli('create-invite.php', [String(projectId), 'viewer', '1']))[1]; // 열람자 코드
    return { projectId, boardMain: boards[0], boardDev: boards[1], adminCode, editorCode, viewerCode }; // 리허설 환경
}

// ---------- 화면 조작 도우미 ----------

// 화면에 보이면서 어떤 객체와도 겹치지 않는 빈 자리(월드 좌표). skip 을 주면 그만큼 건너뛴 다음 자리
function freeSpot(page, width, height, skip = 0)
{
    return page.evaluate((w, h, skipCount) =>
    {
        const rect = canvas.el.getBoundingClientRect(); // 캔버스 크기
        let found = 0; // 지금까지 찾은 자리 수
        for (let sy = 40; sy + 40 < rect.height; sy += 30)
        {
            for (let sx = 40; sx + 40 < rect.width; sx += 30)
            {
                const p = canvas.toWorld(sx, sy); // 후보의 왼쪽 위
                const end = canvas.toScreen(p.x + w, p.y + h); // 후보의 오른쪽 아래(화면)
                if (end.x > rect.width - 20 || end.y > rect.height - 20)
                {
                    continue; // 화면 밖으로 나감
                }
                const hit = canvas.objects.some((o) => p.x < o.x + o.width + 12 && p.x + w + 12 > o.x && p.y < o.y + o.height + 12 && p.y + h + 12 > o.y); // 객체와 겹침
                if (!hit)
                {
                    if (found === skipCount)
                    {
                        return { x: p.x, y: p.y }; // 빈 자리
                    }
                    found += 1; // 다음 자리로
                }
            }
        }
        return null; // 빈 자리 없음
    }, width, height, skip);
}

async function freePoint(page, width, height, skip = 0)
{
    const spot = await freeSpot(page, width, height, skip); // 빈 자리
    expect(spot !== null, labels.get(page) + ' 화면에 빈 자리가 없습니다.'); // 보드가 가득 찬 경우
    return { from: await screenPoint(page, spot.x, spot.y), to: await screenPoint(page, spot.x + width, spot.y + height) }; // 화면 좌표의 두 모서리
}

// 지금 보드의 객체를 "ID:버전:위치" 목록으로 요약(화면끼리·서버와 비교용)
const boardKey = (page) => page.evaluate(() => canvas.objects.map((o) => o.object_id + ':' + o.version + ':' + o.x + ':' + o.y).sort().join('|'));
const serverKey = (page) => page.evaluate(async () => (await window.api.get('/api/boards/' + state.board.board_id + '/snapshot')).objects.map((o) => o.object_id + ':' + o.version + ':' + o.x + ':' + o.y).sort().join('|'));
const objectCount = (page) => page.evaluate(() => canvas.objects.length); // 화면의 객체 수

async function pressUndo(page)
{
    await page.keyboard.down('Control'); // Ctrl
    await page.keyboard.press('z'); // Z
    await page.keyboard.up('Control'); // Ctrl 해제
}

// 이동 도구로 화면을 끌어 옮긴다(dx·dy 는 화면 픽셀). 새 객체가 화면 가운데에 놓이므로, 기존 내용과 겹치지 않게 빈 곳을 가운데로 가져올 때 쓴다
async function panBy(page, dx, dy)
{
    await page.click('#toolbar [data-tool="pan"]'); // 이동 도구
    const times = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 300)); // 한 번에 300 픽셀까지만 끌기
    for (let i = 0; i < times; i++)
    {
        await page.mouse.move(640, 420); // 캔버스 가운데
        await page.mouse.down(); // 잡기
        await page.mouse.move(640 + dx / times, 420 + dy / times, { steps: 6 }); // 끌기
        await page.mouse.up(); // 놓기
    }
}

// 마우스를 누른 채 여러 점을 지나가게 한다(점 사이에 잠깐 쉬어 미리보기가 여러 번 나가게 함)
async function dragThrough(page, points, pauseMs)
{
    await page.mouse.move(points[0].x, points[0].y); // 시작점
    await page.mouse.down(); // 누르기
    for (const p of points.slice(1))
    {
        await page.mouse.move(p.x, p.y); // 다음 점
        await wait(pauseMs); // 전송 간격 확보
    }
}

// ---------- 지연 측정 ----------

// 화면의 소켓에 측정용 기록을 붙인다: 보낼 때와 받을 때의 시각을 이벤트별 열쇠와 함께 남긴다
function installProbe(page)
{
    return page.evaluate(() =>
    {
        const now = () => performance.timeOrigin + performance.now(); // 이 화면의 시각(ms)
        const lat = { sent: [], recv: [], acks: [], seq: {}, skew: 0 }; // 측정 기록
        let sum = 0; // 시계 보정 합계
        for (let i = 0; i < 200; i++)
        {
            sum += now() - Date.now(); // 화면 시계와 시스템 시계의 차이
        }
        lat.skew = sum / 200; // 화면마다 다른 시계 기준을 시스템 시계로 맞추는 보정값
        const next = (name, strokeId) =>
        {
            const id = name + ':' + strokeId; // 획마다 따로 세는 순번
            lat.seq[id] = (lat.seq[id] ?? 0) + 1; // 순번 증가
            return id + ':' + lat.seq[id]; // 보낸 쪽과 받는 쪽이 같은 순번으로 짝을 맞춤
        };
        const socket = realtime.socket; // 이 화면의 소켓
        const emit = socket.emit.bind(socket); // 원래 전송 함수
        socket.emit = (event, data, ...rest) =>
        {
            const t = now(); // 보낸 시각
            if (event === 'cursor:move')
            {
                lat.sent.push({ k: 'c:' + data.x + ':' + data.y, t }); // 커서
            }
            else if (event === 'stroke:preview')
            {
                lat.sent.push({ k: next('p-out', data.stroke_id).replace('p-out', 'p'), t }); // 펜 미리보기
            }
            else if (event === 'object:preview')
            {
                lat.sent.push({ k: 'm:' + data.object_id + ':' + data.x + ':' + data.y, t }); // 이동 미리보기
            }
            else if ((event === 'object:commit' || event === 'stroke:commit') && typeof rest[rest.length - 1] === 'function')
            {
                const reply = rest[rest.length - 1]; // 원래 응답 콜백
                lat.sent.push({ k: event === 'object:commit' ? 'u:' + data.object_id + ':' + (data.version + 1) : 's:' + data.stroke_id, t }); // 확정 결과가 다른 화면에 도착하는 시각과 짝을 맞출 열쇠
                rest[rest.length - 1] = (result) =>
                {
                    lat.acks.push({ event, ms: now() - t, ok: !!(result && result.ok) }); // 서버 저장 응답까지 걸린 시간
                    reply(result); // 원래 처리
                };
            }
            return emit(event, data, ...rest); // 실제 전송
        };
        socket.on('cursor:move', (d) => lat.recv.push({ k: 'c:' + d.x + ':' + d.y, t: now() })); // 커서 수신
        socket.on('stroke:preview', (d) => lat.recv.push({ k: next('p-in', d.stroke_id).replace('p-in', 'p'), t: now() })); // 펜 미리보기 수신
        socket.on('object:preview', (d) => lat.recv.push({ k: 'm:' + d.object_id + ':' + d.x + ':' + d.y, t: now() })); // 이동 미리보기 수신
        socket.on('object:updated', (d) => lat.recv.push({ k: 'u:' + d.object.object_id + ':' + d.object.version, t: now() })); // 변경 확정 수신
        socket.on('object:created', (d) => lat.recv.push({ k: 's:' + (d.object.payload ? d.object.payload.stroke_id : ''), t: now() })); // 펜 확정 수신
        window.__lat = lat; // 나중에 꺼내 볼 기록
    });
}

function summarize(values)
{
    const sorted = [...values].sort((x, y) => x - y); // 오름차순
    const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]; // 분위수
    return { n: sorted.length, median: sorted.length ? pick(0.5) : NaN, p95: sorted.length ? pick(0.95) : NaN, max: sorted.length ? sorted[sorted.length - 1] : NaN }; // 요약 통계
}

async function measureLatency(everyone)
{
    const joined = await all(everyone, (p) => p.evaluate(() => !!(realtime && realtime.socket && realtime.joined)).catch(() => false)); // 보드에 참여해 있는 화면
    const pages = everyone.filter((p, i) => joined[i]); // 앞 장면이 실패해 보드 밖에 있는 화면은 빼고 측정
    expect(joined[0] && pages.length >= 3, '보드에 참여한 화면이 부족해 측정할 수 없습니다(' + pages.length + '개).'); // 보내는 A 와 받는 화면 둘 이상 필요
    const [a, ...others] = pages; // A 가 보내고 나머지가 받음
    await all(pages, (p) => installProbe(p)); // 기록 장치 설치

    // 커서: 빈 곳에서 가로로 움직임
    const lane = await freePoint(a, 300, 30); // 커서가 지나갈 길
    for (let i = 0; i <= 50; i++)
    {
        await a.mouse.move(lane.from.x + (lane.to.x - lane.from.x) * (i / 50), lane.from.y + (i % 2) * 6); // 조금씩 이동
        await wait(22); // 전송 간격
    }
    const laneEndAt = Date.now(); // 커서 측정 구간의 끝(이 뒤의 커서 이동은 좌표가 겹칠 수 있어 통계에서 뺀다)
    await wait(250); // 마지막 커서가 도착할 여유

    // 펜: 획 두 개를 천천히 그림
    await a.click('#toolbar [data-tool="pen"]'); // 펜 도구
    for (let s = 0; s < 2; s++)
    {
        const area = await freePoint(a, 300, 40); // 그릴 자리
        const points = []; // 지나갈 점
        for (let i = 0; i <= 30; i++)
        {
            points.push({ x: area.from.x + (area.to.x - area.from.x) * (i / 30), y: area.from.y + 14 + Math.sin(i / 3) * 10 }); // 물결 선
        }
        const before = await objectCount(a); // 그리기 전 객체 수
        await dragThrough(a, points, 25); // 그리기
        await a.mouse.up(); // 확정
        await waitOn(a, '측정용 획 저장', (n) => canvas.objects.length === n + 1 && document.getElementById('save-status').dataset.state === 'saved', before); // 저장 대기
    }

    // 이동: 메모 하나를 잡고 좌우로 흔든 뒤 조금씩 옮겨 확정하기를 반복
    await a.click('#toolbar [data-tool="select"]'); // 선택 도구
    const grab = await centerOf(a, '아이디어'); // 잡을 메모
    for (let round = 0; round < 8; round++)
    {
        const shift = round % 2 === 0 ? 14 : -14; // 갔다가 돌아오기
        const points = [{ x: grab.x + (round % 2 === 0 ? 0 : 14), y: grab.y }]; // 시작점(직전 이동을 반영)
        for (let i = 1; i <= 6; i++)
        {
            points.push({ x: points[0].x + shift * (i / 6), y: grab.y + (i % 2) * 2 + 3 }); // 조금씩 이동(매번 3픽셀씩 내려가 같은 좌표가 다시 나오지 않게 함 — 보낸 것과 받은 것의 짝을 좌표로 맞추기 때문)
        }
        await a.mouse.move(points[0].x, points[0].y); // 메모 위로
        await a.mouse.down(); // 잡기(잠금 요청)
        await wait(350); // 잠금 획득 대기
        for (const p of points.slice(1))
        {
            await a.mouse.move(p.x, p.y); // 끌기
            await wait(25); // 전송 간격
        }
        await a.mouse.up(); // 놓기(확정 저장)
        await waitOn(a, '측정용 이동 저장', () => document.getElementById('save-status').dataset.state === 'saved' && canvas.moves.size === 0 && !move); // 저장 대기
    }
    await wait(500); // 마지막 수신 여유

    const data = await all(pages, (p) => p.evaluate(() => window.__lat)); // 화면별 기록
    const sender = data[0]; // A 의 기록
    const sent = sender.sent.map((s) => ({ k: s.k, at: s.t - sender.skew })).filter((s) => s.k[0] !== 'c' || s.at <= laneEndAt); // 시스템 시계 기준으로 보정한 전송 기록(커서는 측정 구간만)
    const kinds = { c: [], p: [], m: [], u: [] }; // 종류별 지연(ms)
    for (const receiver of data.slice(1))
    {
        const inbox = new Map(); // 열쇠 → 받은 시각 목록
        for (const r of receiver.recv)
        {
            const at = r.t - receiver.skew; // 시스템 시계 기준으로 보정
            if (r.k[0] !== 'c' || at <= laneEndAt + 250)
            {
                inbox.set(r.k, [...(inbox.get(r.k) ?? []), at]); // 커서는 측정 구간에 받은 것만
            }
        }
        for (const s of sent)
        {
            const queue = inbox.get(s.k); // 같은 열쇠로 받은 기록
            if (queue && queue.length > 0)
            {
                const kind = s.k[0] === 's' ? 'u' : s.k[0]; // 펜 확정도 "확정 결과 전달"로 묶음
                kinds[kind].push(queue.shift() - s.at); // 받은 시각 − 보낸 시각
            }
        }
    }
    const rows = [
        { name: '커서 전달', stat: summarize(kinds.c) },
        { name: '펜 미리보기 전달', stat: summarize(kinds.p) },
        { name: '이동 미리보기 전달', stat: summarize(kinds.m) },
        { name: '확정 저장 응답', stat: summarize(sender.acks.filter((x) => x.ok).map((x) => x.ms)) },
        { name: '확정 결과 전달', stat: summarize(kinds.u) },
    ]; // 측정 항목
    const format = (v) => (Number.isFinite(v) ? v.toFixed(1) + 'ms' : '-'); // 표시 형식
    const sentCount = (prefixes) => sent.filter((s) => prefixes.includes(s.k[0])).length * others.length; // 보낸 수 × 받는 화면 수
    const expectedCounts = [sentCount(['c']), sentCount(['p']), sentCount(['m']), null, sentCount(['u', 's'])]; // 항목별로 도착했어야 할 수(응답은 해당 없음)
    console.log('\n| 측정 (A 가 보냄 → 다른 화면 ' + others.length + '개) | 도착/보냄 | 중앙값 | 95% | 최대 |\n|---|---|---|---|---|'); // 표 머리
    rows.forEach((row, i) =>
    {
        console.log('| ' + row.name + ' | ' + row.stat.n + (expectedCounts[i] === null ? '' : '/' + expectedCounts[i]) + ' | ' + format(row.stat.median) + ' | ' + format(row.stat.p95) + ' | ' + format(row.stat.max) + ' |'); // 표 행(커서·이동 미리보기는 유실을 허용하는 전송이라 도착 수가 적을 수 있음)
    });
    console.log(''); // 빈 줄
    const [cursor, pen, drag, ack] = rows.map((r) => r.stat); // 판정에 쓸 통계
    expect(pen.n >= 20 && drag.n >= 20 && ack.n >= 8 && cursor.n >= 20, '표본이 부족합니다(펜 ' + pen.n + ', 이동 ' + drag.n + ', 커서 ' + cursor.n + ', 확정 ' + ack.n + ').'); // 측정 자체가 안 된 경우
    expect(Math.min(cursor.median, pen.median, drag.median) > -2, '화면 사이 시계 보정이 맞지 않아 지연을 믿을 수 없습니다.'); // 음수 지연
    expect(pen.median <= MAX_PREVIEW_MS && drag.median <= MAX_PREVIEW_MS, '미리보기 전달이 기준 ' + MAX_PREVIEW_MS + 'ms 보다 느립니다(펜 ' + format(pen.median) + ', 이동 ' + format(drag.median) + ').'); // 미리보기 기준
    expect(ack.median <= MAX_COMMIT_MS, '확정 저장 응답이 기준 ' + MAX_COMMIT_MS + 'ms 보다 느립니다(' + format(ack.median) + ').'); // 저장 기준
    return '미리보기 중앙값 펜 ' + format(pen.median) + '·이동 ' + format(drag.median) + ' (기준 ' + MAX_PREVIEW_MS + 'ms), 확정 저장 ' + format(ack.median) + ' (기준 ' + MAX_COMMIT_MS + 'ms)'; // 비고
}

// ---------- 시연 장면 ----------

async function rehearse(browser, env)
{
    const options = { rtPort: RT_PORT, view: { width: 1280, height: 800, deviceScaleFactor: 1 }, block: /youtube|ytimg|vimeo|googlevideo|doubleclick/, onError: (message) => pageErrors.push(message) }; // 탭 설정(외부 영상 요청은 보내지 않음)
    const a = await newUser(browser, options); // PC1 진행자(관리자)
    const b = await newUser(browser, options); // PC2 편집자
    const c = await newUser(browser, options); // PC3 편집자
    const d = await newUser(browser, options); // PC4 편집자 → 마지막에 열람자
    const pages = [a, b, c, d]; // 네 화면
    [NAMES.a, NAMES.b, NAMES.c, NAMES.d].forEach((name, i) => labels.set(pages[i], name)); // 오류 안내용 이름
    let taskId = 0; // 공유 업무 ID(6번에서 채움)

    await step('점검', '접속 점검 화면', async () =>
    {
        await a.goto(BASE + '/check.html'); // 접속 PC 가 시연 전에 여는 점검 화면
        await waitOn(a, '점검 완료', () => document.body.dataset.done === '1'); // 모든 항목이 끝날 때까지
        const rows = await a.evaluate(() => [...document.querySelectorAll('#check-rows tr')].map((tr) => ({ name: tr.querySelector('th').textContent, level: tr.dataset.level, text: tr.querySelector('td.detail').textContent }))); // 항목별 결과
        const failed = rows.filter((r) => r.level === 'fail'); // 실패한 항목
        expect(failed.length === 0, '실패 항목: ' + failed.map((r) => r.name + ' — ' + r.text).join(' / ')); // 실패가 없어야 함
        const level = (name) => (rows.find((r) => r.name === name) ?? {}).level; // 항목의 결과
        expect(['웹 서버', '실시간 서버 주소', '실시간 연결', '왕복 시간'].every((name) => level(name) === 'ok'), '서버 관련 항목이 모두 통과가 아닙니다: ' + rows.map((r) => r.name + '=' + r.level).join(', ')); // 서버에 닿는 네 항목
        return '웹 서버·실시간 서버 주소·실시간 연결·왕복 시간 통과(외부 영상은 요청을 막아 두어 주의로 나옴)';
    });

    await step('1', '입장', async () =>
    {
        await a.goto(BASE + '/'); // 소개 페이지
        await a.waitForSelector('#home-intro', { visible: true }); // 소개 구성 대기
        await a.click('#home-enter-top'); // 입장하기
        await a.waitForSelector('#view-join', { visible: true }); // 입장 화면
        await joinWorkspace(a, NAMES.a, env.adminCode); // 관리자 코드로 입장
        await b.goto(BASE + '/#code=' + env.editorCode); // 초대 링크로 열기
        await b.waitForSelector('#view-join', { visible: true }); // 소개를 건너뛰고 입장 화면
        expect((await b.$eval('#join-code', (el) => el.value)) === env.editorCode && !b.url().includes('code='), '초대 링크의 코드가 자동으로 채워지지 않았습니다.'); // 링크 동작
        await joinWorkspace(b, NAMES.b, null); // 채워진 코드로 입장
        for (const [page, name] of [[c, NAMES.c], [d, NAMES.d]])
        {
            await page.goto(BASE + '/'); // 소개 페이지
            await page.waitForSelector('#home-intro', { visible: true }); // 소개 구성 대기
            await page.click('#home-enter-top'); // 입장하기
            await page.waitForSelector('#view-join', { visible: true }); // 입장 화면
            await joinWorkspace(page, name, env.editorCode); // 편집자 코드로 입장
        }
        await a.reload(); // 참여자 목록 새로 읽기
        await a.waitForSelector('#home-workspace', { visible: true }); // 작업실 대기
        await waitOn(a, '작업실 참여자 4명', () => document.querySelectorAll('#ws-members li').length === 4); // 목록 확인
        const roles = await a.evaluate(async () => (await window.api.get('/api/projects/' + state.project.project_id + '/members')).members.map((m) => m.role).sort().join(',')); // 서버의 역할 목록
        expect(roles === 'admin,editor,editor,editor', '역할이 예상과 다릅니다: ' + roles); // 관리자 1·편집자 3
        return '참여자 4명(관리자 1·편집자 3), B 는 초대 링크로 입장';
    });

    await step('2', '보드 열기, 커서와 선택 표시', async () =>
    {
        for (const page of pages)
        {
            await openBoard(page, '기획 보드'); // 같은 보드 열기
        }
        await all(pages, (p) => waitOn(p, '상단 참여자 4명', () => document.querySelectorAll('#participants li').length === 4)); // 참여자 표시
        for (let i = 0; i < pages.length; i++)
        {
            const spot = await freePoint(pages[i], 40, 40, i * 6); // 사람마다 다른 빈 자리
            await pages[i].mouse.move(spot.from.x - 30, spot.from.y - 20); // 커서 이동 시작
            await pages[i].mouse.move(spot.from.x, spot.from.y, { steps: 6 }); // 커서 위치 공유
        }
        await all(pages, (p) => waitOn(p, '다른 사람 커서 3개', () => canvas.cursors.size === 3)); // 서로의 커서

        // B 가 메모를 눌러 고르면 나머지 3대에 B 의 이름으로 표시되고, Esc 로 풀면 사라진다
        const picked = await findObject(b, '아이디어'); // B 가 고를 메모
        expect(picked !== null, '예시 보드의 초록 메모를 찾지 못했습니다.'); // 예시가 바뀐 경우
        const pickAt = await centerOf(b, '아이디어'); // 메모 가운데
        await b.click('#toolbar [data-tool="select"]'); // B 는 선택 도구
        await b.mouse.click(pickAt.x, pickAt.y); // 눌러서 선택
        await all([a, c, d], (p) => waitOn(p, 'B 가 고른 메모의 표시', (id, name) => [...canvas.selections.values()].some((s) => s.display_name === name && s.object_ids.length === 1 && s.object_ids[0] === id) && canvas.locks.size === 0, picked.id, NAMES.b)); // 다른 화면의 표시(누르는 동안의 잠금은 풀린 뒤)
        expect((await b.evaluate(() => canvas.selections.size)) === 0, 'B 자신의 화면에 남의 선택으로 표시되었습니다.'); // 내 선택은 내 화면에서 남의 것으로 그리지 않음
        await b.keyboard.press('Escape'); // 선택 해제
        await all([a, c, d], (p) => waitOn(p, 'B 의 선택 표시 사라짐', () => canvas.selections.size === 0)); // 표시 제거
        return '4대 모두 참여자 4명과 서로의 커서 3개 표시. B 가 고른 메모가 3대에 B 의 이름으로 표시되고 풀면 사라짐';
    });

    await step('3', '펜 — 그리는 중 표시', async () =>
    {
        const before = await objectCount(a); // 그리기 전 객체 수
        await a.click('#toolbar [data-tool="pen"]'); // 펜 도구
        const area = await freePoint(a, 320, 50); // 그릴 자리
        const points = []; // 지나갈 점
        for (let i = 0; i <= 24; i++)
        {
            points.push({ x: area.from.x + (area.to.x - area.from.x) * (i / 24), y: area.from.y + 20 + Math.sin(i / 2) * 16 }); // 물결 선
        }
        await dragThrough(a, points.slice(0, 13), 30); // 절반까지 그림(아직 누른 상태)
        await all([b, c, d], (p) => waitOn(p, '그리는 중인 선(미리보기)', () => canvas.previews.size >= 1)); // 확정 전에 보임
        const savedEarly = (await objectCount(b)) !== before; // 확정 전에 저장되지는 않았는지
        for (const p of points.slice(13))
        {
            await a.mouse.move(p.x, p.y); // 나머지 그리기
            await wait(30); // 전송 간격
        }
        await a.mouse.up(); // 놓기(확정)
        await all(pages, (p) => waitOn(p, '확정된 선', (n) => canvas.objects.length === n + 1 && canvas.previews.size === 0, before)); // 네 화면 모두 반영
        expect(!savedEarly, '선이 확정되기 전에 객체로 저장되었습니다.'); // 미리보기는 저장하지 않음
        return '그리는 중에 3대에 미리보기, 놓은 뒤 4대에 확정';
    });

    await step('4', '잠금', async () =>
    {
        await all([a, b], (p) => p.click('#toolbar [data-tool="select"]')); // 둘 다 선택 도구
        const target = await findObject(b, '이번 주 할 일'); // 잡을 메모
        expect(target !== null, '예시 보드의 파란 메모를 찾지 못했습니다.'); // 예시가 바뀐 경우
        const grab = await centerOf(b, '이번 주 할 일'); // 메모 가운데
        await b.mouse.move(grab.x, grab.y); // 메모 위로
        await b.mouse.down(); // 잡기(잠금 요청)
        await wait(400); // 잠금 획득 대기
        await b.mouse.move(grab.x + 40, grab.y + 30, { steps: 8 }); // 끌고 멈춤
        await all([a, c, d], (p) => waitOn(p, '잠금 표시와 이동 미리보기', (id) => canvas.locks.has(id) && canvas.moves.has(id), target.id)); // 다른 화면의 표시
        const shown = await a.evaluate((id) =>
        {
            const o = canvas.objects.find((x) => x.object_id === id); // 대상 메모
            const m = canvas.moves.get(id); // 옮겨지는 중인 위치
            const rect = canvas.el.getBoundingClientRect(); // 캔버스 위치
            const s = canvas.toScreen(m.x + o.width / 2, m.y + o.height / 2); // 지금 보이는 가운데
            return { x: rect.left + s.x, y: rect.top + s.y };
        }, target.id); // A 화면에서 메모가 보이는 곳
        await a.mouse.click(shown.x, shown.y); // A 가 같은 메모를 클릭
        await waitOn(a, '"편집 중" 안내', () => !document.getElementById('toast').hidden && document.getElementById('toast').textContent.includes('편집 중인 객체')); // 안내 문구
        expect((await a.evaluate(() => canvas.selectedIds.size)) === 0, 'A 가 잠긴 메모를 선택했습니다.'); // 선택되면 안 됨
        await b.mouse.up(); // B 가 놓음(확정)
        await waitOn(b, 'B 의 이동 저장', () => document.getElementById('save-status').dataset.state === 'saved' && canvas.moves.size === 0); // 저장 대기
        const moved = await b.evaluate((id) => { const o = canvas.objects.find((x) => x.object_id === id); return { x: o.x, y: o.y }; }, target.id); // 옮긴 뒤 위치
        expect(moved.x !== target.x || moved.y !== target.y, '메모가 옮겨지지 않았습니다.'); // 실제로 이동했는지
        await all(pages, (p) => waitOn(p, '잠금 해제와 새 위치', (id, x, y) => { const o = canvas.objects.find((v) => v.object_id === id); return canvas.locks.size === 0 && o && o.x === x && o.y === y; }, target.id, moved.x, moved.y)); // 네 화면 모두 같은 위치
        return 'B 가 잡는 동안 3대에 잠금 표시, A 의 클릭은 안내만, 놓으면 4대에 새 위치';
    });

    await step('5', '이미지와 영상', async () =>
    {
        await panBy(c, 0, -1000); // C 는 아래쪽 빈 곳을 화면 가운데로(이미지는 화면 가운데에 놓임)
        const input = await c.$('#image-input'); // 이미지 파일 선택 입력
        await input.uploadFile(path.join(__dirname, 'fixtures', 'tiny.png')); // C 가 PNG 선택(대본의 드래그 대신 파일 선택 방식)
        await all(pages, (p) => waitOn(p, '이미지 객체', () => canvas.objects.some((o) => o.type === 'image'))); // 네 화면 모두 표시
        await panBy(d, -700, -1000); // D 는 오른쪽 아래 빈 곳을 화면 가운데로(영상 카드가 이미지와 겹치지 않게)
        await d.click('#tool-video'); // D 가 영상 추가
        await d.waitForSelector('#video-dialog[open]'); // 주소 입력 대화상자
        await d.type('#video-url', VIDEO_URL); // 주소 입력
        await d.keyboard.press('Enter'); // 추가
        await all(pages, (p) => waitOn(p, '영상 객체', () => canvas.objects.some((o) => o.type === 'video' && String(o.payload.embed_url).includes('youtube-nocookie.com/embed/')))); // 서버가 만든 임베드 주소
        return 'C 의 PNG 와 D 의 YouTube 주소가 4대에 표시(영상 재생은 확인하지 않음)';
    });

    await step('6', '공유 업무', async () =>
    {
        await b.select('#board-switch', String(env.boardDev)); // B 는 개발 보드로 전환
        await waitOn(b, '개발 보드 전환', (id) => state.board && state.board.board_id === id && document.getElementById('conn-status').dataset.state === 'online' && canvas.objects.some((o) => o.type === 'task'), env.boardDev); // 전환 완료
        const block = await centerOf(a, '로그인 화면 디자인'); // 기획 보드의 업무 블럭
        await a.mouse.click(block.x, block.y); // A 가 선택
        await a.waitForSelector('#task-props', { visible: true }); // 오른쪽 업무 패널
        taskId = await a.evaluate(() => [...state.tasks.values()].find((t) => t.title === '로그인 화면 디자인').task_id); // 업무 ID
        const beforeOnB = await b.evaluate((id) => ({ status: state.tasks.get(id).status, joined: realtime.joined, board: realtime.boardId }), taskId); // 바꾸기 직전의 B 화면
        expect(beforeOnB.status === 'doing' && beforeOnB.joined && beforeOnB.board === env.boardDev, 'B 가 개발 보드에 참여한 상태가 아니거나 업무가 이미 완료입니다.'); // 이후의 변화가 실시간 전달임을 보장

        // 체크리스트: A 가 업무 패널에서 남은 항목을 체크하고 새 항목을 더하면 다른 보드에 있는 B 의 같은 업무도 바뀐다
        const listBefore = await checklistItems(a, '#task-checklist'); // 예시 업무의 세부 항목
        expect(listBefore.length === 3 && listBefore.filter((i) => i.done).length === 2, '예시 업무의 체크리스트가 3개 중 2개 완료가 아닙니다.'); // 예시가 바뀐 경우
        const versionBefore = await a.evaluate((id) => state.tasks.get(id).version, taskId); // 항목을 바꾸기 전의 업무 버전
        await clickChecklist(a, '#task-checklist', '수정 반영', 'box'); // 남은 항목 체크
        await all(pages, (p) => waitOn(p, '체크리스트 3/3', (id) => { const t = state.tasks.get(id); return !!t && t.checklist.length === 3 && t.checklist.every((i) => i.done); }, taskId)); // 다른 보드의 B 포함
        await addChecklistItem(a, '#task-checklist', '발표 전 확인'); // 새 항목을 적고 Enter
        await all(pages, (p) => waitOn(p, '체크리스트 3/4', (id) => { const t = state.tasks.get(id); return !!t && t.checklist.length === 4 && t.checklist.filter((i) => i.done).length === 3 && t.checklist[3].title === '발표 전 확인'; }, taskId)); // 네 화면 모두
        expect((await a.evaluate((id) => state.tasks.get(id).version, taskId)) === versionBefore, '체크리스트를 바꿨는데 업무 버전이 올라갔습니다.'); // 항목은 업무 버전과 따로 저장

        await a.select('#task-status', 'done'); // 상태를 완료로
        await a.click('#task-save'); // 저장
        await all(pages, (p) => waitOn(p, '업무 상태 완료', (id) => state.tasks.get(id) && state.tasks.get(id).status === 'done', taskId)); // 다른 보드에 있는 B 도 포함
        expect((await checklistItems(a, '#task-checklist')).length === 4, '업무를 저장한 뒤 체크리스트가 달라졌습니다.'); // 상태를 바꿔도 항목은 그대로
        return 'A 가 기획 보드에서 체크리스트를 고치고(3/4) 완료로 바꾸자 개발 보드의 B 화면도 바뀜';
    });

    await step('7', '새로고침 후 복원', async () =>
    {
        await b.select('#board-switch', String(env.boardMain)); // B 는 기획 보드로 복귀
        await waitOn(b, '기획 보드 복귀', (id) => state.board && state.board.board_id === id && document.getElementById('conn-status').dataset.state === 'online', env.boardMain); // 복귀 완료
        await wait(300); // 마지막 저장 여유
        const expected = await serverKey(a); // 서버에 저장된 내용
        const viewsBefore = await all(pages, (p) => p.evaluate(() => ({ ...canvas.view }))); // 새로고침 전에 보던 위치·배율(C·D 는 5번에서 화면을 옮긴 상태)
        for (const page of pages)
        {
            await page.reload(); // F5
            await waitOn(page, '새로고침 뒤 보던 보드로 복귀', (id) => !document.getElementById('view-board').hidden && state.board && state.board.board_id === id && document.getElementById('conn-status').dataset.state === 'online', env.boardMain); // 작업실을 거치지 않고 바로 보드
        }
        await wait(300); // 다시 그리기 여유
        const seen = await all(pages, (p) => boardKey(p)); // 새로고침한 화면의 내용
        expect(seen.every((key) => key === expected), '새로고침 뒤 화면 내용이 저장된 내용과 다릅니다.'); // 그대로 복원
        const viewsAfter = await all(pages, (p) => p.evaluate(() => ({ ...canvas.view }))); // 새로고침 뒤 위치·배율
        expect(viewsAfter.every((v, i) => Math.abs(v.scale - viewsBefore[i].scale) < 1e-9 && Math.abs(v.x - viewsBefore[i].x) < 0.5 && Math.abs(v.y - viewsBefore[i].y) < 0.5), '새로고침 뒤 보던 위치·배율이 달라졌습니다.'); // 보던 자리 그대로
        expect(viewsBefore[2].y !== viewsBefore[0].y, 'C 의 화면이 옮겨져 있지 않아 위치 복원을 확인할 수 없습니다.'); // 기본 위치가 아닌 화면이 있어야 의미 있는 확인
        const status = await all(pages, (p) => p.evaluate((id) => state.tasks.get(id).status, taskId)); // 업무 상태
        expect(status.every((s) => s === 'done'), '새로고침 뒤 업무 상태가 완료가 아닙니다.'); // 6번 결과 유지
        await b.click('#board-back'); // B 는 작업실로 나갔다가
        await b.waitForSelector('#home-workspace', { visible: true }); // 작업실
        await b.reload(); // 작업실에서 새로고침하면
        await b.waitForSelector('#home-workspace', { visible: true }); // 보드가 아니라 작업실에 그대로 있어야 함
        expect(await b.evaluate(() => document.getElementById('view-board').hidden), '작업실에서 새로고침했는데 보드가 열렸습니다.'); // 보던 화면 기준으로 복원
        await openBoard(b, '기획 보드'); // B 다시 보드로
        return '새로고침만으로 4대가 보던 보드·위치로 복귀, 객체 ' + expected.split('|').length + '개와 업무 상태 그대로';
    });

    await step('8', '실행 취소·다시 실행과 PNG 저장', async () =>
    {
        const before = await objectCount(a); // 그리기 전 객체 수
        await a.click('#fit-view'); // ⤢ 화면 맞춤: 멀리 놓인 이미지·영상까지 한눈에(빈 자리도 넓어짐)
        await a.click('#toolbar [data-tool="rect"]'); // 사각형 도구
        const area = await freePoint(a, 110, 70); // 그릴 자리
        await a.mouse.move(area.from.x, area.from.y); // 시작점
        await a.mouse.down(); // 누르기
        await a.mouse.move(area.to.x, area.to.y, { steps: 6 }); // 끌기
        await a.mouse.up(); // 놓기
        await all(pages, (p) => waitOn(p, '새 사각형', (n) => canvas.objects.length === n + 1, before)); // 네 화면 모두 표시
        await pressUndo(a); // Ctrl+Z
        await all(pages, (p) => waitOn(p, '사각형 되돌리기', (n) => canvas.objects.length === n, before)); // 네 화면 모두 사라짐
        await a.click('#tool-redo'); // ↷ 다시 실행
        await all(pages, (p) => waitOn(p, '사각형 다시 실행', (n) => canvas.objects.length === n + 1 && canvas.objects.some((o) => o.type === 'rect' && o.width > 100), before)); // 네 화면 모두 다시 나타남
        await pressUndo(a); // 다시 Ctrl+Z
        await all(pages, (p) => waitOn(p, '다시 되돌리기', (n) => canvas.objects.length === n, before)); // 네 화면 모두 사라짐
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskcanvas-rehearsal-')); // 내려받기 폴더
        try
        {
            const client = await a.createCDPSession(); // 브라우저 설정 통로
            await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, browserContextId: a.browserContext().id }); // 저장 대화상자 없이 이 폴더에 저장
            await a.click('#tool-export'); // ⬇ PNG
            let file = null; // 저장된 파일
            for (let i = 0; i < 40 && !file; i++)
            {
                await wait(150); // 저장 대기
                file = fs.readdirSync(dir).find((name) => name.toLowerCase().endsWith('.png')) ?? null; // 완성된 PNG
            }
            expect(file !== null, 'PNG 파일이 저장되지 않았습니다.'); // 내려받기 실패
            const bytes = fs.readFileSync(path.join(dir, file)); // 파일 내용
            expect(bytes.length > 5000 && bytes.subarray(1, 4).toString() === 'PNG', '저장된 파일이 올바른 PNG 가 아닙니다.'); // 형식 확인
            return '사각형이 4대에서 생기고·되돌리고·다시 실행하고·되돌려짐, ' + file + ' 저장(' + Math.round(bytes.length / 1024) + 'KB, ' + bytes.readUInt32BE(16) + '×' + bytes.readUInt32BE(20) + ')';
        }
        finally
        {
            fs.rmSync(dir, { recursive: true, force: true }); // 임시 폴더 정리
        }
    });

    await step('9', '업무 현황판', async () =>
    {
        const MOVED = '실시간 서버 방 구현'; // 끌어 옮길 업무(예시에서는 '할 일', 마감 이틀 전)
        const CREATED = '리허설에서 만든 업무'; // 작업실에서 새로 만들 업무
        await d.click('#board-back'); // ‹ 작업실
        await d.waitForSelector('#home-workspace', { visible: true }); // 작업실
        await waitTaskBoard(d, 4).catch(() => { throw new Error(NAMES.d + ' 화면: 업무 현황판이 실시간으로 연결되지 않았습니다.'); }); // 카드 네 장과 연결 대기
        const before = await taskCards(d); // 옮기기 전 카드
        expect(before[MOVED] && before[MOVED].status === 'todo' && before[MOVED].due === 'soon:D-2', "'" + MOVED + "' 카드가 할 일 열에 마감 임박(D-2)으로 보이지 않습니다."); // 예시 업무와 임박 표시
        expect(before['발표 자료 초안'] && before['발표 자료 초안'].due === 'overdue:1일 지남', "'발표 자료 초안' 카드에 마감 지남 표시가 없습니다."); // 보드에 놓지 않은 업무와 지남 표시
        expect(before['로그인 화면 디자인'] && before['로그인 화면 디자인'].status === 'done', '6번에서 완료로 바꾼 업무가 완료 열에 없습니다.'); // 보드에서 바꾼 상태가 현황판에 반영
        const movedId = await d.evaluate((title) => [...state.tasks.values()].find((t) => t.title === title).task_id, MOVED); // 옮길 업무 ID
        await dragCard(d, MOVED, 'doing'); // D 가 카드를 진행 중 열로 끌어 놓음
        await all([a, b, c], (p) => waitOn(p, '보드의 업무 블럭이 진행 중으로', (id) => state.tasks.get(id) && state.tasks.get(id).status === 'doing', movedId)); // 보드에 있는 세 화면
        await waitOn(d, '카드가 진행 중 열에', (title) => [...document.querySelectorAll('#ws-taskboard .tb-col[data-status="doing"] .tb-card strong')].some((el) => el.textContent === title), MOVED); // D 의 현황판

        // 체크리스트: 카드에 진행률이 보이고, D 가 카드를 눌러 연 창에서 항목을 체크하면 카드와 보드의 세 화면에 전달된다
        const cardOf = (title) => d.evaluate((wanted) =>
        {
            const card = [...document.querySelectorAll('#ws-taskboard .tb-card')].find((el) => el.querySelector('strong').textContent === wanted); // 그 업무의 카드
            const progress = card ? card.querySelector('.tb-progress') : null; // 진행률 줄
            const r = card ? card.getBoundingClientRect() : null; // 카드 위치
            return { progress: progress ? progress.textContent : '', x: r ? r.left + r.width / 2 : 0, y: r ? r.top + r.height / 2 : 0 };
        }, title); // 카드의 진행률 글과 가운데 좌표
        const movedCard = await cardOf(MOVED); // 옮긴 카드
        expect(movedCard.progress === '1/4', "'" + MOVED + "' 카드의 진행률이 1/4 로 보이지 않습니다: " + movedCard.progress); // 예시 체크리스트
        await d.mouse.click(movedCard.x, movedCard.y); // 카드 누르기(끌지 않음)
        await d.waitForSelector('#ws-task-dialog[open]'); // 업무 대화상자
        await clickChecklist(d, '#ws-task-checklist', '커서 전달', 'box'); // 항목 체크
        await all([a, b, c], (p) => waitOn(p, '보드의 업무 진행률 2/4', (id) => { const t = state.tasks.get(id); return !!t && t.checklist.length === 4 && t.checklist.filter((i) => i.done).length === 2; }, movedId)); // 보드에 있는 세 화면
        await waitOn(d, '카드 진행률 2/4', (title) => [...document.querySelectorAll('#ws-taskboard .tb-card')].some((el) => el.querySelector('strong').textContent === title && el.querySelector('.tb-progress') && el.querySelector('.tb-progress').textContent === '2/4'), MOVED); // D 의 카드
        await d.click('#ws-task-cancel'); // 대화상자 닫기(체크는 이미 저장됨)
        await waitOn(d, '대화상자 닫힘', () => !document.getElementById('ws-task-dialog').open); // 닫힘
        await d.click('#ws-task-add'); // 새 업무
        await d.waitForSelector('#ws-task-dialog[open]'); // 업무 대화상자
        await d.type('#ws-task-title', CREATED); // 제목 입력
        await d.keyboard.press('Enter'); // 저장
        await all([a, b, c], (p) => waitOn(p, '작업실에서 만든 업무', (title) => [...state.tasks.values()].some((t) => t.title === title && t.status === 'todo'), CREATED)); // 보드에 있는 세 화면도 받음
        await waitOn(d, '새 카드', (title) => !document.getElementById('ws-task-dialog').open && [...document.querySelectorAll('#ws-taskboard .tb-col[data-status="todo"] .tb-card strong')].some((el) => el.textContent === title), CREATED); // D 의 현황판
        expect((await d.$eval('#ws-task-error', (el) => el.textContent)) === '', '현황판에 오류 안내가 떴습니다.'); // 오류 없음
        return 'D 가 작업실에서 카드를 끌어 진행 중으로 옮기고 체크리스트를 체크하고(2/4) 새 업무를 만들자 보드에 있는 3대에 전달, 마감 임박·지남 표시 확인';
    });

    await step('10', '열람자', async () =>
    {
        await d.click('#boards-leave'); // 나가기(D 는 9번에서 이미 작업실에 있음)
        await d.waitForSelector('#home-intro', { visible: true }); // 소개 페이지로 돌아옴
        await d.click('#home-enter-top'); // 입장하기
        await d.waitForSelector('#view-join', { visible: true }); // 입장 화면
        await joinWorkspace(d, NAMES.viewer, env.viewerCode); // 다른 이름 + 열람자 코드
        labels.set(d, NAMES.viewer); // 안내용 이름 변경
        expect((await d.$eval('#ws-summary', (el) => el.textContent)).includes('열람자'), '작업실 안내에 열람자 표시가 없습니다.'); // 역할 안내
        await openBoard(d, '기획 보드'); // 보드 열기
        const ui = await d.evaluate(() => ({
            tools: [...document.querySelectorAll('#toolbar [data-tool]')].every((btn) => btn.disabled || btn.dataset.tool === 'pan'), // 이동 말고는 모두 꺼짐
            media: ['tool-image', 'tool-video', 'tool-task', 'tool-undo', 'tool-redo'].every((id) => document.getElementById(id).disabled), // 추가·되돌리기·다시 실행 버튼 꺼짐
            note: document.getElementById('props-role-note').textContent, // 오른쪽 패널 안내
        })); // 열람자 화면 상태
        expect(ui.tools && ui.media && ui.note.startsWith('열람자'), '열람자 화면에서 도구가 꺼지지 않았습니다.'); // 화면 쪽 제한
        const before = (await serverKey(a)).split('|').length; // 저장된 객체 수
        const area = await freePoint(d, 100, 60); // 그리려고 해 볼 자리
        await d.mouse.move(area.from.x, area.from.y); // 시작점
        await d.mouse.down(); // 누르기
        await d.mouse.move(area.to.x, area.to.y, { steps: 5 }); // 끌기
        await d.mouse.up(); // 놓기
        const direct = await d.evaluate(() => realtime.request('object:create', { board_id: state.board.board_id, type: 'rect', x: 5, y: 5, width: 30, height: 30, style: {}, payload: {}, request_id: 'rehearsal-viewer' }).then(() => 'OK', (err) => err.code)); // 화면을 거치지 않고 서버에 직접 요청
        await wait(400); // 반영 여유
        expect(direct === 'FORBIDDEN', '서버가 열람자의 생성 요청을 거부하지 않았습니다: ' + direct); // 서버 쪽 제한
        expect((await serverKey(a)).split('|').length === before, '열람자의 조작으로 객체가 생겼습니다.'); // 아무것도 바뀌지 않음
        await waitOn(a, '참여자 목록에 열람자', (name) => [...document.querySelectorAll('#participants li')].some((li) => li.textContent.includes(name)), NAMES.viewer); // A 화면의 참여자

        // 열람자도 진행자를 따라갈 수 있다: D 가 A 의 이름을 한 번 눌러 그 자리로 가고, 한 번 더 눌러 계속 따라간다
        const chipOfA = (page) => page.evaluateHandle((name) => [...document.querySelectorAll('#participants .participant')].find((el) => el.textContent.startsWith(name)) ?? null, NAMES.a); // D 화면에 보이는 A 의 이름표
        const seenByD = () => d.evaluate(() => ({ view: { ...canvas.view }, following: follow.guestId, armed: follow.armed, banner: document.getElementById('follow-banner').hidden ? '' : document.getElementById('follow-text').textContent })); // D 의 화면 위치와 따라가기 상태
        const aCursorOnD = () => d.evaluate((name) =>
        {
            const p = participants.find((x) => x.display_name === name); // A
            const at = p ? lastSeen.get(p.guest_id) : null; // A 가 마지막으로 있던 곳
            return at ? { known: true, inView: canvas.isWellInView(at.x, at.y, 0.05) } : { known: false, inView: false };
        }, NAMES.a); // A 의 마지막 위치가 D 화면 안에 있는지
        const wiggle = async (page, x, y) =>
        {
            await page.mouse.move(x, y); // 커서 이동
            await page.mouse.move(x + 24, y + 16, { steps: 4 }); // 조금 더 움직여 위치를 여러 번 알림
        }; // 화면 위에서 마우스를 움직임
        await a.click('#toolbar [data-tool="pan"]'); // A 는 이동 도구(끌어도 그려지지 않게)
        await wiggle(a, 500, 400); // A 가 지금 있는 곳을 알림
        await waitOn(d, 'A 의 위치 수신', (name) => { const p = participants.find((x) => x.display_name === name); return !!p && lastSeen.has(p.guest_id); }, NAMES.a); // D 가 A 의 위치를 앎
        const chip = await chipOfA(d); // A 의 이름표
        expect((await chip.jsonValue()) !== null, 'D 화면에 A 의 이름표가 없습니다.'); // 누를 수 있는 이름표
        await chip.click(); // 한 번: A 가 있는 곳으로 이동
        await waitOn(d, '한 번 누른 상태', () => follow.armed !== null && follow.guestId === null); // 이동만 하고 아직 따라가지는 않음
        expect((await aCursorOnD()).inView, '이름을 눌렀는데 A 가 있는 곳이 D 화면에 들어오지 않았습니다.'); // 이동 확인
        await (await chipOfA(d)).click(); // 한 번 더: 계속 따라가기(이름표는 다시 그려지므로 새로 찾음)
        await waitOn(d, '따라가는 중 안내', (name) => follow.guestId !== null && !document.getElementById('follow-banner').hidden && document.getElementById('follow-text').textContent.includes(name), NAMES.a); // 안내 표시
        const before10 = await seenByD(); // 따라가기 시작할 때의 D 화면
        await panBy(a, -900, -700); // A 가 자기 화면을 멀리 옮김(A 의 커서는 이제 보드의 다른 곳을 가리킴)
        await wiggle(a, 640, 420); // 옮긴 곳에서 마우스를 움직임
        await waitOn(d, 'D 화면이 A 를 따라 이동', (x, y) => Math.abs(canvas.view.x - x) > 200 || Math.abs(canvas.view.y - y) > 200, before10.view.x, before10.view.y); // 화면이 따라 움직임
        expect((await aCursorOnD()).inView, '따라가는 중인데 A 가 있는 곳이 D 화면에 없습니다.'); // 따라간 곳에 A 가 보임
        await d.keyboard.press('Escape'); // Esc 로 해제
        await waitOn(d, '따라가기 해제', () => follow.guestId === null && document.getElementById('follow-banner').hidden); // 안내 사라짐
        const after10 = await seenByD(); // 해제한 뒤의 D 화면
        await wiggle(a, 300, 300); // A 가 다시 움직여도
        await wait(300); // 반영 여유
        expect(Math.abs((await seenByD()).view.x - after10.view.x) < 1, '따라가기를 풀었는데도 D 화면이 움직였습니다.'); // 더는 따라가지 않음
        await panBy(a, 900, 700); // A 화면을 원래 자리로
        await a.click('#toolbar [data-tool="select"]'); // A 는 다시 선택 도구
        return '도구가 꺼져 있고 서버도 생성 요청을 거부(FORBIDDEN). 열람자가 A 의 이름을 두 번 눌러 따라가고 Esc 로 해제';
    });

    await step('지연', '화면 사이 전달 지연', () => measureLatency(pages));

    await step('마무리', '네 화면과 서버 내용 일치', async () =>
    {
        await wait(400); // 마지막 전파 여유
        const expected = await serverKey(a); // 서버에 저장된 내용
        const seen = await all(pages, (p) => boardKey(p)); // 네 화면의 내용
        expect(seen.every((key) => key === expected), '화면 내용이 서버와 다른 PC 가 있습니다: ' + pages.filter((p, i) => seen[i] !== expected).map((p) => labels.get(p)).join(', ')); // 어긋난 화면
        const links = await all(pages, (p) => p.evaluate(() => canvas.links.length)); // 연결선 수
        expect(links.every((n) => n === links[0]), '연결선 수가 화면마다 다릅니다.'); // 연결선 일치
        expect(pageErrors.length === 0, '화면 스크립트 오류 ' + pageErrors.length + '건: ' + pageErrors[0]); // 스크립트 오류 없음
        return '객체 ' + expected.split('|').length + '개·연결선 ' + links[0] + '개가 4대와 서버에서 같고 스크립트 오류 없음';
    });

    let projectDeleted = false; // 지우기 장면에서 리허설 프로젝트까지 지웠는지
    await step('지우기', '업무 삭제와 작업실 삭제', async () =>
    {
        const UNPLACED = '리허설에서 만든 업무'; // 9번에서 만든 업무(보드에 놓지 않음)
        const PLACED = 'DB 스키마 검토'; // 기획 보드에 블럭이 놓인 업무
        const SLOW = 12000; // 작업실 삭제 알림은 실시간 서버가 5초마다 확인해 보내므로 넉넉히 기다림
        const blockId = await a.evaluate((title) =>
        {
            const t = [...state.tasks.values()].find((x) => x.title === title); // 블럭이 놓인 업무
            const o = t ? canvas.objects.find((x) => x.type === 'task' && x.task_id === t.task_id) : null; // 그 블럭
            return o ? o.object_id : null;
        }, PLACED); // 지워질 블럭
        expect(blockId !== null, "기획 보드에 '" + PLACED + "' 블럭이 없습니다."); // 예시가 바뀐 경우

        // B 가 작업실로 나가 현황판에서 업무 두 개를 지운다(하나는 보드에 놓이지 않은 업무, 하나는 블럭이 놓인 업무)
        await b.click('#board-back'); // ‹ 작업실
        await b.waitForSelector('#home-workspace', { visible: true }); // 작업실
        await waitTaskBoard(b, 5).catch(() => { throw new Error(NAMES.b + ' 화면: 업무 현황판이 실시간으로 연결되지 않았습니다.'); }); // 카드 다섯 장과 연결 대기
        for (const title of [UNPLACED, PLACED])
        {
            const at = await b.evaluate((wanted) =>
            {
                const card = [...document.querySelectorAll('#ws-taskboard .tb-card')].find((el) => el.querySelector('strong').textContent === wanted); // 지울 카드
                if (!card)
                {
                    return null;
                }
                card.scrollIntoView({ block: 'center' }); // 화면 안으로
                const r = card.getBoundingClientRect(); // 카드 위치
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            }, title); // 카드 가운데
            expect(at !== null, "현황판에 '" + title + "' 카드가 없습니다."); // 앞 장면이 바뀐 경우
            await b.mouse.click(at.x, at.y); // 카드 누르기
            await b.waitForSelector('#ws-task-dialog[open]'); // 업무 대화상자
            await b.click('#ws-task-delete'); // 업무 삭제
            await b.waitForSelector('#task-delete-dialog[open]'); // 확인 대화상자
            await b.click('#task-delete-form button[type="submit"]'); // 삭제
            await waitOn(b, "'" + title + "' 카드 사라짐", (wanted) => !document.getElementById('task-delete-dialog').open && !document.getElementById('ws-task-dialog').open
                && ![...document.querySelectorAll('#ws-taskboard .tb-card strong')].some((el) => el.textContent === wanted), title); // 두 대화상자가 닫히고 카드가 없어짐
        }
        await all([a, c, d], (p) => waitOn(p, '보드에서 업무와 블럭 사라짐', (id, t1, t2) => ![...state.tasks.values()].some((t) => t.title === t1 || t.title === t2) && !canvas.objects.some((o) => o.object_id === id), blockId, UNPLACED, PLACED)); // 보드에 있는 세 화면
        const saved = await a.evaluate(async (id) =>
        {
            const snapshot = await window.api.get('/api/boards/' + state.board.board_id + '/snapshot'); // 서버의 보드
            const tasks = await window.api.get('/api/projects/' + state.project.project_id + '/tasks'); // 서버의 업무
            return { block: snapshot.objects.some((o) => o.object_id === id), titles: tasks.tasks.map((t) => t.title) };
        }, blockId); // 서버에 남은 것
        expect(!saved.block && !saved.titles.includes(UNPLACED) && !saved.titles.includes(PLACED), '지운 업무나 블럭이 서버에 남아 있습니다.'); // 서버에서도 삭제
        expect((await d.$eval('#task-delete', (el) => el.disabled)) === true, '열람자 화면의 업무 삭제 버튼이 켜져 있습니다.'); // 열람자는 지울 수 없음

        // A 가 작업실로 나가 작업실을 지운다. 이름을 그대로 적어야 삭제 버튼이 켜진다
        await a.click('#board-back'); // ‹ 작업실
        await a.waitForSelector('#home-workspace', { visible: true }); // 작업실
        const title = await a.$eval('#boards-project-title', (el) => el.textContent); // 작업실 이름
        await a.click('#ws-delete'); // 작업실 삭제
        await a.waitForSelector('#project-delete-dialog[open]'); // 확인 대화상자(입력 칸에 초점)
        await a.keyboard.type(title.slice(0, -1)); // 이름을 한 글자 덜 적음
        expect(await a.$eval('#project-delete-submit', (el) => el.disabled), '이름이 다른데 삭제 버튼이 켜졌습니다.'); // 버튼 꺼짐
        await a.keyboard.press('Enter'); // Enter 로 제출해도
        await wait(300); // 처리 여유
        expect((await a.$eval('#project-delete-dialog', (el) => el.open)) && (await a.evaluate(() => window.api.get('/api/me').then(() => true, () => false))), '이름이 다른데 작업실이 지워졌습니다.'); // 지워지지 않음
        await a.keyboard.type(title.slice(-1)); // 마지막 글자까지 적음
        await a.click('#project-delete-submit'); // 작업실 삭제
        const onIntro = (page, words) => page.waitForFunction((text) => !document.getElementById('view-home').hidden && !document.getElementById('home-intro').hidden
            && !document.getElementById('home-notice').hidden && document.getElementById('home-notice').textContent.includes(text), { timeout: SLOW }, words)
            .catch(() => { throw new Error(labels.get(page) + ' 화면: 소개 화면의 삭제 안내 — ' + SLOW / 1000 + '초 안에 되지 않음'); }); // 소개 화면과 안내 대기
        await onIntro(a, '작업실을 삭제했습니다'); // 지운 사람
        await all([b, c, d], (p) => onIntro(p, '관리자가 삭제했습니다')); // 작업실에 있던 B, 보드에 있던 C 와 열람자 D
        const sessions = await all(pages, (p) => p.evaluate(() => window.api.get('/api/me').then(() => 200, (err) => err.status))); // 네 화면의 세션
        expect(sessions.every((s) => s === 401), '작업실을 지운 뒤에도 세션이 남은 화면이 있습니다: ' + sessions.join(',')); // 모두 끝남
        expect(pageErrors.length === 0, '화면 스크립트 오류 ' + pageErrors.length + '건: ' + pageErrors[0]); // 스크립트 오류 없음
        projectDeleted = true; // 초대 코드도 함께 사라짐
        return 'B 가 현황판에서 업무 두 개를 지우자 보드의 3대에서 업무와 블럭이 사라짐. A 가 이름을 적고 작업실을 지우자 4대 모두 소개 화면으로 돌아가고 세션이 끝남';
    });

    if (projectDeleted)
    {
        console.log('정리: 리허설 프로젝트를 화면에서 지웠습니다(초대 코드와 올린 이미지도 함께 삭제).'); // 정리 안내
        return;
    }
    const revoked = await a.evaluate(async () =>
    {
        const list = (await window.api.get('/api/projects/' + state.project.project_id + '/invites')).invites.filter((i) => i.status === 'active'); // 아직 쓸 수 있는 코드
        for (const invite of list)
        {
            await window.api.post('/api/invites/' + invite.invite_id + '/revoke'); // 취소
        }
        return list.length; // 취소한 수
    }).catch(() => -1); // 정리 실패는 결과에 영향 없음
    console.log(revoked >= 0 ? '정리: 리허설 프로젝트의 초대 코드 ' + revoked + '개 취소' : '정리: 초대 코드를 취소하지 못했습니다. scripts\\reset-demo.bat 으로 정리하세요.'); // 정리 안내
}

async function main()
{
    const servers = startServers(API_PORT, RT_PORT, { CORS_ORIGIN: 'auto' }); // 서버 시작(접속 출처 검사는 기본값으로)
    let browser = null; // 브라우저 핸들
    let exitCode = 0; // 종료 코드
    try
    {
        await waitFor(BASE + '/api/health'); // PHP 준비
        await waitFor('http://127.0.0.1:' + RT_PORT + '/health'); // 실시간 준비
        const env = setupProject(); // 프로젝트·예시 보드·초대 코드
        console.log('리허설 프로젝트 project_id=' + env.projectId + ' (보드 ' + env.boardMain + '·' + env.boardDev + '), 브라우저 4개로 시작'); // 환경 출력
        browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--window-size=1280,800', '--lang=ko-KR', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] }); // 설치된 브라우저 실행(뒤에 있는 탭도 느려지지 않게)
        await rehearse(browser, env); // 장면 실행
    }
    catch (err)
    {
        console.error('리허설 실행 오류', err); // 실행 오류
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
    console.log('\n| # | 장면 | 결과 | 비고 |\n|---|---|---|---|'); // 표 머리
    for (const r of results)
    {
        console.log('| ' + r.no + ' | ' + r.title + ' | ' + (r.ok ? '통과' : '실패') + ' | ' + r.detail + ' |'); // 표 행
    }
    const failed = results.filter((r) => !r.ok).length; // 실패한 장면
    console.log('\n리허설 ' + (results.length - failed) + ' 통과, ' + failed + ' 실패'); // 요약
    process.exit(exitCode || (failed > 0 ? 1 : 0)); // 종료
}

main(); // 시작
