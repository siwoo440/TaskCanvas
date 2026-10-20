'use strict'; // 엄격한 검사
const assert = require('assert/strict'); // 독립 기대값
const crypto = require('crypto'); // 원본 해시 비교
const Harness = require('./lib/import-harness.cjs'); // 고유 DB·서버
const { execFileSync, spawnSync } = require('child_process'); // 실제 관리 CLI
let passed = 0; // 실제 검사 수
function check(value, label) // 결과 검사
{ // 검사 시작
    assert(value, label); passed += 1; console.log('PASS ' + label); // 결과 출력
} // 검사 끝
function file(text, name = '표본.csv', encoding = 'UTF-8') // 실제 파일 전송
{ // 파일 생성
    const form = new FormData(); form.append('file', new Blob([text]), name); form.append('encoding', encoding); // multipart 바이트
    return form; // 브라우저와 같은 전송
} // 파일 생성 끝
async function main() // 가져오기 통합 검증
{ // 실행 시작
    const h = await Harness.start(); // 두 서버와 고유 DB
    const api = h.request.bind(h); // 실제 요청
    try // 테스트 정리 보장
    { // 시나리오 시작
        check((await api('POST', '/api/projects/1/imports/upload', file('a\n1'))).status === 401, '가져오기 비인증 거부'); // 구현 전 실패 기준
        const password = 'Import30-test!'; // 테스트 전용 비밀번호
        await api('POST', '/api/auth/register', { login_id: 'import30', display_name: '가져오기 관리자', password, password_confirm: password }); // 회원 fixture
        const login = await api('POST', '/api/auth/login', { login_id: 'import30', password }); // 회원 쿠키
        const created = await api('POST', '/api/projects', { display_name: '가져오기 관리자', title: '가져오기 검증' }, login.cookie); // 소유 작업실
        const cookie = login.cookie + '; ' + created.cookie; // 회원 결합 세션
        const id = created.data.project.project_id; const route = '/api/projects/' + id; // 테스트 범위
        const foreign = await api('POST', '/api/projects', { display_name: '다른 관리자', title: '격리 작업실' }); // 다른 작업실
        const invite = await api('POST', route + '/invites', { role: 'viewer', days: 1 }, cookie); // 열람 권한
        const viewer = await api('POST', '/api/guest/join', { display_name: '열람자', invite_code: invite.data.code }); // 독립 게스트
        const editInvite = await api('POST', route + '/invites', { role: 'editor', days: 1 }, cookie); // 편집자 권한
        const editor = await api('POST', '/api/guest/join', { display_name: '편집자', invite_code: editInvite.data.code }); // 다른 세션
        check((await api('POST', route + '/imports/upload', file('a\n1'), viewer.cookie)).status === 403, '열람자 업로드 거부'); // 서버 역할
        check((await api('POST', route + '/imports/upload', file('a\n1'), foreign.cookie)).status === 403, '타 작업실 업로드 거부'); // 범위 보호
        check((await api('POST', route + '/imports/upload', file('a\n1'), created.cookie)).status === 401, '회원 쿠키 누락 차단'); // 회원 결합
        check((await api('POST', route + '/imports/upload', file('a\n1'), cookie, 0, false)).status === 403, '변경 보호 헤더 요구'); // CSRF
        const source = '분류,금액\nA,0.1\nB,0.2\n'; // 실제 원본
        const upload = await api('POST', route + '/imports/upload', file(source), cookie); // 초안 업로드
        check(upload.status === 201 && upload.data.row_count === 2 && upload.data.rows.length === 2, '첫20행과 전체 행 수'); // 원본 확인
        const token = upload.data.draft_token; // 테스트 초안
        check(/^[0-9a-f]{48}$/.test(token) && !upload.text.includes('guest_session_id'), '불투명 토큰과 세션 비공개'); // 신원 보호
        const [[draft]] = await h.db.query('SELECT draft_hash,source_sha256 FROM import_drafts WHERE draft_hash=?', [crypto.createHash('sha256').update(token).digest('hex')]); // 보관 검증
        check(draft.source_sha256 === crypto.createHash('sha256').update(source).digest('hex'), '원본 SHA256 보존'); // 독립 무결성
        check((await api('POST', route + '/imports/preview', { draft_token: token }, editor.cookie)).status === 404, '다른 세션 초안 접근 차단'); // 소유 검사
        const json = await api('POST', route + '/imports/upload', file('{"items":[{"name":"자료"}]}', '자료.json'), cookie); // JSON 업로드
        check(json.status === 201 && json.data.requires_path && json.data.row_count === null, 'JSON 배열 경로 선택 대기'); // 미선택 상태
        const preview = await api('POST', route + '/imports/preview', { draft_token: json.data.draft_token, json_path: '/items' }, cookie); // 실제 경로
        check(preview.status === 200 && preview.data.row_count === 1 && preview.data.rows[0].values[0] === '자료', 'JSON 경로 미리보기'); // 서버 해석
        const large = 'a\n1\n' + '\n'.repeat(5242880 - 4); // 정확한 5MiB CSV
        const largeUpload = await api('POST', route + '/imports/upload', file(large), cookie); // 1MiB DB 패킷 경계
        check(largeUpload.status === 201, '1MiB DB 패킷에서 5MiB 업로드'); // 조각 저장
        const [[chunks]] = await h.db.query('SELECT COUNT(*) AS n,MAX(OCTET_LENGTH(data)) AS biggest,SUM(OCTET_LENGTH(data)) AS bytes FROM import_draft_chunks WHERE draft_hash=?', [crypto.createHash('sha256').update(largeUpload.data.draft_token).digest('hex')]); // 실제 조각
        check(chunks.n === 80 && chunks.biggest === 65536 && Number(chunks.bytes) === 5242880, '80개 조각·64KiB 한도·전체 바이트'); // 실제 DB 증거
        check((await api('POST', route + '/imports/preview', { draft_token: largeUpload.data.draft_token }, cookie)).data.row_count === 1, '조각 복원과 원본 파싱'); // 순서·해시
        check((await api('POST', route + '/imports/upload', file('a\n1'), cookie)).status === 429, '세션 초안3개 한도'); // 누적 한도
        await h.db.query('UPDATE import_drafts SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE draft_hash=?', [draft.draft_hash]); // 실제 만료
        check((await api('POST', route + '/imports/preview', { draft_token: token }, cookie)).status === 410, '초안15분 만료 차단'); // TTL
        check((await api('POST', route + '/imports/upload', file('a\n1'), cookie)).status === 201, '만료 초안 정리 후 재업로드'); // 한도 복구
        const brokenHash = crypto.createHash('sha256').update(largeUpload.data.draft_token).digest('hex'); // 조각 대상
        await h.db.query('DELETE FROM import_draft_chunks WHERE draft_hash=? AND chunk_no=1', [brokenHash]); // 일부 손상
        check((await api('POST', route + '/imports/preview', { draft_token: largeUpload.data.draft_token }, cookie)).status === 409, '누락 조각 복원 거부'); // 무결성
        check((await api('POST', route + '/imports/upload', file('x'.repeat(5242881)), editor.cookie)).status === 413, '실제 파일5MiB 초과 거부'); // 파싱 전 크기
        check((await api('POST', route + '/imports/upload', file('a\n1', '자료.zip'), editor.cookie)).status === 415, '허용 확장자 제한'); // 압축 파일 제외
        check((await api('POST', route + '/imports/upload', file('[1,', '깨진.json'), editor.cookie)).status === 415, '미완성 JSON 구문 안내'); // 표준 오류
        check(preview.data.json_path === '/items' && preview.data.encoding === 'UTF-8', '서버가 확정한 JSON 경로와 인코딩'); // 선택 상태 계약
        const twenty = await api('POST', route + '/imports/upload', file('번호,이름\n' + Array.from({ length: 25 }, (_, i) => (i + 1) + ',자료' + i).join('\n')), editor.cookie); // 전체25행
        check(twenty.status === 201 && twenty.data.row_count === 25 && twenty.data.rows.length === 20 && twenty.data.rows[19].source_row === 20, '전체25행과 첫20행 구분'); // 서버 미리보기 한도
        const cp = await api('POST', route + '/imports/upload', file(Buffer.from([0xC0, 0xCC, 0xB8, 0xA7, 10, 0xC7, 0xD1, 0xB1, 0xDB, 10]), '한글.csv', 'CP949'), editor.cookie); // 실제 CP949 바이트
        check(cp.status === 201 && cp.data.encoding === 'CP949' && cp.data.rows[0].values[0] === '한글', 'CP949 실제 업로드 원문'); // 인코딩 손실 방지
        check((await api('POST', route + '/imports/preview', { draft_token: cp.data.draft_token }, viewer.cookie)).status === 403, '열람자 원본 재미리보기 차단'); // 쓰기 역할
        check((await api('POST', route + '/imports/commit', {}, cookie)).status === 404, '31일차 확정 저장 API 미노출'); // 이번 개발 범위
        const [[beforeDry]] = await h.db.query('SELECT COUNT(*) AS n FROM import_drafts'); // 원본 수
        const cli = 'apps/php-api/bin/cleanup-imports.php'; const cliEnv = { ...process.env, DB_NAME: h.name }; // 고유 DB 명령
        execFileSync('C:/xampp/php/php.exe', [cli], { cwd: h.root, env: cliEnv }); const [[afterDry]] = await h.db.query('SELECT COUNT(*) AS n FROM import_drafts'); // 기본 미리보기
        check(beforeDry.n === afterDry.n, 'CLI dry-run 초안 보존'); // 기본 삭제 금지
        await h.db.query('UPDATE import_drafts SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND)'); execFileSync('C:/xampp/php/php.exe', [cli, '--apply'], { cwd: h.root, env: cliEnv }); const [[cleaned]] = await h.db.query('SELECT COUNT(*) AS n FROM import_drafts'); // 명시적 만료 정리
        check(cleaned.n === 0, 'CLI 만료 초안과 FK 조각 정리'); // 한도 복구
        const unavailable = spawnSync('C:/xampp/php/php.exe', [cli], { cwd: h.root, env: { ...cliEnv, DB_NAME: h.name + '_missing' }, encoding: 'utf8' }); // 없는 테스트 DB
        check(unavailable.status !== 0 && unavailable.stderr.includes('초안 정리 실패'), 'CLI DB 장애 실패 종료'); // 운영 실패 오인 차단
        const me = await api('GET', '/api/me', undefined, cookie); const otherRoute = '/api/projects/' + foreign.data.project.project_id; // 같은 게스트의 두 작업실
        await h.db.query('INSERT INTO project_members (project_id,guest_id,role) VALUES (?,?,?)', [foreign.data.project.project_id, me.data.guest.guest_id, 'editor']); // 지원되는 다중 작업실 fixture
        const firstTwo = await Promise.all([0, 1].map((index) => api('POST', route + '/imports/upload', file('a\n1'), cookie, index))); // 세션2개 준비
        check(firstTwo.every((result) => result.status === 201), '세션 전체 한도 준비2개'); // 마지막 한 자리
        const crossRace = await Promise.all([route, otherRoute].map((prefix, index) => api('POST', prefix + '/imports/upload', file('a\n1'), cookie, index))); // 작업실 간 경합
        check(crossRace.map((result) => result.status).sort().join() === '201,429', '작업실이 달라도 세션 전체3개 한도'); // 독립 검토 재현
        const rejected = crossRace.find((result) => result.status === 429); check(!rejected.data.error.message.includes('저장') && rejected.data.error.message.includes('만료'), '한도 오류의 실행 가능한 복구 안내'); // 현재 범위의 안내
        const [[globalCount]] = await h.db.query('SELECT COUNT(*) AS n FROM import_drafts WHERE status=? AND expires_at>NOW()', ['uploaded']); check(globalCount.n === 3, '교차 작업실 활성 원본 총3개'); // 실제 DB 증거
        await h.db.query('UPDATE import_drafts SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND)'); execFileSync('C:/xampp/php/php.exe', [cli, '--apply'], { cwd: h.root, env: cliEnv }); // 작업실 한도 표본 분리
        const third = await api('POST', '/api/guest/join', { display_name: '세 번째 편집자', invite_code: editInvite.data.code }); // 독립 세션
        const quotaReady = []; // 세션별3개
        for (const who of [cookie, editor.cookie, third.cookie]) // 총9개 준비
        { // 정상 초안 생성
            for (let i = 0; i < 3; i++) // 각 세션 한도
            { // 실제 업로드
                quotaReady.push((await api('POST', route + '/imports/upload', file('a\n1'), who)).status); // 공개 API 경유
            } // 실제 업로드 끝
        } // 정상 초안 생성 끝
        check(quotaReady.every((status) => status === 201), '작업실9개 정상 초안 준비'); // 고유 DB fixture
        const fourth = await api('POST', '/api/guest/join', { display_name: '동시 업로드', invite_code: editInvite.data.code }); // 같은 세션 두 요청
        const quotaRace = await Promise.all([0, 1].map((index) => api('POST', route + '/imports/upload', file('a\n1'), fourth.cookie, index))); // 두 실제 서버
        check(quotaRace.map((result) => result.status).sort().join() === '201,429', '동시 업로드의 작업실10개 한도'); // 초과 생성 차단
        console.log('초안 가져오기 ' + passed + '개 통과'); // 실제 통과 수
    } // 시나리오 끝
    finally // 고유 자원 정리
    { // 정리 시작
        await h.close(); // 두 서버·DB만 제거
    } // 정리 끝
} // 실행 끝
main().catch((error) => // 최종 실패
{ // 오류 보고
    console.error('FAIL ' + error.stack); process.exitCode = 1; // 검증 실패 종료
}); // 오류 보고 끝
