// 접속 PC 점검 화면: 이 PC 의 브라우저에서 웹 서버·실시간 서버·외부 영상에 닿는지 차례로 확인해 표로 보여 준다
// 입장(세션) 없이 동작하고 서버에 아무것도 저장하지 않는다. 서버 PC 쪽 점검은 scripts\check-env.bat
'use strict';

const LABELS = { wait: '확인 중', ok: '통과', warn: '주의', fail: '실패', info: '안내' }; // 결과 문구
const RT = window.TC_CONFIG.realtimeUrl; // 실시간 서버 주소(이 화면과 같은 호스트의 3001 포트)
const SLOW_MS = 150; // 왕복 시간이 이보다 길면 주의(리허설의 미리보기 지연 기준과 같은 값)

// 표에 한 줄을 추가하고, 그 줄의 결과를 채우는 함수를 돌려준다
function addRow(name)
{
    const tr = document.createElement('tr'); // 점검 항목 한 줄
    const head = document.createElement('th'); // 항목 이름
    const state = document.createElement('td'); // 결과
    const detail = document.createElement('td'); // 내용
    head.scope = 'row'; // 행 제목
    head.textContent = name; // 항목 이름 표시
    state.className = 'state'; // 결과 칸 스타일
    detail.className = 'detail'; // 내용 칸 스타일
    tr.dataset.level = 'wait'; // 아직 확인 전
    state.textContent = LABELS.wait; // "확인 중"
    tr.append(head, state, detail); // 칸 조립
    document.getElementById('check-rows').appendChild(tr); // 표에 추가
    return (level, text) =>
    {
        tr.dataset.level = level; // 결과 수준(색상)
        state.textContent = LABELS[level]; // 결과 문구
        detail.textContent = text; // 설명
    };
}

function median(values)
{
    const sorted = [...values].sort((a, b) => a - b); // 오름차순
    return sorted[Math.floor(sorted.length / 2)]; // 가운데 값
}

// 정해진 시간 안에 끝나지 않으면 실패로 처리한다
function within(ms, work)
{
    return new Promise((resolve, reject) =>
    {
        const timer = setTimeout(() => reject(new Error('시간 초과')), ms); // 제한 시간
        work.then((value) =>
        {
            clearTimeout(timer); // 타이머 해제
            resolve(value); // 성공
        }, (err) =>
        {
            clearTimeout(timer); // 타이머 해제
            reject(err); // 실패
        });
    });
}

function checkBrowser(set)
{
    const chromium = /Chrome\/(\d+)/.exec(navigator.userAgent); // Chrome·Edge 의 엔진 버전
    const name = /Edg\//.test(navigator.userAgent) ? 'Edge' : 'Chrome'; // 브라우저 이름
    const size = window.innerWidth + '×' + window.innerHeight; // 창 크기
    if (!navigator.cookieEnabled)
    {
        set('fail', '쿠키가 꺼져 있어 입장 상태를 유지할 수 없습니다. 브라우저 설정에서 쿠키를 허용하세요.'); // 세션 쿠키 필요
    }
    else if (!chromium)
    {
        set('warn', '이 브라우저에서는 동작을 확인하지 않았습니다. Chrome 이나 Edge 를 쓰세요.'); // 확인한 브라우저가 아님
    }
    else if (window.innerWidth < 1100)
    {
        set('warn', name + ' ' + chromium[1] + ', 창 ' + size + ' — 창이 좁습니다. 보드는 PC 화면 전체 크기에 맞춰져 있으니 창을 최대화하세요.'); // 좁은 창
    }
    else
    {
        set('ok', name + ' ' + chromium[1] + ', 창 ' + size); // 사용 가능
    }
}

async function checkWeb(set)
{
    try
    {
        const times = []; // 응답 시간(ms)
        let health = null; // 마지막 상태 응답
        for (let i = 0; i < 5; i++)
        {
            const started = performance.now(); // 요청 시각
            const res = await within(4000, fetch(window.TC_CONFIG.apiBase + '/api/health', { cache: 'no-store' })); // 상태 확인
            health = await res.json(); // 상태 JSON
            times.push(performance.now() - started); // 걸린 시간
        }
        if (health && health.db === true)
        {
            const viaName = location.hostname === 'localhost' ? ' (localhost 주소로 열면 요청마다 0.2초쯤 더 걸립니다. 다른 PC 와 같은 조건으로 보려면 서버 IP 주소로 여세요.)' : ''; // 이름 풀이 때문에 느린 주소 안내
            set('ok', '응답 중앙값 ' + median(times).toFixed(1) + 'ms, DB 연결됨' + viaName); // 정상
        }
        else
        {
            set('fail', '웹 서버는 응답하지만 DB 에 연결되어 있지 않습니다. 서버 PC 의 XAMPP 에서 MySQL 을 Start 하세요.'); // DB 꺼짐
        }
    }
    catch (err)
    {
        set('fail', '웹 서버의 상태 주소(/api/health)가 응답하지 않습니다. 서버 PC 의 PHP 서버 창을 확인하세요.'); // 응답 없음
    }
}

// 실시간 서버가 제공하는 Socket.IO 클라이언트 파일을 불러온다(3001 포트가 열려 있는지의 확인을 겸함)
function loadClient()
{
    return within(6000, new Promise((resolve, reject) =>
    {
        const script = document.createElement('script'); // 스크립트 태그
        script.src = RT + '/socket.io/socket.io.js'; // 실시간 서버의 클라이언트 파일
        script.onload = () => resolve(); // 받음
        script.onerror = () => reject(new Error('불러오기 실패')); // 닿지 않음
        document.head.appendChild(script); // 문서에 추가
    }));
}

