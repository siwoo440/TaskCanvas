// 학교 PC 사전 점검(실시간 서버·네트워크 쪽): Node 버전·패키지·설정·DB·포트·LAN 주소·방화벽·외부 영상 접속을 확인한다
// 사용법: node scripts/check-env.js   (scripts\check-env.bat 가 PHP 쪽 점검과 함께 실행)
//   WEB_PORT: 웹(PHP) 포트가 8080 이 아닐 때, PHP_BIN: PHP 실행 파일이 C:/xampp/php/php.exe 가 아닐 때
// 이 PC 안에서 볼 수 있는 것만 확인한다. 다른 PC 에서 실제로 열리는지는 마지막에 출력하는 주소로 직접 확인해야 한다
'use strict';

const { execFileSync } = require('child_process'); // PowerShell 실행
const fs = require('fs'); // 파일 확인
const net = require('net'); // 포트 사용 여부 확인
const os = require('os'); // 네트워크 주소 조회
const path = require('path'); // 경로 계산

const APP = path.join(__dirname, '..'); // apps/realtime 폴더
const WEB_PORT = Number(process.env.WEB_PORT || 8080); // 웹(PHP) 포트
const PHP = process.env.PHP_BIN || (process.platform === 'win32' ? 'C:\\xampp\\php\\php.exe' : 'php'); // PHP 실행 파일(방화벽 규칙 대조용)
const counts = { ok: 0, warn: 0, fail: 0 }; // 결과별 항목 수
const LABELS = { ok: '통과', warn: '주의', fail: '실패', info: '안내' }; // 표시 문구

function report(level, name, detail)
{
    if (counts[level] !== undefined)
    {
        counts[level] += 1; // 집계(안내는 세지 않음)
    }
    console.log('[' + LABELS[level] + '] ' + name + ' — ' + detail); // 한 줄 출력
}

// 주소가 2초 안에 응답하면 본문(JSON 이면 객체)을, 아니면 null 을 돌려준다
async function probe(url)
{
    try
    {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) }); // 짧게 기다림
        if (!res.ok)
        {
            return null; // 오류 응답
        }
        const text = await res.text(); // 응답 본문
        try
        {
            return JSON.parse(text); // 상태 JSON
        }
        catch (err)
        {
            return {}; // JSON 이 아니어도 응답은 있음
        }
    }
    catch (err)
    {
        return null; // 연결 실패·시간 초과
    }
}

// 이 PC 의 포트에 접속해 보고, 받아 주는 프로그램이 없으면 비어 있다고 본다
// (포트를 직접 열어 보는 방식은 Windows 에서 다른 주소에 묶인 포트와 겹쳐 열릴 수 있어 쓰지 않는다)
function accepts(host, port)
{
    return new Promise((resolve) =>
    {
        const socket = net.connect({ host, port }); // 접속 시도
        const done = (result) =>
        {
            socket.destroy(); // 연결 정리
            resolve(result); // 결과 전달
        };
        socket.setTimeout(1000, () => done(false)); // 응답 없음
        socket.once('connect', () => done(true)); // 누군가 받고 있음
        socket.once('error', () => done(false)); // 거부됨 = 듣는 프로그램 없음
    });
}

async function portFree(port)
{
    return !(await accepts('127.0.0.1', port)) && !(await accepts('::1', port)); // IPv4·IPv6 어느 쪽도 받지 않아야 비어 있음
}

