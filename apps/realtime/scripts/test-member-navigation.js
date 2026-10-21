'use strict'; // 엄격한 검사
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert/strict'); // 제품 함수와 경계
const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/public/js/app.js'), 'utf8'); // 실제 화면 코드
function extract(name, boundary) // 독립된 실제 함수 선택
{ // 선택 시작
    return source.slice(source.indexOf('async function ' + name + '('), source.indexOf(boundary, source.indexOf('async function ' + name + '('))); // 함수 본문 변형 없음
} // 선택 끝
async function main() // 계정 전환 응답 역전 검사
{ // 검사 시작
    let resolveMe; let rendered = null; let filled = 0; // HTTP와 화면 관찰
    const window = { TC_MEMBER_USER: { user_id: 1 }, dispatchEvent() {}, api: { get: () => new Promise((resolve) => resolveMe = resolve) } }; // 비동기 외부 경계
    const state = { project: null, projects: [], guest: null, tasks: new Map(), members: [] }; // 실제 변경 대상
    const context = vm.createContext({ window, state, workspaceGeneration: 0, WorkspaceSelection: { choose: (projects) => projects[0] }, readSelectedProjectId: () => null, rememberSelectedProjectId() {}, Event: class {}, pendingInviteCode: null, resumeOrWorkspace: () => rendered = state.project, showIntro() {}, fillAssigneeSelects: () => filled++, canvas: null }); // 화면 경계
    vm.runInContext(extract('bootstrap', '\n// 홈 화면 구성 전환'), context); // 제품 부트스트랩
    const pending = context.bootstrap(3); // 회원 A의 지연 조회
    window.TC_MEMBER_USER = { user_id: 2 }; context.workspaceGeneration += 1; // 회원 변경과 화면 폐기
    resolveMe({ member: true, guest: { guest_id: 8 }, projects: [{ project_id: 3, guest_id: 8, role: 'admin', title: 'A 비공개' }] }); await pending; // 늦은 A 응답
    assert.equal(state.project, null); assert.equal(rendered, null); // 이전 계정 상태와 화면 복원 금지
    for (const stage of ['select', 'selected-me']) // 선택과 재조회 경계
    { // 단계별 검사
        window.TC_MEMBER_USER = { user_id: 1 }; state.project = null; let release; let ready; let count = 0; // 독립 요청 상태
        const entered = new Promise((resolve) => ready = resolve); // 실제 대기점 확인
        const firstMe = { member: true, guest: { guest_id: 7 }, projects: [{ project_id: 3, guest_id: 8, role: 'admin' }] }; // 다른 연결 이름 선택
        window.api.get = async () => // 실제 API 순서 경계
        { // 조회 시작
            count += 1; // 조회 횟수
            if (count === 1) // 최초 신원
            { // 첫 응답
                return firstMe; // 서버 선택 필요
            } // 첫 응답 끝
            ready(); return new Promise((resolve) => release = resolve); // 선택 후 지연 조회
        }; // 조회 끝
        window.api.post = stage === 'select' ? () => // 선택 요청 지연
        { // 지연 시작
            ready(); return new Promise((resolve) => release = resolve); // 선택 HTTP 경계
        } : async () => ({}); // 재조회 단계의 즉시 선택
        const selected = context.bootstrap(3); await entered; window.TC_MEMBER_USER = { user_id: 2 }; context.workspaceGeneration += 1; // 선택 중 계정 변경
        release({ ...firstMe, guest: { guest_id: 8 } }); await selected; assert.equal(state.project, null); // 각 응답 직후 이전 상태 차단
    } // 단계 검사 끝
    window.TC_MEMBER_USER = undefined; window.api.get = () => new Promise((resolve) => resolveMe = resolve); // 최초 회원 조회 전 상태
    const initial = context.bootstrap(3); window.TC_MEMBER_USER = { user_id: 1 }; // 최초 회원 정보 도착
    resolveMe({ member: true, guest: { guest_id: 8 }, projects: [{ project_id: 3, guest_id: 8, role: 'admin' }] }); await initial; // 정상 첫 화면
    assert.equal(state.project.project_id, 3); // 최초 확인의 정상 진입 보존
    window.TC_MEMBER_USER = { user_id: 1 }; state.project = { project_id: 3 }; // 하위 조회 준비
    const requests = []; window.api.get = () => new Promise((resolve) => requests.push(resolve)); // 병렬 HTTP 경계
    vm.runInContext(extract('loadProjectData', '\nfunction fillAssigneeSelects'), context); // 실제 공유 업무 조회
    const data = context.loadProjectData(); // A 업무 조회 시작
    window.TC_MEMBER_USER = { user_id: 2 }; context.workspaceGeneration += 1; state.project = { project_id: 4 }; state.members = ['B']; state.tasks.set(9, 'B'); // 현재 회원 B
    requests[0]({ members: ['A'] }); requests[1]({ tasks: [{ task_id: 8 }] }); await data; // 늦은 A 자료
    assert.deepEqual(state.members, ['B']); assert.equal(state.tasks.get(9), 'B'); assert.equal(filled, 0); // 현재 회원 자료 보존
    console.log('PASS 계정 전환 뒤 지연 작업실·담당자·업무 응답의 상태 변경 차단'); // 검사 결과
} // 검사 끝
main().catch((error) => // 실패 보고
{ // 실패 시작
    console.error(error); process.exitCode = 1; // 실제 실패 종료
}); // 실패 끝
