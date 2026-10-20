'use strict'; // 엄격한 실행
const fs = require('fs'); // 실제 제품 파일
const path = require('path'); // 제품 경로
const vm = require('vm'); // 화면 모듈 실행
const assert = require('assert/strict'); // 독립 기대값
const { Element } = require('./test-import-client.js'); // DOM 경계 대역
async function main() // 저장 단계 회귀
{ // 검증 시작
    const requests = []; let saved = null; // 실제 전송과 확정 결과
    const api = Object.fromEntries(['post', 'multipart'].map((method) => [method, (url, body) => new Promise((resolve, reject) => requests.push({ method, url, body, resolve, reject }))])); // HTTP 응답 경계
    const context = vm.createContext({ window: { api }, document: { createElement: (tag) => new Element(tag) }, FormData, console }); // 실제 모듈 환경
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../frontend/public/js/data-import.js'), 'utf8'), context); // 제품 가져오기 화면
    const root = new Element(); const view = context.window.DataImport.mount(root, { onSaved: (result) => saved = result, onAccessLost() {} }); // 화면 소유
    const find = (id) => root.querySelector('#import-' + id); // 현재 요소
    const source = { draft_token: 'private-token', format: 'json', json_path: '/items', paths: [], requires_path: false, row_count: 1, columns: [{ source_id: 's0', label: '날짜' }], rows: [{ source_row: 1, values: ['2026-10-20'], errors: [] }] }; // 서버 원본 표본
    const validation = { validation_revision: 7, schema: [{ id: 'c0', label: '날짜' }], rows: [{ source_row: 1, values: ['2026-10-20'] }], report: { received: 1, inserted: 1, updated: 0, skipped: 0, error_count: 0, errors: [], can_commit: true } }; // 전체 검증 표본
    view.open({ projectId: 3, role: 'editor', target: null }); find('file').files = [new Blob(['[]'])]; // 현재 세션
    const upload = find('upload').handlers.click(); requests[0].resolve(source); await upload; // 실제 업로드 응답
    const validate = find('validate').handlers.click(); requests[1].resolve(validation); await validate; // 저장 가능 상태
    const commit = find('commit').handlers.click(); // 첫 확정 요청
    assert(find('file').disabled && find('close').disabled && find('upload').disabled); // 저장 중 조건 잠금
    assert.deepEqual(JSON.parse(JSON.stringify(requests[2].body)), { draft_token: 'private-token', validation_revision: 7 }); // 행 본문 위조 없는 전송
    requests[2].reject(new Error('응답 유실')); await commit; // 네트워크 실패
    assert.equal(find('commit').disabled, false); assert.equal(saved, null); // 거짓 성공 없는 동일 요청 재시도
    const retry = find('commit').handlers.click(); assert.equal(requests[3].body.draft_token, requests[2].body.draft_token); // 같은 멱등 식별자
    requests[3].resolve({ dataset_id: 12, inserted: 1, updated: 0, skipped: 0 }); await retry; // 실제 확정 결과
    assert.equal(saved.dataset_id, 12); assert.equal(root.textContent, ''); // 확정 뒤 원본 폐기
    view.open({ projectId: 3, role: 'editor', target: null }); find('file').files = [new Blob(['[]'])]; // 새 가져오기
    const next = find('upload').handlers.click(); requests[4].resolve(source); await next; // 경로가 있는 원본
    const ready = find('validate').handlers.click(); requests[5].resolve(validation); await ready; // 보고서 표시
    const expiry = find('commit').handlers.click(); requests[6].reject({ status: 410, message: '초안 만료' }); await expiry; // 만료 중 저장
    assert(!root.textContent.includes('정규화 미리보기')); // 만료된 보고서 원문 제거
    assert(find('repreview').disabled && find('validate').disabled && find('commit').disabled); // 만료 초안 조작 차단
    find('file').files = [new Blob(['a\n1'])]; find('file').handlers.change(); // 다른 파일 선택
    assert.equal(find('path').value, ''); // 이전 JSON 경로 폐기
    view.open({ projectId: 3, role: 'editor', target: null }); find('file').files = [new Blob(['[]'])]; // 업로드 입력 경합
    const editing = find('upload').handlers.click(); find('name').value = '전송 중 변경한 이름'; find('name').handlers.input(); // 서버 원본과 무관한 설정
    requests[7].resolve(source); await editing; // 정상 업로드 응답
    assert.equal(find('validate').disabled, false); assert(root.textContent.includes('원본 미리보기')); // 불필요한 초안 재업로드 방지
    const invalid = find('validate').handlers.click(); assert.equal(requests[8].body.name, '전송 중 변경한 이름'); // 변경한 이름 유지
    requests[8].resolve({ ...validation, report: { ...validation.report, can_commit: false, error_count: 120, errors: Array.from({ length: 100 }, (_, i) => ({ source_row: i + 1, field: '날짜', message: '날짜 오류' })) } }); await invalid; // 전체 오류와 표시 한도
    assert(root.textContent.includes('전체 120개 중 첫 100개')); // 숨은 오류 위치 안내
    view.close(); view.open({ projectId: 3, role: 'editor', target: null }); find('file').files = [new Blob(['[]'])]; // 파일 교체 경합
    const replaced = find('upload').handlers.click(); find('file').files = [new Blob(['a\n1'])]; find('file').handlers.change(); requests[9].resolve(source); await replaced; // 예전 파일 응답
    assert(find('validate').disabled && !root.textContent.includes('원본 미리보기')); // 다른 파일의 성공 응답 폐기
    console.log('PASS 저장 잠금·멱등 재시도·만료 정리·업로드 중 이름 유지·파일 응답 격리·오류 표시 한도'); // 확인 결과
} // 검증 끝
main().catch((error) => // 실패 전달
{ // 오류 시작
    console.error(error.stack); process.exitCode = 1; // 실패 종료
}); // 실행 끝
