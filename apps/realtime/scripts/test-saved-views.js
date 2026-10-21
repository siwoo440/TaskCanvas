'use strict'; // 엄격한 검사
const fs = require('fs'); // 제품 모듈
const path = require('path'); // 경로 계산
const vm = require('vm'); // DOM 경계 실행
const assert = require('assert/strict'); // 독립 기대값
class Element // 간단한 DOM 경계
{ // 요소 시작
    constructor() // 초기 상태
    { // 초기화
        this.value = ''; this.checked = false; this.hidden = false; this.disabled = false; this.children = []; this.textContent = ''; this.handlers = {}; // 브라우저 사용 속성
    } // 초기화 끝
    addEventListener(name, handler) // 이벤트 경계
    { // 등록
        this.handlers[name] = handler; // 실제 제품 핸들러
    } // 등록 끝
    replaceChildren(...children) // 내용 폐기
    { // 교체
        this.children = children; // 새 결과
    } // 교체 끝
    append(child) // 선택지 추가
    { // 추가
        this.children.push(child); // 순서 유지
    } // 추가 끝
} // 요소 끝
async function main() // 개인 저장 보기 동작 검사
{ // 검사 시작
    const nodes = new Map(); const root = new Element(); // 화면 경계
    root.querySelector = (name) => // ID 요소
    { // 조회
        if (!nodes.has(name)) // 첫 사용
        { // 요소 준비
            nodes.set(name, new Element()); // 독립 요소
        } // 요소 준비 끝
        return nodes.get(name); // 경계 반환
    }; // 조회 끝
    const filters = { created_from: '2026-10-01', created_to: '2026-10-21', status: 'done', assignee_id: null }; // 수동 기대 조건
    const view = { view_id: 7, name: '<b>내 완료</b>', filters, is_default: true, version: 2 }; // 안전 출력 자료
    let deferred = null; let applied = null; const posts = []; // 비동기 경계
    const window = { TC_MEMBER_USER: { user_id: 1 }, api: { get: async () => deferred ? new Promise((resolve) => deferred.resolve = resolve) : { views: [view] }, post: async (url, body) => // HTTP 저장 경계
    { // 요청 관찰
        posts.push({ url, body }); return { view }; // 응답 fixture
    } } }; // 외부 경계 끝
    const context = vm.createContext({ window, document: { createElement: () => new Element() }, console }); // 실제 모듈 실행 환경
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../frontend/public/js/saved-views.js'), 'utf8'), context); // 제품 로직
    const saved = window.SavedViews.mount(root, { onApply: (value) => applied = value }); // 실제 화면 연결
    assert.equal((await saved.open({ projectId: 3 })).status, 'done'); // 기본 필터 복원
    assert.equal(nodes.get('#saved-select').children[1].textContent, '<b>내 완료</b>'); // HTML 아닌 안전 텍스트
    nodes.get('#saved-select').value = '7'; await nodes.get('#saved-load').handlers.click(); // 보기 적용
    assert.equal(applied.status, 'done'); // 서버 저장 조건 전달
    saved.setApplied(filters); nodes.get('#saved-name').value = '수정'; // 현재 적용 조건
    await nodes.get('#saved-save').handlers.click(); // 실제 저장
    assert.equal(posts[0].body.version, 2); assert.equal(posts[0].body.filters.status, 'done'); // 충돌 버전과 적용 필터 보존
    saved.clearApplied(); await nodes.get('#saved-save').handlers.click(); // 조회 실패 뒤 저장
    assert.equal(posts.length, 1); // 오래된 필터 저장 금지
    deferred = {}; const pending = saved.open({ projectId: 4 }); // 늦은 서버 응답
    nodes.get('#saved-name').value = '이전 회원 비공개 이름'; nodes.get('#saved-confirm').value = '삭제 확인'; nodes.get('#saved-default').checked = true; // 이전 회원 입력
    saved.close(); // 계정 이탈
    assert.equal(nodes.get('#saved-name').value, ''); assert.equal(nodes.get('#saved-confirm').value, ''); assert.equal(nodes.get('#saved-default').checked, false); // 모든 개인 입력 폐기
    deferred.resolve({ views: [view] }); await pending; // 이탈 뒤 응답
    assert.equal(root.hidden, true); // 이전 회원 화면 부활 방지
    console.log('PASS 저장 보기 기본 복원·안전 출력·적용 필터·버전·실패 후 저장 금지·늦은 응답 폐기'); // 검증 결과
} // 검사 끝
main().catch((error) => // 실패 보고
{ // 오류 처리
    console.error(error); process.exitCode = 1; // 실제 실패
}); // 오류 처리 끝
