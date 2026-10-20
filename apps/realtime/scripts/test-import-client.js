'use strict'; // 엄격한 검사
const fs = require('fs'); // 제품 파일
const path = require('path'); // 실제 경로
const vm = require('vm'); // 클라이언트 실행
const assert = require('assert/strict'); // 독립 기대값
const base = path.resolve(__dirname, '../../frontend/public/js'); // 제품 모듈 위치
class Element // DOM 경계 대역
{ // 요소 시작
    constructor(tag = 'div') // 초기 요소
    { // 초기화
        this.tagName = tag; this.children = []; this.handlers = {}; this.value = ''; this.text = ''; this.hidden = false; this.disabled = false; this.attributes = {}; this.files = []; // 실제 DOM 속성
    } // 초기화 끝
    append(...nodes) // 자식 추가
    { // 추가 시작
        nodes.forEach((node) => // 실제 DOM 이동
        { // 이전 부모 해제
            if (node.parent) // 기존 부모
            { // 소유 이동
                node.parent.children = node.parent.children.filter((child) => child !== node); // 기존 목록 제거
            } // 소유 이동 끝
            node.parent = this; // 새 부모
        }); // 부모 해제 끝
        this.children.push(...nodes); // 순서 보존
    } // 추가 끝
    replaceChildren(...nodes) // 내용 폐기
    { // 교체 시작
        this.text = ''; this.children = []; this.append(...nodes); // 실제 요소 이동
    } // 교체 끝
    set textContent(value) // 안전한 문자열
    { // 설정 시작
        this.text = String(value); this.children = []; // HTML 해석 없음
    } // 설정 끝
    get textContent() // 출력 조회
    { // 조회 시작
        return this.text + this.children.map((node) => node.textContent).join(' '); // 전체 내용
    } // 조회 끝
    set value(value) // 폼 값 입력
    { // 설정 시작
        this.currentValue = value; // 선택 상태
    } // 설정 끝
    get value() // 실제 선택 경계
    { // 값 조회
        return this.tagName === 'select' && !this.children.some((node) => node.value === this.currentValue) ? '' : this.currentValue; // 명시적 빈 선택 반영
    } // 값 조회 끝
    setAttribute(key, value) // 접근성 속성
    { // 속성 시작
        this.attributes[key] = String(value); // 문자열 값
    } // 속성 끝
    addEventListener(type, callback) // 실제 이벤트 경계
    { // 연결 시작
        this.handlers[type] = callback; // 콜백 보관
    } // 연결 끝
    focus() // 포커스 관찰
    { // 포커스 시작
        this.focused = true; // 접근성 상태
    } // 포커스 끝
    querySelector(selector) // 식별자 탐색
    { // 탐색 시작
        if ('#' + this.id === selector) // 현재 요소
        { // 일치 반환
            return this; // 실제 요소
        } // 일치 반환 끝
        for (const child of this.children) // 하위 요소
        { // 재귀 탐색
            const found = child.querySelector(selector); // 하위 결과
            if (found) // 찾은 요소
            { // 탐색 종료
                return found; // 결과 반환
            } // 탐색 종료 끝
        } // 재귀 탐색 끝
        return null; // 없는 요소
    } // 탐색 끝
} // 요소 끝
async function main() // 클라이언트 검증
{ // 검증 시작
    let lastFetch; // HTTP 경계
    const pending = []; // 지연 응답
    const context = vm.createContext({ window: { TC_CONFIG: { apiBase: '' } }, document: { createElement: (tag) => new Element(tag) }, FormData, URLSearchParams, console, fetch: async (url, options) => // 실제 API 모듈
    { // 전송 관찰
        lastFetch = { url, options }; return { ok: true, json: async () => ({ ok: true }) }; // 고정 성공
    } }); // 실행 환경
    vm.runInContext(fs.readFileSync(path.join(base, 'api.js'), 'utf8'), context); // 제품 API
    const form = new FormData(); await context.window.api.multipart('/api/upload', form); // 실제 multipart
    assert.equal(lastFetch.options.body, form); assert.equal(lastFetch.options.credentials, 'same-origin'); assert.equal(lastFetch.options.headers['Content-Type'], undefined); assert.equal(lastFetch.options.headers['X-TaskCanvas'], '1'); // 쿠키와 경계
    await context.window.api.post('/api/json', { value: 1 }); assert.equal(lastFetch.options.body, '{"value":1}'); // 기존 JSON 회귀
    context.window.api = Object.fromEntries(['get', 'post', 'multipart'].map((method) => [method, (url, body) => new Promise((resolve, reject) => pending.push({ method, url, body, resolve, reject }))])); // 외부 HTTP 대역
    vm.runInContext(fs.readFileSync(path.join(base, 'data-import.js'), 'utf8'), context); // 구현 전 누락 실패
    const root = new Element(); let saved = 0; let lost = 0; // 출력 경계
    const importer = context.window.DataImport.mount(root, { onSaved: () => saved++, onAccessLost: () => lost++ }); // 실제 가져오기
    importer.open({ projectId: 1, role: 'editor', target: null }); // 첫 화면
    root.querySelector('#import-file').files = [new Blob(['a\n1'])]; // 파일 경계
    const upload = root.querySelector('#import-upload').handlers.click(); // 실제 업로드
    assert(pending[0].url.startsWith('/api/projects/1/imports/upload')); // API 접두사
    pending[0].resolve({ draft_token: 'opaque', row_count: 1, columns: [{ source_id: 's0', label: '<img src=x>', path: 'a' }], rows: [{ source_row: 2, values: ['1'], errors: [] }], paths: [], requires_path: false }); await upload; // 원본 응답
    assert(root.textContent.includes('<img src=x>')); // HTML 원문 표시
    const validate = root.querySelector('#import-validate').handlers.click(); // 서버 전체 검증
    pending[1].resolve({ validation_revision: 3, report: { received: 1, inserted: 1, updated: 0, skipped: 0, error_count: 0, errors: [], can_commit: true }, schema: [{ id: 'c0', label: 'a' }], rows: [{ source_row: 2, values: ['1'] }] }); await validate; // 최신 검증
    assert.equal(root.querySelector('#import-commit').disabled, false); // 검증 후 저장 허용
    root.querySelector('#import-name').value = '다른 이름'; root.querySelector('#import-name').handlers.input(); // 설정 변경
    assert.equal(root.querySelector('#import-commit').disabled, true); // 이전 검증 폐기
    const validateAgain = root.querySelector('#import-validate').handlers.click(); // 검증 재요청
    importer.close(); pending[2].reject({ status: 401 }); await validateAgain; // 닫힌 뒤 오류
    assert.equal(lost, 0); assert.equal(root.textContent, ''); assert.equal(saved, 0); // 늦은 응답 무시
    vm.runInContext(fs.readFileSync(path.join(base, 'import-quality.js'), 'utf8'), context); // 품질 보고서 수명
    vm.runInContext(fs.readFileSync(path.join(base, 'dataset-view.js'), 'utf8'), context); // 조회 모듈
    const viewRoot = new Element(); const view = context.window.DatasetView.mount(viewRoot, { onBack: () => {}, onAccessLost: () => lost++ }); // 실제 조회
    const first = view.open({ projectId: 1, title: '첫 작업실', role: 'viewer' }); // 지연 목록
    const second = view.open({ projectId: 2, title: '현재 작업실', role: 'admin' }); // 전환 목록
    pending[4].resolve({ datasets: [{ dataset_id: 8, name: '현재 자료', row_count: 1, version: 1 }], pagination: { page: 1, total_pages: 1, total: 1 } }); await second; // 새 응답 먼저
    pending[3].reject({ status: 401 }); await first; // 옛 오류 나중
    assert.equal(lost, 0); assert(viewRoot.textContent.includes('현재 작업실')); // 신원 수명 보호
    const choose = viewRoot.querySelector('#dataset-8').handlers.click(); // 실제 자료 선택
    pending[5].resolve({ dataset: { dataset_id: 8, name: '현재 자료', row_count: 1, version: 1, key_column: null, schema: [{ id: 'c0', label: '분류', type: 'text' }, { id: 'c1', label: '값', type: 'number' }] }, rows: [{ row_id: 1, source_row: 1, values: ['A', '0.1'] }], pagination: { page: 1, total_pages: 1, total: 1 } }); await choose; // 저장 표 응답
    assert(pending[6].url.includes('category=c0')); // 이동한 option의 기본값 보존
    pending[6].resolve({ groups: [{ kind: 'value', label: 'A', amount: '0.1' }], row_count: 1, total: '0.1', excluded: 0 }); pending[7].resolve({ runs: [], pagination: { page: 1, total_pages: 1, total: 0 } }); await Promise.resolve(); await Promise.resolve(); // 차트 없는 대체 표
    assert(viewRoot.textContent.includes('0.1') && viewRoot.textContent.includes('차트를 불러오지 못했습니다')); // 정확 수치와 대체 안내
    view.close(); assert.equal(viewRoot.textContent, ''); // 화면 자료 폐기
    const app = fs.readFileSync(path.join(base, 'app.js'), 'utf8'); const start = app.indexOf('function showView(name)'); const end = app.indexOf('// ----------', start); let closed = 0; // 실제 앱 수명 함수
    const navigation = vm.createContext({ analyticsDashboard: { close() {} }, datasetView: { close: () => closed++ }, document: { querySelectorAll: () => [] }, forgetBoard() {} }); // 외부 경계
    vm.runInContext(app.slice(start, end), navigation); vm.runInContext("showView('home')", navigation); assert.equal(closed, 1); // 화면 이탈 폐기
    vm.runInContext("showView('data')", navigation); assert.equal(closed, 1); // 데이터 화면 진입 유지
    console.log('PASS multipart·JSON·원문 안전 출력·검증 무효화·이탈·응답 역전'); // 실제 결과
} // 검증 끝
module.exports = { Element }; // 추가 회귀의 DOM 경계
if (require.main === module) // 직접 실행
{ // 검증 진입
    main().catch((error) => // 실패 경계
    { // 오류 출력
        console.error(error.stack); process.exitCode = 1; // 실패 종료
    }); // 실행 끝
} // 검증 진입 끝
