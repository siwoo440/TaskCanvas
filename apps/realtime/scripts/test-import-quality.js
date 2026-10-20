'use strict'; // 엄격한 검증
const assert = require('assert/strict'); // 독립 기대값
const Harness = require('./lib/import-harness.cjs'); // 분리 DB와 두 서버
let passed = 0; // 실제 통과 수
function check(condition, label) // 명시적 검사
{ // 비교 시작
    assert(condition, label); console.log('PASS ' + label); passed++; // 검사 결과
} // 비교 끝
function file(text, name = 'quality.csv') // 실제 업로드
{ // 파일 구성
    const form = new FormData(); form.append('file', new Blob([text]), name); return form; // 원본 multipart
} // 파일 끝
async function main() // 품질 전체 흐름
{ // 실행 시작
    const h = await Harness.start(); const api = h.request.bind(h); // 고유 자원
    try // 정리 보장
    { // 표본 시작
        const created = await api('POST', '/api/projects', { display_name: '품질 관리자', title: '품질 격리' }); const cookie = created.cookie; const id = created.data.project.project_id; const route = '/api/projects/' + id; // 본인 작업실
        const foreign = await api('POST', '/api/projects', { display_name: '다른 관리자', title: '다른 품질' }); // 타 작업실
        const invite = await api('POST', route + '/invites', { role: 'viewer', days: 1 }, cookie); const viewer = await api('POST', '/api/guest/join', { display_name: '품질 열람자', invite_code: invite.data.code }); // 읽기 권한
        const columns = [{ source_id: 's0', label: '키', type: 'text', required: true }, { source_id: 's1', label: '숫자', type: 'number', required: false }, { source_id: 's2', label: '날짜', type: 'date', required: true }]; // 고정 매핑
        async function validate(text, extra = {}) // 실제 전체 검증
        { // 요청 구성
            const upload = await api('POST', route + '/imports/upload', file(text), cookie); check(upload.status === 201, '품질 원본 업로드'); // 서버 원본
            const response = await api('POST', route + '/imports/validate', { draft_token: upload.data.draft_token, name: '품질 표본', columns, key_column: 'c0', ...extra }, cookie); return { response, token: upload.data.draft_token }; // 실제 응답
        } // 검증 도우미 끝
        const invalid = await validate('키,숫자,날짜\nPRIVATE_A,,2026-10-20\nPRIVATE_B,틀림,2026-02-30\n,2,2026-10-20\nPRIVATE_A,3,2026-10-20\n'); // 오류와 경고
        check(invalid.response.status === 200 && invalid.response.data.quality?.error_count === 3, '전체 품질 요약과 오류3개'); // 구현 전 RED
        const run = invalid.response.data.run_id; const qualityPath = route + '/imports/runs/' + run + '/quality'; // 저장 보고서
        const detail = await api('GET', qualityPath, null, viewer.cookie); const q = detail.data; // 열람자 읽기
        check(detail.status === 200 && q.summary.error_rows === 2 && q.summary.valid_rows === 2 && q.actual === null, '오류 행2개·정상2개·미확정'); // 오류 개수와 구분
        check(q.summary.columns[1].missing_count === 1 && q.summary.columns[1].missing_rate === 25, '실제 결측만 집계'); // 변환 실패 제외
        check(!JSON.stringify(q).includes('PRIVATE_A') && !JSON.stringify(q).includes('PRIVATE_B') && !JSON.stringify(q).includes(invalid.token), '원문과 토큰 비노출'); // 공개 보고서 보호
        check(detail.headers.get('cache-control').includes('no-store'), '품질 응답 캐시 금지'); // 인증 자료
        check((await api('GET', qualityPath)).status === 401, '품질 비인증 거부'); // 인증 우선
        check((await api('GET', qualityPath, null, foreign.cookie)).status === 403, '타 작업실 접근 거부'); // 멤버십 경계
        const otherRoute = '/api/projects/' + foreign.data.project.project_id + '/imports/runs/' + run + '/quality'; // 타 작업실 경로 위조
        check((await api('GET', otherRoute, null, foreign.cookie)).status === 404, '보고서 ID의 작업실 범위'); // 자료 소유
        const missing = await api('GET', qualityPath + '/rows?severity=warning&type=optional_missing&column=s1', null, cookie); // 복합 필터
        check(missing.data.pagination.total === 1 && missing.data.rows[0].source_row === 1 && missing.data.rows[0].issues.length === 1, '컬럼·유형·경고 교집합'); // 정확한 행 집계
        const errors = await api('GET', qualityPath + '/rows?severity=error', null, cookie); check(errors.data.pagination.total === 2 && errors.data.rows[0].issues.length === 2, '한 행 여러 오류의 페이지 중복 없음'); // 행 단위 페이지
        for (const query of ['page=0', 'page=-1', 'page=1.1', 'page[]=1', 'page=99999999999999999999', 'severity=bad', 'type=bad', 'column=s49', 'unknown=x']) // 잘못된 필터
        { // 입력 거부
            check((await api('GET', qualityPath + '/rows?' + query, null, cookie)).status === 400, '품질 필터400 ' + query); // 명확한 계약
        } // 필터 검사 끝
        check((await api('POST', route + '/imports/commit', { draft_token: invalid.token, validation_revision: invalid.response.data.validation_revision }, cookie)).status === 422, '품질 오류 전체 저장 차단'); // 기존 안전 유지
        for (const json of ['[{"a":"ok","b":"ok"},false]', '[{"a":"ok","b":"ok"},{"a":[],"b":"ok"}]', '[{"a":"ok","b":"ok"},{"a":"\\u0001","b":"ok"}]']) // 구조 출처 보관 회귀
        { // 실제 JSON 검사
            await h.db.query('UPDATE import_drafts SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE status<>?', ['consumed']); // 이 표본의 공간
            const uploaded = await api('POST', route + '/imports/upload', file(json, 'quality.json'), cookie); // 실제 파서
            const tested = await api('POST', route + '/imports/validate', { draft_token: uploaded.data.draft_token, name: '구조 검사', columns: [{ source_id: 's0', label: 'a', type: 'text', required: true }, { source_id: 's1', label: 'b', type: 'text', required: false }] }, cookie); // 필수·선택 판정
            check(tested.status === 200 && tested.data.quality.error_count === 1 && tested.data.quality.warning_count === 0 && tested.data.quality.columns.every((c) => c.missing_count === 0), '구조 null의 거짓 결측·필수·경고 없음'); // 원문 의미 유지
            const storedIssues = await api('GET', route + '/imports/runs/' + tested.data.run_id + '/quality/rows?type=required_missing', null, cookie); check(storedIssues.data.pagination.total === 0, '저장 보고서 필수 결측 필터의 거짓 항목 없음'); // API까지 일관성
        } // 구조 표본 끝
        const many = await validate('키,숫자,날짜\n' + Array.from({ length: 120 }, (_, i) => 'K' + i + ',틀림,2026-10-20').join('\n')); // 첫100 초과
        const manyPath = route + '/imports/runs/' + many.response.data.run_id + '/quality/rows'; // 전체 상세
        const page6 = await api('GET', manyPath + '?page=999', null, cookie); check(page6.data.pagination.page === 6 && page6.data.pagination.total === 120 && page6.data.rows.length === 20 && page6.data.rows[0].source_row === 101, '120오류 전체6페이지와 마지막 보정'); // 보고서 누락 없음
        const empty = await api('GET', manyPath + '?severity=warning', null, cookie); check(empty.data.pagination.total === 0 && empty.data.pagination.page === 1, '빈 품질 페이지1/1'); // 빈 결과
        await h.db.query('UPDATE import_drafts SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND)'); // 초안 공간과 만료
        const valid = await validate('키,숫자,날짜\nA,0.1,2026-10-20\nB,0.2,2026-10-20\n'); // 신규 저장
        const body = { draft_token: valid.token, validation_revision: valid.response.data.validation_revision }; // 동일 확정 식별자
        const saves = await Promise.all([0, 1].map((index) => api('POST', route + '/imports/commit', body, cookie, index))); check(saves.every((r) => r.status === 200) && saves[0].data.run_id === saves[1].data.run_id, '동시 저장의 단일 보고서'); // 멱등 결과
        const savedPath = route + '/imports/runs/' + valid.response.data.run_id + '/quality'; const saved = await api('GET', savedPath, null, cookie); // 확정 대조
        check(saved.data.expected.inserted === 2 && saved.data.actual.inserted === 2 && saved.data.actual.after_rows === 2 && saved.data.comparison.counts_match && saved.data.comparison.row_count_match, '예상·확정·DB행수 일치'); // 정합성
        const [[raw]] = await h.db.query('SELECT COUNT(*) AS n FROM import_draft_chunks c JOIN import_drafts d ON d.draft_hash=c.draft_hash WHERE d.status=?', ['consumed']); check(raw.n === 0 && saved.status === 200, '성공 원본 제거 후 보고서 유지'); // 수명 분리
        const datasetId = saves[0].data.dataset_id; const mapping = [{ id: 'c0', source_id: 's0' }, { id: 'c1', source_id: 's1' }, { id: 'c2', source_id: 's2' }]; // 기존 스키마
        const merge = await validate('키,숫자,날짜\nA,1,2026-10-20\nA,2,2026-10-20\nC,3,2026-10-20\n', { mode: 'merge', name: undefined, key_column: undefined, columns: mapping, target_dataset_id: datasetId, expected_version: 1, duplicate_policy: 'update' }); // 중첩 중복
        check(merge.response.data.quality.duplicate_rows === 2 && merge.response.data.quality.file_duplicate_rows === 1 && merge.response.data.quality.existing_duplicate_rows === 2, '중첩 중복의 합집합2·개별1/2'); // 단순 합 금지
        const merged = await api('POST', route + '/imports/commit', { draft_token: merge.token, validation_revision: merge.response.data.validation_revision }, cookie); // 실제 갱신
        check(merged.data.inserted === 1 && merged.data.updated === 1 && merged.data.skipped === 1 && merged.data.row_count === 3, '갱신은 전체 행 수 증가 없음'); // 카운터 의미
        const conflict = await validate('키,숫자,날짜\nA,4,2026-10-20\n', { mode: 'merge', name: undefined, key_column: undefined, columns: mapping, target_dataset_id: datasetId, expected_version: 2 }); // 오래될 버전
        await h.db.query('UPDATE import_datasets SET version=version+1 WHERE dataset_id=?', [datasetId]); // 다른 저장 재현
        check((await api('POST', route + '/imports/commit', { draft_token: conflict.token, validation_revision: conflict.response.data.validation_revision }, cookie)).status === 409, '과거 보고서 대상 버전 충돌'); // 덮어쓰기 금지
        const conflictReport = await api('GET', route + '/imports/runs/' + conflict.response.data.run_id + '/quality', null, cookie); check(conflictReport.data.actual === null && conflictReport.data.status === 'failed', '충돌을 확정으로 표시하지 않음'); // 허위 성공 금지
        await h.db.query('UPDATE import_drafts SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE status<>?', ['consumed']); // 다음 표본 공간
        const rollback = await validate('키,숫자,날짜\nROLLBACK,1,2026-10-20\n'); // 정상 사전 검증
        await h.db.query("CREATE TRIGGER quality_confirm_failure BEFORE UPDATE ON import_quality_reports FOR EACH ROW BEGIN IF NEW.actual_json IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='quality test failure'; END IF; END"); // 실제 보고서 확정 SQL 실패
        const failed = await api('POST', route + '/imports/commit', { draft_token: rollback.token, validation_revision: rollback.response.data.validation_revision }, cookie); // 전체 롤백
        const [[rollCount]] = await h.db.query("SELECT COUNT(*) AS n FROM import_rows WHERE key_value='ROLLBACK'"); check(failed.status === 500 && rollCount.n === 0, '보고서 확정 실패 시 데이터 전체 롤백'); // 분리 성공 금지
        await h.db.query('DROP TRIGGER quality_confirm_failure'); // 주입 해제
        check((await api('POST', route + '/imports/commit', { draft_token: rollback.token, validation_revision: rollback.response.data.validation_revision }, cookie)).status === 200, '보고서 실패 뒤 같은 요청 재시도'); // 원본 보존
        const [[countBefore]] = await h.db.query('SELECT COUNT(*) AS n FROM import_runs'); // 검증 실패 기준
        await h.db.query("CREATE TRIGGER quality_append_failure BEFORE INSERT ON import_quality_rows FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='quality row test failure'"); // 검증 기록 실패
        const badRecording = await validate('키,숫자,날짜\nA,틀림,2026-10-20\n'); const [[countAfter]] = await h.db.query('SELECT COUNT(*) AS n FROM import_runs'); // 트랜잭션 결과
        check(badRecording.response.status === 500 && countBefore.n === countAfter.n, '품질 기록 실패 검증 전체 롤백'); // 보고서 없는 성공 금지
        await h.db.query('DROP TRIGGER quality_append_failure'); // 주입 해제
        await h.db.query('DELETE FROM import_drafts'); check((await api('GET', qualityPath, null, cookie)).status === 200, '초안 전체 정리 후 과거 보고서 유지'); // 보관 수명
        await h.db.query("INSERT INTO import_runs (project_id,draft_hash,validation_revision,status,file_name,source_sha256) VALUES (?,REPEAT('e',64),1,'success','old.csv',REPEAT('f',64))", [id]); const [[old]] = await h.db.query('SELECT MAX(run_id) AS id FROM import_runs'); // 보고서 없는 기존 이력
        const oldResponse = await api('GET', route + '/imports/runs/' + old.id + '/quality', null, cookie); check(oldResponse.status === 404 && oldResponse.data.error.code === 'QUALITY_REPORT_NOT_FOUND', '과거 보고서 추정 생성 없음'); // 명확한 미지원
        const headers = Array.from({ length: 50 }, (_, i) => 'C' + i); const bigColumns = headers.map((label, i) => ({ source_id: 's' + i, label, type: 'text', required: true })); // 최대 필수 컬럼
        const big = await validate(headers.join(',') + '\n' + Array.from({ length: 10000 }, () => ','.repeat(49)).join('\n'), { columns: bigColumns, key_column: null }); // 최대 문제500000개
        check(big.response.status === 200 && big.response.data.quality.error_count === 500000 && big.response.data.quality.error_rows === 10000, '최대10000행·50열 전체 오류 검사'); // 표시만 제한
        const [[size]] = await h.db.query('SELECT COUNT(*) AS n,MAX(OCTET_LENGTH(issues_json)) AS biggest FROM import_quality_rows WHERE run_id=?', [big.response.data.run_id]); check(size.n === 10000 && size.biggest < 1048576, '1MiB 패킷의 작은 문제 행 기록'); // 단일 거대 JSON 없음
        const [[reportCount]] = await h.db.query('SELECT COUNT(*) AS n FROM import_quality_reports'); await h.db.query('DELETE FROM projects WHERE project_id=?', [id]); const [[remaining]] = await h.db.query('SELECT COUNT(*) AS n FROM import_quality_reports'); check(reportCount.n > 0 && remaining.n === 0, '작업실 삭제의 품질 보고서 FK 정리'); // 종속 수명
        console.log('품질 API ' + passed + '개 통과'); // 실제 결과
    } // 표본 끝
    finally // 고유 환경 정리
    { // 정리 시작
        await h.close(); // 분리 DB와 서버만 정리
    } // 정리 끝
} // 실행 끝
main().catch((error) => // 실패 전달
{ // 오류 출력
    console.error(error.stack); process.exitCode = 1; // 실패 종료
}); // 실행 끝
