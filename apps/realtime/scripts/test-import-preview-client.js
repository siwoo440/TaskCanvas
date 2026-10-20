'use strict'; // 업로드 화면 회귀 검사
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert/strict'); // 실행과 기대값
class Element // 화면 입출력 경계
{ // 요소 시작
    constructor(tag = 'div') // 독립 DOM 요소
    { // 속성 초기화
        this.tagName = tag; this.children = []; this.value = ''; this.files = []; this.disabled = false; this.hidden = false; this.handlers = {}; this.text = ''; this.attributes = {}; // 실제 사용 속성
    } // 초기화 끝
    set textContent(value) // 안전한 텍스트 출력
    { // 텍스트 설정
        this.text = String(value); this.children = []; // 원문만 보관
    } // 텍스트 설정 끝
    get textContent() // 전체 출력 내용
    { // 내용 읽기
        return this.text + this.children.map((child) => child.textContent).join(' '); // 하위 원문 포함
    } // 내용 읽기 끝
    append(...nodes) // 자식 추가
    { // 추가 시작
        this.children.push(...nodes); // 순서 유지
    } // 추가 끝
    replaceChildren(...nodes) // 이전 정보 폐기
    { // 교체 시작
        this.text = ''; this.children = nodes; // 완전 교체
    } // 교체 끝
    setAttribute(key, value) // 접근성 속성
    { // 속성 시작
        this.attributes[key] = value; // 실제 입력 저장
    } // 속성 끝
    addEventListener(type, handler) // 사용자 이벤트
    { // 연결 시작
        this.handlers[type] = handler; // 실행 함수
    } // 연결 끝
    focus() // 키보드 위치
    { // 포커스 시작
        this.focused = true; // 포커스 확인
    } // 포커스 끝
} // 요소 끝
async function main() // 실제 모듈 검증
{ // 검사 시작
    const requests = []; const elements = new Map(); const root = new Element(); // 외부 경계
    root.querySelector = (selector) => // 실제 식별자 조회
    { // 요소 조회
        if (!elements.has(selector)) // 첫 접근
        { // 요소 준비
            elements.set(selector, new Element()); // 고유 화면 요소
        } // 요소 준비 끝
        return elements.get(selector); // 현재 요소
    }; // 요소 조회 끝
    const context = vm.createContext({ window: { TC_CONFIG: { apiBase: '' } }, document: { createElement: (tag) => new Element(tag) }, FormData, console, fetch: async (url, options) => ({ ok: true, json: async () => ({ url, options }) }) }); // 실제 API 경계
    const directory = path.resolve(__dirname, '../../frontend/public/js'); vm.runInContext(fs.readFileSync(path.join(directory, 'api.js'), 'utf8'), context); // 제품 API 실행
    const form = new FormData(); const sent = await context.window.api.multipart('/api/upload', form); // 실제 파일 요청
    assert.equal(sent.options.body, form); assert.equal(sent.options.credentials, 'same-origin'); assert.equal(sent.options.headers['Content-Type'], undefined); assert.equal(sent.options.headers['X-TaskCanvas'], '1'); // 브라우저 boundary와 쿠키
    context.window.api = Object.fromEntries(['post', 'multipart'].map((method) => [method, (url, body) => new Promise((resolve, reject) => requests.push({ method, url, body, resolve, reject }))])); // 지연 응답 제어
    vm.runInContext(fs.readFileSync(path.join(directory, 'import-preview.js'), 'utf8'), context); // 구현 전 누락 실패
    let lost = 0; const preview = context.window.ImportPreview.mount(root, { onBack() {}, onAccessLost: () => lost++ }); const find = (name) => root.querySelector('#import-preview-' + name); // 제품 수명
    const data = { draft_token: 'private-A', file_name: 'A.csv', format: 'csv', encoding: 'UTF-8', json_path: null, expires_at: '2026-10-20 20:00:00', row_count: 1, requires_path: false, paths: [], columns: [{ label: '<img src=x>', source_id: 's0' }], rows: [{ source_row: 1, values: ['원본 A'], errors: [] }] }; // 독립 서버 표본
    preview.open({ projectId: 1, title: '첫 작업실', role: 'editor' }); find('file').files = [new Blob(['a\nA'])]; find('encoding').value = 'UTF-8'; // 초기 파일
    const upload = find('upload').handlers.click(); assert(requests[0].url === '/api/projects/1/imports/upload'); requests[0].resolve(data); await upload; // 실제 업로드 반영
    assert(find('rows').textContent.includes('원본 A')); assert(find('head').textContent.includes('<img src=x>')); assert(!find('meta').textContent.includes('private-A')); // 원문 안전 출력과 토큰 비공개
    find('file').files = [new Blob(['b\nB'])]; find('file').handlers.change(); assert(find('apply').disabled); assert.equal(find('rows').textContent, ''); // 파일 교체 즉시 폐기
    const count = requests.length; await find('apply').handlers.click(); assert.equal(requests.length, count); // 이전 토큰 재사용 차단
    const secondUpload = find('upload').handlers.click(); preview.open({ projectId: 2, title: '다음 작업실', role: 'viewer' }); requests[1].reject({ status: 401 }); await secondUpload; // 이전 신원 오류
    assert.equal(lost, 0); assert(find('rows').textContent === ''); assert(find('form').hidden); // 이전 화면 오염 방지와 열람자 쓰기 제한
    preview.open({ projectId: 2, title: 'JSON 작업실', role: 'admin' }); find('file').files = [new Blob(['{}'])]; find('encoding').value = 'UTF-8'; // JSON fixture
    const jsonUpload = find('upload').handlers.click(); requests[2].resolve({ ...data, draft_token: 'private-JSON', file_name: '자료.json', format: 'json', requires_path: true, row_count: null, columns: [], rows: [], paths: [{ path: '/data/items' }] }); await jsonUpload; // 경로 미선택
    assert(find('path-box').hidden === false && find('results').hidden); find('path').value = '/data/items'; find('path').handlers.input(); // 경로 선택
    const metadata = { ...data }; delete metadata.draft_token; // 실제 미리보기 응답의 토큰 미포함
    const pick = find('apply').handlers.click(); assert.equal(requests[3].body.json_path, '/data/items'); assert.equal(requests[3].body.draft_token, 'private-JSON'); requests[3].resolve({ ...metadata, format: 'json', json_path: '/data/items', file_name: '자료.json' }); await pick; // 원래 초안 토큰 유지
    find('path').value = '/other'; find('path').handlers.input(); const expired = find('apply').handlers.click(); assert.equal(requests[4].body.draft_token, 'private-JSON'); requests[4].reject({ status: 410, message: '초안 만료' }); await expired; // 토큰 유지와 만료
    assert(find('apply').disabled && find('rows').textContent === ''); // 만료 후 자료 폐기
    preview.open({ projectId: 3, title: '순서 검증', role: 'editor' }); find('file').files = [new Blob(['A'])]; const old = find('upload').handlers.click(); const oldRequest = requests.at(-1); // 첫 파일 요청
    find('file').files = [new Blob(['B'])]; find('file').handlers.change(); const latest = find('upload').handlers.click(); const latestRequest = requests.at(-1); // 새 파일 요청
    oldRequest.resolve(data); await old; assert.equal(find('rows').textContent, ''); assert(find('upload').disabled); // 늦은 성공과 버튼 복구 차단
    latestRequest.resolve({ ...data, file_name: 'B.csv', draft_token: 'private-B', rows: [{ source_row: 1, values: ['원본 B'], errors: [] }] }); await latest; assert(find('rows').textContent.includes('원본 B')); // 최신 파일만 표시
    find('encoding').value = 'CP949'; find('encoding').handlers.change(); const network = find('apply').handlers.click(); requests.at(-1).reject(new Error('network')); await network; assert(find('rows').textContent === '' && !find('apply').disabled); // 통신 실패 시 원문 폐기와 재시도
    preview.close(); assert.equal(find('file').value, ''); assert.equal(find('rows').textContent, ''); // 파일·원문 폐기
    const app = fs.readFileSync(path.join(directory, 'app.js'), 'utf8'); const start = app.indexOf('function showView(name)'); const end = app.indexOf('// ----------', start); let closed = 0; // 실제 앱 뷰 함수
    const navigation = vm.createContext({ analyticsDashboard: { close() {} }, importPreview: { close: () => closed++ }, document: { querySelectorAll: () => [] }, forgetBoard() {} }); vm.runInContext(app.slice(start, end), navigation); vm.runInContext("showView('home')", navigation); assert.equal(closed, 1); vm.runInContext("showView('data')", navigation); assert.equal(closed, 1); // 진입 유지·이탈 폐기
    console.log('PASS multipart·안전원문·파일교체·이전응답·열람자·JSON경로·토큰유지·만료·앱이탈'); // 실제 결과
} // 검사 끝
main().catch((error) => // 검증 실패
{ // 오류 출력
    console.error(error.stack); process.exitCode = 1; // 실패 종료
}); // 실행 끝