// 입장 없이 연결만 해 본다. 연결되면 소켓을, 거부되면 오류를 돌려준다
function connect(transports)
{
    return new Promise((resolve, reject) =>
    {
        const socket = window.io(RT, { transports, reconnection: false, timeout: 5000 }); // 한 번만 시도
        socket.on('connect', () => resolve(socket)); // 연결됨
        socket.on('connect_error', (err) =>
        {
            socket.close(); // 정리
            reject(err); // 거부·시간 초과
        });
    });
}

function ping(socket)
{
    return new Promise((resolve) =>
    {
        const started = performance.now(); // 보낸 시각
        const timer = setTimeout(() => resolve(null), 2000); // 응답 없음
        socket.emit('net:ping', {}, () =>
        {
            clearTimeout(timer); // 타이머 해제
            resolve(performance.now() - started); // 왕복 시간
        });
    });
}

async function checkRealtime(setFile, setLink, setPing)
{
    try
    {
        await loadClient(); // 클라이언트 파일 받기
        setFile('ok', RT + ' 에 닿음'); // 포트 열림
    }
    catch (err)
    {
        setFile('fail', RT + ' 에 닿지 않습니다. 서버 PC 의 실시간 서버 창이 떠 있는지, 방화벽에서 3001 포트가 허용되어 있는지 확인하세요.'); // 서버 꺼짐·포트 차단
        setLink('fail', '앞 항목이 실패해 연결할 수 없습니다.'); // 연결 불가
        setPing('info', '측정하지 못했습니다.'); // 측정 불가
        return;
    }
    let socket = null; // 연결된 소켓
    let polling = false; // 느린 방식으로만 연결되었는지
    try
    {
        socket = await connect(['websocket']); // 평소 쓰는 방식
    }
    catch (err)
    {
        try
        {
            socket = await connect(['polling']); // 웹소켓이 막힌 네트워크의 대체 방식
            polling = true; // 느린 방식
        }
        catch (err2)
        {
            setLink('fail', '서버가 연결을 받아 주지 않습니다. 서버의 접속 출처 설정(apps/realtime/.env 의 CORS_ORIGIN)이 이 주소(' + location.origin + ')를 허용하는지 확인하세요. 기본값 auto 면 허용됩니다.'); // 출처 거부
            setPing('info', '측정하지 못했습니다.'); // 측정 불가
            return;
        }
    }
    setLink(polling ? 'warn' : 'ok', polling ? '웹소켓이 막혀 있어 느린 방식(폴링)으로만 연결됩니다. 그리는 중인 선이 끊겨 보일 수 있습니다.' : '웹소켓으로 연결됨'); // 연결 방식
    const times = []; // 왕복 시간(ms)
    for (let i = 0; i < 10; i++)
    {
        const took = await ping(socket); // 한 번 왕복
        if (took === null)
        {
            break; // 응답 없음
        }
        times.push(took); // 기록
    }
    socket.disconnect(); // 확인이 끝났으니 끊음
    if (times.length < 10)
    {
        setPing('info', '서버가 왕복 시간 측정에 응답하지 않습니다. 서버 PC 의 코드를 최신으로 맞추고 실시간 서버를 다시 띄우세요.'); // 예전 서버
    }
    else
    {
        const mid = median(times); // 중앙값
        setPing(mid <= SLOW_MS ? 'ok' : 'warn', '중앙값 ' + mid.toFixed(1) + 'ms, 최대 ' + Math.max(...times).toFixed(1) + 'ms' + (mid <= SLOW_MS ? '' : ' — 느립니다. 다른 화면의 선이 늦게 따라올 수 있습니다.')); // 지연 판정
    }
}

async function checkVideo(set)
{
    try
    {
        await within(5000, fetch('https://www.youtube-nocookie.com/', { mode: 'no-cors', cache: 'no-store' })); // 임베드에 쓰는 주소(내용은 읽지 않고 닿는지만 봄)
        set('ok', 'YouTube 임베드 주소에 닿음'); // 접속 가능
    }
    catch (err)
    {
        set('warn', 'YouTube 에 닿지 않습니다. 이 네트워크에서는 영상이 재생되지 않으니 시연의 영상 장면은 건너뛰세요.'); // 차단·오프라인
    }
}

async function run()
{
    const browser = addRow('브라우저'); // 1
    const web = addRow('웹 서버'); // 2
    const file = addRow('실시간 서버 주소'); // 3
    const link = addRow('실시간 연결'); // 4
    const round = addRow('왕복 시간'); // 5
    const video = addRow('외부 영상'); // 6
    checkBrowser(browser); // 브라우저 종류·쿠키·창 크기
    await checkWeb(web); // 웹 서버와 DB
    await checkRealtime(file, link, round); // 실시간 서버 접근·연결·왕복 시간
    await checkVideo(video); // 외부 영상 접속
    const levels = [...document.querySelectorAll('#check-rows tr')].map((tr) => tr.dataset.level); // 줄별 결과
    const fails = levels.filter((level) => level === 'fail').length; // 실패 수
    const warns = levels.filter((level) => level === 'warn').length; // 주의 수
    const summary = document.getElementById('check-summary'); // 요약 줄
    summary.dataset.level = fails > 0 ? 'fail' : warns > 0 ? 'warn' : 'ok'; // 요약 색상
    summary.textContent = fails > 0 ? '실패 ' + fails + '개 — 이 PC 는 아직 시연에 참여할 수 없습니다.' : warns > 0 ? '참여할 수 있습니다. 주의 ' + warns + '개의 내용을 확인하세요.' : '이 PC 는 시연에 참여할 준비가 되었습니다.'; // 요약 문구
    document.body.dataset.done = '1'; // 점검 끝(자동 리허설이 이 표시를 기다림)
}

document.getElementById('check-again').addEventListener('click', () => location.reload()); // 다시 점검
run(); // 시작
