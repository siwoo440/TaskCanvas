'use strict'; // 엄격한 실행
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert/strict'); // 제품 모듈 검증
const { Element } = require('./test-import-client.js'); // DOM 경계
async function tick() // 비동기 응답 전달
{ // 전달 시작
    await Promise.resolve(); await Promise.resolve(); // 제품 Promise 진행
} // 전달 끝
async function main() // 보고서 UI 검사
{ // 검사 시작
    const pending = []; let lost = 0; // HTTP 경계와 접근 상실
    const context = vm.createContext({ window: { api: { get: (url) => new Promise((resolve, reject) => pending.push({ url, resolve, reject })) } }, document: { createElement: (tag) => new Element(tag) }, URLSearchParams, console }); // 실행 환경
    const base = path.resolve(__dirname, '../../frontend/public/js'); vm.runInContext(fs.readFileSync(path.join(base, 'data-import.js'), 'utf8'), context); vm.runInContext(fs.readFileSync(path.join(base, 'import-quality.js'), 'utf8'), context); // 실제 제품 파일
    const root = new Element(); const view = context.window.ImportQualityView.mount(root, { onAccessLost: () => lost++ }); // 수명 단위
    const summary = { received: 4, valid_rows: 2, error_rows: 2, error_count: 3, warning_rows: 2, warning_count: 3, duplicate_rows: 1, file_duplicate_rows: 1, existing_duplicate_rows: 1, columns: [{ source_id: 's0', label: '<img src=x>', type: 'number', missing_count: 1, missing_rate: 25, error_count: 1, invalid_count: 1 }] }; // 독립 기대 표본
    const report = { run_id: 3, file_name: '<b>품질.csv</b>', checked_at: '2026-10-20 12:00:00', status: 'invalid', schema: summary.columns, key_column: null, duplicate_policy: 'skip', target_version: null, summary, expected: { inserted: 2, updated: 0, skipped: 0, before_rows: 0 }, actual: null, comparison: null }; // 미확정 결과
    const rows = { rows: [{ source_row: 2, issues: [{ severity: 'error', type: 'invalid_number', field: '<img src=x>', message: '숫자 오류' }] }], pagination: { page: 1, total_pages: 2, total: 21 } }; // 행 페이지
    const first = view.open({ projectId: 1, runId: 3 }); pending[0].resolve(report); await tick(); pending[1].resolve(rows); await first; // 최초 보고서
    assert(root.textContent.includes('오류 행 2') && root.textContent.includes('오류 3') && root.textContent.includes('미확정') && root.textContent.includes('<img src=x>')); // 정확 수치·안전 원문
    root.querySelector('#quality-type').value = 'invalid_number'; root.querySelector('#quality-type').handlers.change(); // 상세 조건 변경
    assert.equal(root.querySelector('#quality-rows').textContent, ''); // 이전 목록 즉시 제거
    const filter = root.querySelector('#quality-filter').handlers.submit({ preventDefault() {} }); assert(pending[2].url.includes('type=invalid_number')); // 조건 전송
    const second = view.open({ projectId: 2, runId: 8 }); pending[2].reject({ status: 401 }); await filter; // 옛 신원 오류
    const success = { ...report, file_name: '현재 보고서.csv', status: 'success', expected: { before_rows: 3, inserted: 1, updated: 1, skipped: 1 }, actual: { inserted: 1, updated: 1, skipped: 1, after_rows: 4, version: 2 }, comparison: { counts_match: true, row_count_match: true } }; // 실제 성공
    pending[3].resolve(success); await tick(); pending[4].resolve({ rows: [], pagination: { page: 1, total_pages: 1, total: 0 } }); await second; // 현재 보고서만
    assert.equal(lost, 0); assert(root.textContent.includes('현재 보고서.csv') && root.textContent.includes('일치') && !root.textContent.includes('미확정')); // 확정과 예상 구분
    const old = view.open({ projectId: 2, runId: 9 }); pending[5].reject({ status: 404, code: 'QUALITY_REPORT_NOT_FOUND', message: '상세 품질 보고서가 없습니다.' }); await old; // 과거 이력
    assert(root.textContent.includes('상세 품질 보고서가 없습니다.')); // 추정 없는 안내
    const expired = view.open({ projectId: 2, runId: 8 }); pending[6].reject({ status: 401 }); await expired; assert.equal(lost, 1); assert.equal(root.textContent, ''); // 현재 접근 상실
    const late = view.open({ projectId: 3, runId: 1 }); view.close(); pending[7].resolve(report); await late; assert.equal(root.textContent, ''); // 이탈 뒤 원문 복원 금지
    console.log('PASS 품질 요약·미확정/실제 구분·필터·원문 안전 출력·응답 역전·과거 없음·인증·이탈'); // 실제 결과
} // 검사 끝
main().catch((error) => // 실패 경계
{ // 오류 출력
    console.error(error.stack); process.exitCode = 1; // 실패 종료
}); // 실행 끝
