// 작업실 선택 우선순위와 유효하지 않은 번호를 검증하는 단위 테스트
'use strict'; // 엄격한 문법 검사
const test = require('node:test'); // Node.js 테스트 실행
const assert = require('node:assert/strict'); // 결과 비교
const fs = require('node:fs'); // 실제 브라우저 스크립트
const vm = require('node:vm'); // 상위 package 설정과 분리한 실행
const selectionModule = { exports: {} }; // 기존 공개 경계
vm.runInNewContext(fs.readFileSync(require.resolve('../../frontend/public/js/workspace-selection.js'), 'utf8'), { module: selectionModule }); // 실제 화면 코드 실행
const WorkspaceSelection = selectionModule.exports; // 화면과 같은 선택 로직
const projects = [ // 테스트용 멤버십
    { project_id: 11, title: '기획', role: 'admin' }, // 첫 작업실
    { project_id: 22, title: '개발', role: 'editor' }, // 두 번째 작업실
];

test('별도 선택 기록이 없으면 첫 번째 참여 작업실을 사용', () => // 초기 화면 검사
{
    assert.equal(WorkspaceSelection.choose(projects, null, null).project_id, 11); // 첫 항목 선택
});

test('기억한 작업실로 돌아가기', () => // 새로고침 복원 검사
{
    assert.equal(WorkspaceSelection.choose(projects, null, 22).project_id, 22); // 기억된 항목 선택
});

test('방금 입장한 작업실이 저장된 선택보다 우선', () => // 재입장 검사
{
    assert.equal(WorkspaceSelection.choose(projects, 11, 22).project_id, 11); // 새 요청 우선
});

test('참여하지 않은 번호를 저장해도 접근하지 않음', () => // 멤버십 검사
{
    assert.equal(WorkspaceSelection.choose(projects, 999, 998).project_id, 11); // 첫 허용 항목으로 대체
});

test('참여 작업실이 없으면 아무것도 선택하지 않음', () => // 빈 목록 검사
{
    assert.equal(WorkspaceSelection.choose([], 11, 11), null); // 목록 부재
});

test('문자열 등 올바르지 않은 번호를 사용하지 않음', () => // 타입 검사
{
    assert.equal(WorkspaceSelection.choose(projects, '22', null).project_id, 11); // 문자열 거부
});
