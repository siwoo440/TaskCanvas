'use strict'; // 엄격한 검사
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert/strict'); // 실행 경계와 기대값
class Element // 브라우저 경계
{ // 요소 시작
    constructor() // 초기 상태
    { // 준비 시작
        this.children = []; this.handlers = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.disabled = false; this.open = false; this.dataset = {}; // 사용 속성
    } // 준비 끝
    addEventListener(name, handler) // 이벤트 연결
    { // 연결 시작
        this.handlers[name] = handler; // 제품 핸들러
    } // 연결 끝
    append(...nodes) // 안전한 자식 추가
    { // 추가 시작
        this.children.push(...nodes); // 순서 유지
    } // 추가 끝
    replaceChildren(...nodes) // 기존 결과 폐기
    { // 교체 시작
        this.children = nodes; // 현재 결과
    } // 교체 끝
    setAttribute(name, value) // 접근성 속성
    { // 속성 시작
        this[name] = value; // 기대값 관찰
    } // 속성 끝
    focus() // 키보드 초점
    { // 초점 시작
        document.activeElement = this; // 실제 포커스 경계
    } // 초점 끝
    showModal() // 네이티브 대화상자
    { // 열기 시작
        this.open = true; // 열린 상태
    } // 열기 끝
    close() // 네이티브 닫기
    { // 닫기 시작
        this.open = false; this.handlers.close?.(); // 정리 이벤트
    } // 닫기 끝
} // 요소 끝
const nodes = new Map(); // ID별 요소
const document = { activeElement: new Element(), createElement: () => new Element(), querySelector: () => null, querySelectorAll: () => [], getElementById: (id) => // DOM 경계
{ // 요소 조회
    if (!nodes.has(id)) // 첫 사용
    { // 요소 준비
        nodes.set(id, new Element()); // 독립 상태
    } // 준비 끝
    return nodes.get(id); // 실제 제품 연결
} }; // DOM 경계 끝
async function main() // 실제 개인 화면 검사
{ // 검사 시작
    let resolveSearch; let pending = false; let navigated = null; let searchCalls = 0; const events = {}; // 비동기 관찰
    const home = { tasks: [{ task_id: 2, project_id: 3, title: '<b>업무</b>', project_title: '작업실', due_at: null }], due_soon: [], favorites: [], recent: [] }; // 독립 자료
    const window = { TC_MEMBER_USER: { user_id: 1 }, addEventListener: (name, handler) => events[name] = handler, api: { get: async (url) => url.includes('/search?') ? (searchCalls += 1, pending ? new Promise((resolve) => resolveSearch = resolve) : { results: [{ kind: 'task', id: 2, project_id: 3, board_id: null, title: '업무' }] }) : home, post: async () => ({}) } }; // 외부 경계
    const context = vm.createContext({ window, document, setTimeout, clearTimeout, console, URLSearchParams }); // 제품 실행 환경
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../frontend/public/js/member-tools.js'), 'utf8'), context); // 실제 모듈
    const tools = window.MemberTools.mount({ onNavigate: (item) => navigated = item }); await tools.refresh(); // 개인 홈
    assert.match(nodes.get('personal-tasks').children[0].textContent, /<b>업무<\/b>/); // HTML 아닌 텍스트
    const opener = new Element(); opener.focus(); events.keydown({ key: 'k', ctrlKey: true, preventDefault() {} }); // 단축키 열기
    assert.equal(nodes.get('member-search-dialog').open, true); // 검색 창 열림
    const input = nodes.get('member-search-query'); input.value = '업무'; await tools.search(); // 검색 요청
    input.focus(); nodes.get('member-search-dialog').handlers.keydown({ key: 'Enter', isComposing: true }); assert.equal(searchCalls, 1); // 한글 조합 Enter 실행 방지
    nodes.get('member-search-dialog').handlers.keydown({ key: 'ArrowDown', preventDefault() {} }); assert.equal(document.activeElement, nodes.get('member-search-results').children[0]); // 방향키 초점
    const result = nodes.get('member-search-results').children[0]; // 실제 이동 버튼
    await result.handlers.click(); assert.equal(navigated.id, 2); // 업무 이동
    assert.equal(document.activeElement, opener); // 호출 요소로 초점 복원
    tools.openSearch(); pending = true; input.value = '늦은 결과'; const request = tools.search(); // 지연 응답
    tools.closeSearch(); resolveSearch({ results: [{ title: '노출 금지' }] }); await request; // 이탈 뒤 응답
    assert.equal(nodes.get('member-search-results').children.length, 0); // 오래된 결과 폐기
    window.TC_MEMBER_USER = null; await events['taskcanvas:member-change'](); // 로그아웃
    assert.equal(nodes.get('personal-home').hidden, true); assert.equal(nodes.get('personal-tasks').children.length, 0); // 이전 회원 자료 제거
    window.TC_MEMBER_USER = { user_id: 1 }; const posts = []; let changed = 0; // 관리 검사 경계
    const members = [{ guest_id: 8, user_id: 2, display_name: '<b>참여자</b>', role: 'viewer' }, { guest_id: 9, user_id: 2, display_name: '별칭', role: 'admin' }]; // 같은 회원의 다른 역할 별칭
    window.api.get = async () => ({ members }); window.api.post = async (url, body) => posts.push({ url, body }); // 관리 HTTP 경계
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../frontend/public/js/member-management.js'), 'utf8'), context); // 실제 관리 모듈
    const root = new Element(); root.querySelector = (id) => document.getElementById(id.slice(1)); // 내부 요소 경계
    const management = window.MemberManagement.mount(root, { onChanged: async () => changed++ }); // 관리 화면 연결
    await management.open({ project_id: 3, role: 'admin' }); const card = nodes.get('manage-list').children[0]; // 실제 회원 행
    assert.equal(nodes.get('manage-list').children.length, 1); assert.match(card.children[0].textContent, /<b>참여자<\/b>/); // 별칭 묶음과 안전 출력
    assert.equal(card.children[1].value, 'admin'); // 실제 최고 역할 표시
    await card.children[4].handlers.click(); assert.equal(posts.length, 0); // 이름 확인 없는 내보내기 차단
    card.children[1].value = 'editor'; await card.children[2].handlers.click(); // 역할 변경
    assert.equal(posts[0].body.target_guest_id, 8); assert.equal(posts[0].body.role, 'editor'); assert.equal(changed, 1); // 서버 대상과 최신 화면 복원
    await management.open({ project_id: 3, role: 'viewer' }); assert.equal(root.hidden, true); // 관리자 전용 UI
    console.log('PASS 개인 홈·Ctrl+K·한글 조합·방향키·초점 복원·늦은 응답 폐기·회원 묶음·역할 요청'); // 검사 결과
} // 검사 끝
main().catch((error) => // 실제 실패 보고
{ // 실패 시작
    console.error(error); process.exitCode = 1; // 비정상 종료
}); // 실패 끝
