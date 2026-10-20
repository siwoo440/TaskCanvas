'use strict'; // 엄격한 검사
const fs = require('fs'); // 실제 소스
const path = require('path'); // 경로
const vm = require('vm'); // 브라우저 모듈 실행
const assert = require('assert/strict'); // 독립 기대값
class Element // DOM 입출력 대역
{ // 요소 시작
    constructor(tag = 'div') // 초기 DOM
    { // 초기화
        this.tagName = tag; this.children = []; this.value = ''; this.hidden = false; this.disabled = false; this.handlers = {}; this.style = {}; this.attributes = {}; this.text = ''; // 실제 사용 속성
    } // 초기화 끝
    set textContent(value) // 안전한 텍스트 출력
    { // 텍스트 설정
        this.text = String(value); this.children = []; // 기존 자식 제거
    } // 텍스트 설정 끝
    get textContent() // 실제 출력 내용
    { // 내용 조회
        return this.text + this.children.map((child) => child.textContent).join(' '); // 하위 내용
    } // 내용 조회 끝
    append(...nodes) // 자식 출력
    { // 추가 시작
        this.children.push(...nodes); // 순서 유지
    } // 추가 끝
    replaceChildren(...nodes) // 결과 폐기
    { // 교체 시작
        this.text = ''; this.children = nodes; // 전체 교체
    } // 교체 끝
    setAttribute(key, value) // 접근성 속성
    { // 속성 시작
        this.attributes[key] = String(value); // 문자열 저장
    } // 속성 끝
    addEventListener(type, callback) // 이벤트 연결
    { // 연결 시작
        this.handlers[type] = callback; // 실행 함수
    } // 연결 끝
    focus() // 포커스 경계
    { // 포커스 시작
        this.focused = true; // 상태 기록
    } // 포커스 끝
} // 요소 끝
const rootPath = path.resolve(__dirname, '../../frontend/public'); // 실제 공개 파일
const elements = new Map(); // DOM 식별자
const root = new Element(); // 분석 영역
root.querySelector = (key) => // 실제 ID 조회 경계
{ // 조회 시작
    if (!elements.has(key)) // 첫 요소
    { // 요소 구성
        elements.set(key, new Element()); // 독립 요소
    } // 구성 끝
    return elements.get(key); // 선택 요소
}; // 조회 끝
const instances = []; // 차트 출력 경계
class Chart // 캔버스 외부 라이브러리 대역
{ // 차트 시작
    constructor(canvas, config) // 실제 렌더 입력
    { // 차트 생성
        this.config = config; this.canvas = canvas; instances.push(this); // 데이터 경계 보관
    } // 생성 끝
    destroy() // 외부 자원 해제
    { // 해제 시작
        this.destroyed = true; // 해제 관찰
    } // 해제 끝
} // 차트 끝
const pending = []; // HTTP 지연 제어
const context = vm.createContext({ window: { Chart, api: { get: (url) => new Promise((resolve, reject) => pending.push({ url, resolve, reject })) } }, document: { createElement: (tag) => new Element(tag) }, URLSearchParams, Date, console }); // 실제 로직과 외부 경계
vm.runInContext(fs.readFileSync(path.join(rootPath, 'js/analytics-charts.js'), 'utf8'), context); // 제품 차트 실행
const data = { project_id: 1, time_zone: 'Asia/Seoul', as_of_date: '2024-02-29', filters: { created_from: '2024-01-31', created_to: '2024-02-29', status: null, assignee_id: null }, summary: { tasks: { total: 3, todo: 1, doing: 0, done: 1, other: 1, completion_rate: 33.3 }, due: { overdue: 1 }, checklist: { total: 2, done: 1, completion_rate: 50 }, assignees: [{ assignee_id: 7, display_name: '동명', total: 2, done: 1 }, { assignee_id: 8, display_name: '동명', total: 1, done: 0 }] }, daily_created: [{ date: '2024-02-28', count: 0 }, { date: '2024-02-29', count: 3 }], assignee_options: [{ assignee_id: 7, display_name: '동명' }, { assignee_id: 8, display_name: '동명' }], pagination: { page: 1, page_size: 20, total: 3, total_pages: 1 }, rows: [{ task_id: 1, title: '<img src=x>', status: 'todo', assignee_id: null, assignee_name: null, due_at: null, created_at: '2024-02-29 12:00:00', checklist: { total: 2, done: 1, completion_rate: 50 } }] }; // 완전한 응답 fixture
async function main() // 클라이언트 검증
{ // 검증 시작
    const charts = context.window.AnalyticsCharts.mount(root); // 제품 차트
    charts.render(data); // 실제 렌더
    assert.equal(instances.length, 3); // 세 종류 출력
    assert.deepEqual(Array.from(instances[0].config.data.datasets[0].data), [1, 0, 1, 1]); // other 상태 누락 방지
    assert.notEqual(instances[1].config.data.labels[0], instances[1].config.data.labels[1]); // 동명이인 구별
    assert.deepEqual(Array.from(instances[2].config.data.datasets[0].data), [0, 3]); // 0일 보존
    charts.render(data); // 재조회 렌더
    assert(instances.slice(0, 3).every((chart) => chart.destroyed)); // 이전 차트 파기
    context.window.Chart = undefined; // 배포 파일 로드 실패
    charts.render(data); // 대체 데이터
    assert(root.querySelector('#analytics-chart-tables').textContent.includes('동명')); // 라이브러리 없이 데이터 표시
    assert(root.querySelector('#analytics-chart-notice').textContent.length > 0); // 실패 안내
    context.window.Chart = Chart; // 정상 의존성 복구
    console.log('PASS 차트 데이터·동명·0일·자원 정리·파일 실패 대체 표'); // 단계 결과
    if (process.argv.includes('--charts-only')) // 작업 3 범위
    { // 제한 실행
        return; // 화면 모듈 전 종료
    } // 제한 실행 끝
    vm.runInContext(fs.readFileSync(path.join(rootPath, 'js/analytics-dashboard.js'), 'utf8'), context); // 제품 조회 모듈
    let lost = 0; // 접근 만료 통지
    const dashboard = context.window.AnalyticsDashboard.mount(root, { onBack: () => {}, onAccessLost: () => lost += 1 }); // 실제 수명 관리
    const first = dashboard.open({ projectId: 1, title: '첫 작업실' }); // 지연 요청
    assert(pending[0].url.startsWith('/api/projects/1/analytics/dashboard?')); // 실제 앱 API 접두사
    const second = dashboard.open({ projectId: 2, title: '다음 작업실' }); // 작업실 전환
    pending[1].resolve({ ...data, project_id: 2 }); await second; // 최신 응답 먼저
    pending[0].reject({ status: 401 }); await first; // 이전 오류 나중
    assert.equal(lost, 0); // 이전 오류로 현재 인증 폐기 금지
    assert(root.querySelector('#analytics-kpis').textContent.includes('3')); // 현재 결과 유지
    root.querySelector('#analytics-from').value = '2020-01-01'; // 적용 전 초안
    const refresh = root.querySelector('#analytics-refresh').handlers.click(); // 새로고침
    assert(pending[2].url.includes('created_from=2024-01-31') && !pending[2].url.includes('2020-01-01')); // 적용 조건 사용
    pending[2].resolve({ ...data, project_id: 2 }); await refresh; // 갱신 완료
    root.querySelector('#analytics-status').value = 'done'; // 새 조건 초안
    const apply = root.querySelector('#analytics-form').handlers.submit({ preventDefault() {} }); // 조회 적용
    assert(pending[3].url.includes('status=done') && pending[3].url.includes('page=1')); // 새 조건과 첫 페이지
    pending[3].reject({ status: 400, message: '조건 오류' }); await apply; // 입력 실패
    assert.equal(root.querySelector('#analytics-kpis').textContent, ''); // 오래된 결과 삭제
    const retry = root.querySelector('#analytics-refresh').handlers.click(); // 실패 조건 재시도
    assert(pending[4].url.includes('status=done')); // 실패한 입력 유지
    dashboard.close(); pending[4].resolve(data); await retry; // 닫힌 뒤 성공
    assert.equal(root.querySelector('#analytics-kpis').textContent, ''); // 늦은 성공 무시
    const expired = dashboard.open({ projectId: 1, title: '만료' }); // 현재 인증 오류
    pending[5].reject({ status: 403 }); await expired; // 현재 오류
    assert.equal(lost, 1); // 현재 오류만 통지
    const oldSuccess = dashboard.open({ projectId: 1, title: '이전' }); // 성공 역전
    const newSuccess = dashboard.open({ projectId: 2, title: '현재' }); // 새 요청
    pending[7].resolve({ ...data, project_id: 2 }); await newSuccess; // 최신 성공
    pending[6].resolve({ ...data, summary: { ...data.summary, tasks: { ...data.summary.tasks, total: 999 } } }); await oldSuccess; // 이전 성공
    assert(!root.querySelector('#analytics-kpis').textContent.includes('999')); // 이전 데이터 거부
    assert(root.querySelector('#analytics-rows').textContent.includes('<img src=x>')); // 제목 안전 텍스트 출력
    const network = root.querySelector('#analytics-refresh').handlers.click(); // 통신 실패
    pending[8].reject(new Error('network')); await network; // 실제 실패
    assert(root.querySelector('#analytics-message').textContent.includes('서버에 연결하지 못했습니다')); // 이해 가능한 통신 오류
    dashboard.close(); // 최종 자원 정리
    const app = fs.readFileSync(path.join(rootPath, 'js/app.js'), 'utf8'); // 실제 앱 연결
    const start = app.indexOf('function showView(name)'); // 뷰 전환 함수
    const end = app.indexOf('// ----------', start); // 다음 기능 경계
    let closed = 0; // 분석 폐기 관찰
    const navigation = vm.createContext({ analyticsDashboard: { close: () => closed += 1 }, datasetView: { close() {} }, document: { querySelectorAll: () => [] }, forgetBoard: () => {} }); // 외부 화면 의존성
    vm.runInContext(app.slice(start, end), navigation); // 제품 뷰 전환
    vm.runInContext("showView('home')", navigation); // 작업실 복귀
    assert.equal(closed, 1); // 이전 결과 폐기 연결
    vm.runInContext("showView('analytics')", navigation); // 분석 유지
    assert.equal(closed, 1); // 진입 시 임의 폐기 금지
    console.log('PASS 응답 역전·인증 경계·필터 초안·재시도·폐기·안전 출력'); // 결과
} // 검증 끝
main().catch((error) => // 최종 오류
{ // 오류 처리
    console.error(error); process.exitCode = 1; // 실패 종료
}); // 오류 처리 끝