function lanAddresses()
{
    const list = []; // IPv4 주소 목록
    for (const [name, items] of Object.entries(os.networkInterfaces()))
    {
        for (const item of items ?? [])
        {
            if (item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.'))
            {
                list.push({ name, address: item.address }); // 다른 PC 가 접속할 수 있는 주소
            }
        }
    }
    return list; // 연결된 네트워크 주소
}

// ---------- 방화벽(Windows) ----------

// 방화벽 규칙은 레지스트리에 "v2.30|Action=Allow|Active=TRUE|Dir=In|Protocol=6|LPort=8080|App=…|Profile=Private|Name=…|" 형식으로 저장된다.
// 규칙 조회 명령(Get-NetFirewallPortFilter)은 관리자 권한이 필요하지만 이 값은 일반 사용자도 읽을 수 있고 Windows 표시 언어와도 무관하다
const FIREWALL_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$out = @{ profiles = @(); active = @(); rules = @() }
foreach ($p in Get-NetFirewallProfile) { $out.profiles += @{ name = "$($p.Name)"; enabled = ("$($p.Enabled)" -eq 'True'); inbound = "$($p.DefaultInboundAction)" } }
foreach ($n in Get-NetConnectionProfile) { $out.active += "$($n.NetworkCategory)" }
$keys = @('HKLM:\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\FirewallRules', 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\WindowsFirewall\\FirewallRules')
foreach ($key in $keys) {
    if (-not (Test-Path $key)) { continue }
    $item = Get-Item $key
    foreach ($name in $item.GetValueNames()) {
        $value = "$($item.GetValue($name))"
        if ($value -like '*|Active=TRUE|*' -and $value -like '*|Dir=In|*') { $out.rules += $value }
    }
}
$out | ConvertTo-Json -Depth 3 -Compress
`;

function readFirewall()
{
    const encoded = Buffer.from(FIREWALL_SCRIPT, 'utf16le').toString('base64'); // 따옴표 문제를 피하려고 인코딩해서 전달
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] }); // 프로필·규칙 조회
    return JSON.parse(out.slice(out.indexOf('{'))); // JSON 결과
}

const PLAIN_KEYS = new Set(['Active', 'Dir', 'Desc', 'EmbedCtxt', 'Defer', 'Edge']); // 적용 범위를 좁히지 않는 항목

// 레지스트리의 규칙 한 줄을 {action, protocols, ports, app, profiles, name, scoped} 으로 풀어 낸다
function parseRule(text)
{
    const rule = { action: '', protocols: [], ports: [], app: '', profiles: [], name: '', scoped: false }; // 해석 결과
    for (const part of text.split('|'))
    {
        const index = part.indexOf('='); // 키와 값 구분
        if (index < 0)
        {
            continue; // 버전 표기 등
        }
        const key = part.slice(0, index); // 항목 이름
        const value = part.slice(index + 1); // 항목 값
        if (key === 'Action')
        {
            rule.action = value; // Allow 또는 Block
        }
        else if (key === 'Protocol')
        {
            rule.protocols.push(value); // 6 = TCP
        }
        else if (key === 'LPort' || key.startsWith('LPort2'))
        {
            rule.ports.push(value); // 단일 포트 또는 범위(8000-8100)
        }
        else if (key === 'App')
        {
            rule.app = value.replace(/%([^%]+)%/g, (all, name) => process.env[name] ?? all).toLowerCase(); // 환경 변수를 풀어 낸 프로그램 경로
        }
        else if (key === 'Profile')
        {
            rule.profiles.push(value); // Domain·Private·Public
        }
        else if (key === 'Name')
        {
            rule.name = value.startsWith('@') ? 'Windows 기본 규칙' : value; // 리소스 참조 이름은 풀지 않음
        }
        else if (/^RA[46]/.test(key))
        {
            rule.scoped = rule.scoped || value !== 'LocalSubnet'; // 상대 주소 제한은 같은 서브넷일 때만 우리 시연에 해당
        }
        else if (!PLAIN_KEYS.has(key))
        {
            rule.scoped = true; // 서비스·스토어 앱·사용자·인터페이스 등으로 범위가 좁혀진 규칙(일반 프로그램에는 적용되지 않음)
        }
    }
    return rule; // 해석한 규칙
}

// 규칙이 이 프로그램의 이 포트(TCP)에, 지금 방화벽이 지키는 네트워크 모두에서 적용되는지
function ruleMatches(rule, target, guarded)
{
    const tcp = rule.protocols.length === 0 || rule.protocols.includes('6'); // 프로토콜 제한이 없거나 TCP
    const program = rule.app === '' || rule.app === target.exe.toLowerCase(); // 프로그램 제한이 없거나 같은 실행 파일
    const port = rule.ports.length === 0 || rule.ports.some((p) =>
    {
        const range = /^(\d+)-(\d+)$/.exec(p); // 범위 표기
        return range ? target.port >= Number(range[1]) && target.port <= Number(range[2]) : Number(p) === target.port; // 범위 또는 단일 포트
    }); // 포트 제한이 없거나 대상 포트 포함
    const profile = rule.profiles.length === 0 || guarded.every((name) => rule.profiles.includes(name)); // 프로필 제한이 없거나 모두 포함
    return !rule.scoped && tcp && program && port && profile; // 범위가 좁혀지지 않았고 모두 맞아야 적용
}

function checkFirewall(targets)
{
    if (process.platform !== 'win32')
    {
        return report('info', '방화벽', 'Windows 가 아니어서 건너뜁니다. 사용하는 방화벽에서 포트 ' + targets.map((t) => t.port).join(', ') + ' 을 직접 허용하세요.'); // 다른 OS
    }
    let fw = null; // 조회 결과
    try
    {
        fw = readFirewall(); // 프로필과 규칙 읽기
    }
    catch (err)
    {
        return report('warn', '방화벽', '규칙을 읽지 못했습니다(권한 또는 학교 PC 정책). 다른 PC 에서 아래 주소가 열리는지 직접 확인하세요.'); // 조회 불가
    }
    const toProfile = (category) => (category === 'DomainAuthenticated' ? 'Domain' : category); // 네트워크 종류 → 프로필 이름
    const active = (fw.active.length > 0 ? fw.active : ['Public']).map(toProfile); // 연결된 네트워크의 프로필(모르면 가장 엄격한 쪽으로 가정)
    const guarded = active.filter((name) => fw.profiles.some((p) => p.name === name && p.enabled && p.inbound !== 'Allow')); // 방화벽이 실제로 들어오는 연결을 막는 프로필
    if (guarded.length === 0)
    {
        return report('ok', '방화벽', '연결된 네트워크(' + active.join(', ') + ')에서 Windows 방화벽이 들어오는 연결을 막지 않습니다.'); // 막는 것이 없음
    }
    const rules = fw.rules.map(parseRule); // 켜져 있는 인바운드 규칙
    for (const target of targets)
    {
        const blocked = rules.find((r) => r.action === 'Block' && r.app === target.exe.toLowerCase() && ruleMatches(r, target, guarded.slice(0, 1))); // 이 프로그램을 막는 규칙(허용보다 우선)
        const allowed = rules.find((r) => r.action === 'Allow' && ruleMatches(r, target, guarded)); // 이 포트를 여는 규칙
        if (blocked)
        {
            report('fail', '방화벽 ' + target.port, target.label + ' 차단 규칙이 있습니다: ' + blocked.name + '. 방화벽 알림에서 "취소"를 누르면 생깁니다. Windows 보안 → 방화벽 → 앱 허용에서 허용으로 바꾸세요.'); // 차단이 허용보다 우선
        }
        else if (allowed)
        {
            report('ok', '방화벽 ' + target.port, target.label + ' 허용 규칙 있음: ' + allowed.name + ' (' + (allowed.profiles.length > 0 ? allowed.profiles.join(', ') : '모든 프로필') + ')'); // 허용됨
        }
        else
        {
            report('fail', '방화벽 ' + target.port, target.label + ' 포트를 여는 규칙이 없습니다(네트워크 ' + guarded.join(', ') + '). docs/15 의 2-3 방화벽 명령을 관리자 PowerShell 에서 실행하세요.'); // 다른 PC 가 접속하지 못함
        }
    }
}

// ---------- 점검 순서 ----------

async function main()
{
    console.log('--- 실시간 서버·네트워크 점검 ---'); // 구역 제목

    // 1) Node 버전
    const major = Number(process.versions.node.split('.')[0]); // 주 버전
    if (major >= 18)
    {
        report('ok', 'Node.js 버전', process.versions.node + ' (' + process.execPath + ')'); // 사용 가능
    }
    else
    {
        report('fail', 'Node.js 버전', process.versions.node + ' — 18 이상이 필요합니다. Node.js LTS 를 설치하세요.'); // 너무 낮음
    }

    // 2) 패키지 설치
    let packagesReady = true; // 설치 여부
    for (const name of ['socket.io', 'mysql2'])
    {
        try
        {
            require.resolve(name, { paths: [APP] }); // 설치 확인
        }
        catch (err)
        {
            packagesReady = false; // 미설치
        }
    }
    if (packagesReady)
    {
        report('ok', '패키지', 'socket.io, mysql2 설치됨'); // 설치됨
    }
    else
    {
        report('fail', '패키지', 'apps/realtime 폴더에서 npm install 을 실행하세요(인터넷 연결 필요).'); // 설치 필요
    }

    // 3) 설정 파일과 접속 출처
    const env = require('../src/env'); // 설정 값(.env 가 없으면 기본값)
    if (fs.existsSync(path.join(APP, '.env')))
    {
        report('ok', '설정 파일', 'apps/realtime/.env'); // 설정 파일 있음
    }
    else
    {
        report('warn', '설정 파일', 'apps/realtime/.env 가 없어 기본값을 씁니다. .env.example 을 .env 로 복사하세요.'); // 기본값으로 동작
    }
    const origin = env.get('CORS_ORIGIN').trim(); // 접속 출처 설정
    if (origin === '*')
    {
        report('warn', '접속 출처', 'CORS_ORIGIN=* 라서 모든 사이트의 페이지가 실시간 서버에 붙을 수 있습니다. apps/realtime/.env 에서 auto 로 바꾸세요.'); // 개발용 설정
    }
    else
    {
        report('ok', '접속 출처', origin === '' || origin.toLowerCase() === 'auto' ? 'auto, 이 서버와 같은 호스트의 페이지만 허용' : '목록 ' + origin); // 제한됨
    }

    // 4) DB 연결(PHP 와 같은 DB 인지도 함께 표시)
    if (packagesReady)
    {
        try
        {
            const db = require('../src/db'); // 커넥션 풀
            const row = await db.one('SELECT COUNT(*) AS n FROM boards'); // 연결·스키마 확인
            report('ok', 'DB 연결', env.get('DB_HOST') + ':' + env.get('DB_PORT') + ' / ' + env.get('DB_NAME') + ' (보드 ' + row.n + '개)'); // 접속 정보
            await db.pool.end(); // 연결 정리
        }
        catch (err)
        {
            const hints = { ECONNREFUSED: 'MariaDB 가 꺼져 있습니다. XAMPP Control Panel 에서 MySQL 을 Start 하세요.', ER_BAD_DB_ERROR: "DB '" + env.get('DB_NAME') + "' 가 없습니다. database/schema.sql 을 적용하세요.", ER_ACCESS_DENIED_ERROR: '.env 의 DB_USER·DB_PASS 가 맞지 않습니다.', ER_NO_SUCH_TABLE: '테이블이 없습니다. database/schema.sql 을 적용하세요.' }; // 흔한 원인
            report('fail', 'DB 연결', hints[err.code] ?? err.message); // 연결 실패
        }
    }

    // 5) 포트: 서버가 떠 있으면 응답을, 아니면 비어 있는지를 확인
    const rtPort = env.int('PORT'); // 실시간 포트
    const webHealth = await probe('http://127.0.0.1:' + WEB_PORT + '/api/health'); // 웹 서버 상태
    const rtHealth = await probe('http://127.0.0.1:' + rtPort + '/health'); // 실시간 서버 상태
    for (const item of [{ label: '웹 서버', port: WEB_PORT, health: webHealth, okWhen: webHealth && webHealth.db === true }, { label: '실시간 서버', port: rtPort, health: rtHealth, okWhen: rtHealth && rtHealth.status === 'ok' }])
    {
        if (item.okWhen)
        {
            report('ok', '포트 ' + item.port, item.label + ' 실행 중'); // 정상 응답
        }
        else if (item.health)
        {
            report('fail', '포트 ' + item.port, item.label + '가 응답하지만 상태가 정상이 아닙니다(DB 연결 확인).'); // 떠 있으나 비정상
        }
        else if (await portFree(item.port))
        {
            report('info', '포트 ' + item.port, '비어 있음. ' + item.label + '는 아직 실행 전입니다(scripts\\start-dev.bat).'); // 실행 전
        }
        else
        {
            report('fail', '포트 ' + item.port, '다른 프로그램이 쓰고 있어 ' + item.label + '를 띄울 수 없습니다. 그 프로그램을 끄거나 포트를 바꾸세요.'); // 포트 충돌
        }
    }

    // 6) LAN 주소: 다른 PC 가 접속할 주소와, 그 주소로도 서버가 열려 있는지
    const addresses = lanAddresses(); // 연결된 네트워크 주소
    if (addresses.length === 0)
    {
        report('fail', 'LAN 주소', '연결된 네트워크가 없습니다. 랜선·Wi-Fi 연결을 확인하세요.'); // 네트워크 없음
    }
    for (const item of addresses)
    {
        if (webHealth && rtHealth)
        {
            const viaLan = (await probe('http://' + item.address + ':' + WEB_PORT + '/api/health')) && (await probe('http://' + item.address + ':' + rtPort + '/health')); // LAN 주소로 접속
            report(viaLan ? 'ok' : 'fail', 'LAN 주소', item.address + ' (' + item.name + ')' + (viaLan ? ' 로도 두 서버가 응답' : ' 로는 응답하지 않습니다. 서버를 0.0.0.0 으로 띄웠는지 확인하세요(scripts\\start-dev.bat).')); // 외부 주소 응답 여부
        }
        else
        {
            report('info', 'LAN 주소', item.address + ' (' + item.name + ')'); // 주소만 안내
        }
    }

    // 7) 방화벽: 두 포트를 여는 인바운드 허용 규칙
    checkFirewall([{ port: WEB_PORT, exe: PHP, label: '웹 서버(php.exe)' }, { port: rtPort, exe: process.execPath, label: '실시간 서버(node.exe)' }]);

    // 8) 외부 영상: 임베드에 쓰는 주소가 열리는지
    try
    {
        await fetch('https://www.youtube-nocookie.com/', { method: 'HEAD', signal: AbortSignal.timeout(5000) }); // 응답만 오면 됨
        report('ok', '외부 영상', 'YouTube 임베드 주소에 접속됨(접속 PC 에서도 youtube.com 을 한 번 열어 보세요).'); // 접속 가능
    }
    catch (err)
    {
        report('warn', '외부 영상', 'YouTube 에 접속할 수 없습니다. 시연에서 영상 장면은 건너뛰세요.'); // 차단·오프라인
    }

    console.log('실시간 쪽: 통과 ' + counts.ok + ', 주의 ' + counts.warn + ', 실패 ' + counts.fail); // 요약
    if (addresses.length > 0)
    {
        console.log('\n다른 PC 에서 열어 볼 주소(둘 다 열려야 합니다):'); // 접속 PC 확인 안내
        for (const item of addresses)
        {
            console.log('  화면  http://' + item.address + ':' + WEB_PORT + '\n  연결  http://' + item.address + ':' + rtPort + '/health'); // 화면과 실시간 연결 주소
        }
    }
    process.exitCode = counts.fail > 0 ? 1 : 0; // 실패가 있으면 종료 코드 1(열려 있던 연결이 정리된 뒤 스스로 끝남)
}

main().catch((err) =>
{
    console.error('[실패] 점검 스크립트 오류 — ' + err.message); // 예상하지 못한 오류
    process.exitCode = 1; // 실패
});
