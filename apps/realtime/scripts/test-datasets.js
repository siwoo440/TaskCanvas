'use strict'; // 엄격한 검사
const assert = require('assert/strict'); // 독립 기대값
const crypto = require('crypto'); // 원본 해시 비교
const Harness = require('./lib/import-harness.cjs'); // 고유 DB·서버
const { execFileSync } = require('child_process'); // 분리 DB CLI 검증
let passed = 0; // 실제 검사 수
function check(value, label) // 결과 검사
{ // 검사 시작
    assert(value, label); passed += 1; console.log('PASS ' + label); // 결과 출력
} // 검사 끝
function file(text, name = '표본.csv', encoding = 'UTF-8') // 실제 파일 전송
{ // 파일 생성
    const form = new FormData(); form.append('file', new Blob([text]), name); form.append('encoding', encoding); // multipart 바이트
    return form; // 브라우저와 같은 전송
} // 파일 생성 끝
async function main() // 가져오기 통합 검증
{ // 실행 시작
    const h = await Harness.start(); // 두 서버와 고유 DB
    const api = h.request.bind(h); // 실제 요청
    try // 테스트 정리 보장
    { // 시나리오 시작
        check((await api('POST', '/api/projects/1/imports/upload', file('a\n1'))).status === 401, '가져오기 비인증 거부'); // 구현 전 실패 기준
        const password = 'Import30-test!'; // 테스트 전용 비밀번호
        await api('POST', '/api/auth/register', { login_id: 'import30', display_name: '가져오기 관리자', password, password_confirm: password }); // 회원 fixture
        const login = await api('POST', '/api/auth/login', { login_id: 'import30', password }); // 회원 쿠키
        const created = await api('POST', '/api/projects', { display_name: '가져오기 관리자', title: '가져오기 검증' }, login.cookie); // 소유 작업실
        const cookie = login.cookie + '; ' + created.cookie; // 회원 결합 세션
        const id = created.data.project.project_id; const route = '/api/projects/' + id; // 테스트 범위
        const foreign = await api('POST', '/api/projects', { display_name: '다른 관리자', title: '격리 작업실' }); // 다른 작업실
        const invite = await api('POST', route + '/invites', { role: 'viewer', days: 1 }, cookie); // 열람 권한
        const viewer = await api('POST', '/api/guest/join', { display_name: '열람자', invite_code: invite.data.code }); // 독립 게스트
        const editInvite = await api('POST', route + '/invites', { role: 'editor', days: 1 }, cookie); // 편집자 권한
        const editor = await api('POST', '/api/guest/join', { display_name: '편집자', invite_code: editInvite.data.code }); // 다른 세션
        check((await api('POST', route + '/imports/upload', file('a\n1'), viewer.cookie)).status === 403, '열람자 업로드 거부'); // 서버 역할
        check((await api('POST', route + '/imports/upload', file('a\n1'), foreign.cookie)).status === 403, '타 작업실 업로드 거부'); // 범위 보호
        check((await api('POST', route + '/imports/upload', file('a\n1'), created.cookie)).status === 401, '회원 쿠키 누락 차단'); // 회원 결합
        check((await api('POST', route + '/imports/upload', file('a\n1'), cookie, 0, false)).status === 403, '변경 보호 헤더 요구'); // CSRF
        const source = '분류,금액\nA,0.1\nB,0.2\n'; // 실제 원본
        const upload = await api('POST', route + '/imports/upload', file(source), cookie); // 초안 업로드
        check(upload.status === 201 && upload.data.row_count === 2 && upload.data.rows.length === 2, '첫20행과 전체 행 수'); // 원본 확인
        const token = upload.data.draft_token; // 테스트 초안
        check(/^[0-9a-f]{48}$/.test(token) && !upload.text.includes('guest_session_id'), '불투명 토큰과 세션 비공개'); // 신원 보호
        const [[draft]] = await h.db.query('SELECT draft_hash,source_sha256 FROM import_drafts WHERE draft_hash=?', [crypto.createHash('sha256').update(token).digest('hex')]); // 보관 검증
        check(draft.source_sha256 === crypto.createHash('sha256').update(source).digest('hex'), '원본 SHA256 보존'); // 독립 무결성
        check((await api('POST', route + '/imports/preview', { draft_token: token }, editor.cookie)).status === 404, '다른 세션 초안 접근 차단'); // 소유 검사
        const json = await api('POST', route + '/imports/upload', file('{"items":[{"name":"자료"}]}', '자료.json'), cookie); // JSON 업로드
        check(json.status === 201 && json.data.requires_path && json.data.row_count === null, 'JSON 배열 경로 선택 대기'); // 미선택 상태
        const preview = await api('POST', route + '/imports/preview', { draft_token: json.data.draft_token, json_path: '/items' }, cookie); // 실제 경로
        check(preview.status === 200 && preview.data.row_count === 1 && preview.data.rows[0].values[0] === '자료', 'JSON 경로 미리보기'); // 서버 해석
        const large = 'a\n1\n' + '\n'.repeat(5242880 - 4); // 정확한 5MiB CSV
        const largeUpload = await api('POST', route + '/imports/upload', file(large), cookie); // 1MiB DB 패킷 경계
        check(largeUpload.status === 201, '1MiB DB 패킷에서 5MiB 업로드'); // 조각 저장
        const [[chunks]] = await h.db.query('SELECT COUNT(*) AS n,MAX(OCTET_LENGTH(data)) AS biggest,SUM(OCTET_LENGTH(data)) AS bytes FROM import_draft_chunks WHERE draft_hash=?', [crypto.createHash('sha256').update(largeUpload.data.draft_token).digest('hex')]); // 실제 조각
        check(chunks.n === 80 && chunks.biggest === 65536 && Number(chunks.bytes) === 5242880, '80개 조각·64KiB 한도·전체 바이트'); // 실제 DB 증거
        check((await api('POST', route + '/imports/preview', { draft_token: largeUpload.data.draft_token }, cookie)).data.row_count === 1, '조각 복원과 원본 파싱'); // 순서·해시
        check((await api('POST', route + '/imports/upload', file('a\n1'), cookie)).status === 429, '세션 초안3개 한도'); // 누적 한도
        await h.db.query('UPDATE import_drafts SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE draft_hash=?', [draft.draft_hash]); // 실제 만료
        check((await api('POST', route + '/imports/preview', { draft_token: token }, cookie)).status === 410, '초안15분 만료 차단'); // TTL
        check((await api('POST', route + '/imports/upload', file('a\n1'), cookie)).status === 201, '만료 초안 정리 후 재업로드'); // 한도 복구
        const brokenHash = crypto.createHash('sha256').update(largeUpload.data.draft_token).digest('hex'); // 조각 대상
        await h.db.query('DELETE FROM import_draft_chunks WHERE draft_hash=? AND chunk_no=1', [brokenHash]); // 일부 손상
        check((await api('POST', route + '/imports/preview', { draft_token: largeUpload.data.draft_token }, cookie)).status === 409, '누락 조각 복원 거부'); // 무결성
        check((await api('POST', route + '/imports/upload', file('x'.repeat(5242881)), editor.cookie)).status === 413, '실제 파일5MiB 초과 거부'); // 파싱 전 크기
        check((await api('POST', route + '/imports/upload', file('a\n1', '자료.zip'), editor.cookie)).status === 415, '허용 확장자 제한'); // 압축 파일 제외
        check((await api('POST', route + '/imports/upload', file('[1,', '깨진.json'), editor.cookie)).status === 415, '미완성 JSON 구문 안내'); // 표준 오류
        if (!process.argv.includes('--drafts')) // 저장 단계 검증
        { // 저장 시나리오
            await h.db.query('UPDATE import_drafts SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND)'); // 준비 초안만 만료
            const newDraft = async (text, who = cookie) => // 원본 fixture
            { // 업로드 준비
                const response = await api('POST', route + '/imports/upload', file(text), who); // 실제 업로드
                check(response.status === 201, '저장용 초안 생성'); return response.data.draft_token; // 제한 없는 유효 초안
            }; // 원본 fixture 끝
            const columns = [{ source_id: 's0', label: '키', type: 'text', required: true }, { source_id: 's1', label: '값', type: 'number', required: true }]; // 고정 매핑
            const original = await newDraft('키,값\nA,0\n'); // 초기 대상
            const validate = await api('POST', route + '/imports/validate', { draft_token: original, mode: 'create', name: '정확한 자료', columns, key_column: 'c0', duplicate_policy: 'skip' }, cookie); // 전체 검증
            check(validate.status === 200 && validate.data.report.can_commit && validate.data.report.inserted === 1, '신규 자료 전체 검증'); // 구현 전 실패
            const revision = validate.data.validation_revision; // 서버 검증 세대
            const save = await api('POST', route + '/imports/commit', { draft_token: original, validation_revision: revision }, cookie); // 원자적 저장
            check(save.status === 200 && save.data.inserted === 1 && save.data.version === 1, '신규 자료 원자적 저장'); // 실제 적용
            const datasetId = save.data.dataset_id; // 저장 대상
            const replay = await api('POST', route + '/imports/commit', { draft_token: original, validation_revision: revision }, cookie, 1); // 응답 유실 재시도
            check(replay.status === 200 && JSON.stringify(replay.data) === JSON.stringify(save.data), '확정 결과 멱등 재응답'); // 데이터 중복 금지
            const [[rawGone]] = await h.db.query('SELECT COUNT(*) AS n FROM import_draft_chunks WHERE draft_hash=?', [crypto.createHash('sha256').update(original).digest('hex')]); // 원본 수명
            check(rawGone.n === 0, '성공 초안 원본 조각 삭제'); // 원문 보관 최소화
            const mapping = [{ id: 'c0', source_id: 's0' }, { id: 'c1', source_id: 's1' }]; // 고정 스키마 연결
            let version = 1; // 명시적 동시 버전
            for (const policy of ['skip', 'update']) // 두 정책
            { // 재가져오기
                const token = await newDraft('키,값\nA,1\nA,2\nB,3\n'); // 파일 내 중복
                const result = await api('POST', route + '/imports/validate', { draft_token: token, mode: 'merge', target_dataset_id: datasetId, expected_version: version, columns: mapping, duplicate_policy: policy }, cookie); // 대상 검증
                const expected = policy === 'skip' ? [1, 0, 2] : [0, 2, 1]; // 첫 저장 후 B 존재
                check(result.status === 200 && [result.data.report.inserted, result.data.report.updated, result.data.report.skipped].join() === expected.join(), '중복 정책 예상 건수 ' + policy); // 독립 기대값
                const committed = await api('POST', route + '/imports/commit', { draft_token: token, validation_revision: result.data.validation_revision }, cookie); // 실제 갱신
                check(committed.status === 200 && committed.data.version === ++version, '중복 정책 저장 ' + policy); // 버전 증가
            } // 재가져오기 끝
            const [stored] = await h.db.query('SELECT row_id,key_value,values_json FROM import_rows WHERE dataset_id=? ORDER BY row_id', [datasetId]); // 직접 저장 비교
            check(stored.length === 2 && stored[0].row_id === 1 && JSON.parse(stored[0].values_json)[1] === '2' && JSON.parse(stored[1].values_json)[1] === '3', '갱신 값·원래 row_id 유지'); // 덮어쓰기 규칙
            const wrong = await newDraft('키,값\nX,틀림\n'); // 오류 자료
            const invalid = await api('POST', route + '/imports/validate', { draft_token: wrong, mode: 'create', name: '오류 자료', columns, key_column: null, duplicate_policy: 'skip' }, cookie); // 오류 보고
            check(invalid.status === 200 && invalid.data.report.error_count === 1 && !invalid.data.report.can_commit, '전체 오류 보고와 저장 불가'); // 실패를 성공으로 표시 금지
            check((await api('POST', route + '/imports/commit', { draft_token: wrong, validation_revision: invalid.data.validation_revision }, cookie)).status === 422, '오류 자료 commit422'); // 서버 강제
            const conflict = await newDraft('키,값\nA,4\n'); // 검증 후 변경 대상
            const beforeConflict = await api('POST', route + '/imports/validate', { draft_token: conflict, mode: 'merge', target_dataset_id: datasetId, expected_version: version, columns: mapping, duplicate_policy: 'update' }, cookie); // 기존 버전
            await h.db.query('UPDATE import_datasets SET version=version+1 WHERE dataset_id=?', [datasetId]); // 다른 편집자의 완료 상태 재현
            check((await api('POST', route + '/imports/commit', { draft_token: conflict, validation_revision: beforeConflict.data.validation_revision }, cookie)).status === 409, '검증 후 버전 충돌 차단'); // 이전 자료 덮기 금지
            await h.db.query('UPDATE import_drafts SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE status<>?', ['consumed']); // 다음 fixture 공간
            const concurrent = await newDraft('키,값\nC,0.1\nD,0.2\n'); // 동시 신규 저장
            const ready = await api('POST', route + '/imports/validate', { draft_token: concurrent, mode: 'create', name: '동시 자료', columns, key_column: 'c0', duplicate_policy: 'skip' }, cookie); // 검증 세대
            const pair = await Promise.all([0, 1].map((index) => api('POST', route + '/imports/commit', { draft_token: concurrent, validation_revision: ready.data.validation_revision }, cookie, index))); // 두 실제 서버
            check(pair.every((response) => response.status === 200) && pair[0].data.dataset_id === pair[1].data.dataset_id, '동시 commit 하나의 데이터셋'); // 행 잠금 멱등성
            const [[onlyOne]] = await h.db.query('SELECT COUNT(*) AS n FROM import_rows WHERE dataset_id=?', [pair[0].data.dataset_id]); // 실제 행 수
            check(onlyOne.n === 2, '동시 commit 행 중복 없음'); // 실제 DB 증거
            await h.db.query('UPDATE import_drafts SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE status<>?', ['consumed']); // 다음 검증 공간
            const many = await newDraft('키,값\n' + Array.from({ length: 120 }, (_, i) => 'K' + i + ',오류').join('\n')); // 전체 오류 표본
            const manyResult = await api('POST', route + '/imports/validate', { draft_token: many, mode: 'create', name: '전체 오류', columns, duplicate_policy: 'skip' }, cookie); // 전체 행 검사
            check(manyResult.data.report.error_count === 120 && manyResult.data.report.errors.length === 100 && manyResult.data.report.error_rows === 120, '전체120오류와 표시100개'); // 제한과 총계 분리
            const noKey = await newDraft('키,값\nA,1\nA,1\n'); // 중복 허용 자료
            const noKeyReady = await api('POST', route + '/imports/validate', { draft_token: noKey, mode: 'create', name: '키 없는 자료', columns, duplicate_policy: 'skip' }, cookie); // 키 없는 검증
            check((await api('POST', route + '/imports/commit', { draft_token: noKey, validation_revision: noKeyReady.data.validation_revision, rows: [] }, cookie)).status === 400, '클라이언트 행 위조 거부'); // 서버 원본 전용
            check((await api('POST', route + '/imports/commit', { draft_token: noKey, validation_revision: noKeyReady.data.validation_revision + 1 }, cookie)).status === 409, '다른 검증 세대 거부'); // revision 보호
            const noKeySave = await api('POST', route + '/imports/commit', { draft_token: noKey, validation_revision: noKeyReady.data.validation_revision }, cookie); // 실제 두 행
            check(noKeySave.data.row_count === 2, '키 없는 동일 행 모두 저장'); // 파일 중복 보존
            check((await api('POST', route + '/imports/validate', { draft_token: many, mode: 'merge', target_dataset_id: noKeySave.data.dataset_id, expected_version: 1, columns: mapping, duplicate_policy: 'update' }, cookie)).status === 400, '키 없는 자료 재가져오기 거부'); // 갱신 식별자 필요
            const rollback = await newDraft('키,값\nOK,1\nFAIL,2\n'); // 두 번째 INSERT 실패
            const rollbackReady = await api('POST', route + '/imports/validate', { draft_token: rollback, mode: 'create', name: '롤백 대상', columns, key_column: 'c0', duplicate_policy: 'skip' }, cookie); // 정상 사전 검증
            await h.db.query("CREATE TRIGGER import_force_failure BEFORE INSERT ON import_rows FOR EACH ROW BEGIN IF NEW.key_value='FAIL' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated test failure'; END IF; END"); // 분리 DB 오류 주입
            const failed = await api('POST', route + '/imports/commit', { draft_token: rollback, validation_revision: rollbackReady.data.validation_revision }, cookie); // 실제 SQL 오류
            const [[rolledBack]] = await h.db.query("SELECT COUNT(*) AS n FROM import_datasets WHERE name='롤백 대상'"); // 원자성 증거
            const [[failedRun]] = await h.db.query('SELECT status FROM import_runs WHERE draft_hash=?', [crypto.createHash('sha256').update(rollback).digest('hex')]); // 실패 이력
            check(failed.status === 500 && rolledBack.n === 0 && failedRun.status === 'failed', '실제 SQL 실패 전체 롤백과 실패 이력'); // 부분 저장 차단
            await h.db.query('DROP TRIGGER import_force_failure'); // 고유 DB fixture 정리
            check((await api('POST', route + '/imports/commit', { draft_token: rollback, validation_revision: rollbackReady.data.validation_revision }, cookie)).status === 200, '롤백 뒤 같은 초안 재시도'); // 실패 원본 유지
            if (!process.argv.includes('--write')) // 조회 단계 검증
            { // 조회 시나리오
                const listed = await api('GET', route + '/datasets?page=999', null, viewer.cookie); // 열람자 목록
                check(listed.status === 200 && listed.data.pagination.page === 1 && listed.data.datasets.length === 4, '저장 목록과 페이지 보정'); // 구현 전 실패
                const readId = pair[0].data.dataset_id; // 소수 표본
                const chart = await api('GET', route + '/datasets/' + readId + '/chart?category=c0&metric=sum&value=c1', null, viewer.cookie); // 정확 합계
                check(chart.status === 200 && chart.data.total === '0.3' && chart.data.groups.length === 2, '0.1과0.2의 정확 합계'); // 부동소수점 금지
                const rows = await api('GET', route + '/datasets/' + readId + '/rows?page=999', null, viewer.cookie); // 원본 표
                check(rows.status === 200 && rows.data.rows[0].values[1] === '0.1' && rows.data.pagination.page === 1, '원문 수치와 행 페이지'); // 문자열 보존
                check((await api('GET', route + '/datasets?q=%25', null, cookie)).data.datasets.length === 0, '검색 퍼센트 리터럴'); // 와일드카드 금지
                check((await api('GET', route + '/datasets?unknown=x', null, cookie)).status === 400, '불명 조회 필터 거부'); // 오타 검출
                check((await api('GET', route + '/datasets/' + readId, null, foreign.cookie)).status === 403, '타 작업실 조회 차단'); // 프로젝트 범위
                check((await api('GET', route + '/datasets/' + readId + '/chart?category=c1&metric=count', null, cookie)).status === 400, '숫자 범주 거부'); // 차트 계약
                check((await api('GET', route + '/datasets/' + readId + '/runs', null, cookie)).data.runs[0].status === 'success', '저장 성공 이력 조회'); // 검증부터 저장까지
                check((await api('POST', route + '/datasets/' + readId + '/delete', { confirm_name: '동시 자료', expected_version: 1 }, editor.cookie)).status === 403, '편집자 삭제 거부'); // 관리자 전용
                check((await api('POST', route + '/datasets/' + readId + '/delete', { confirm_name: '다른 이름', expected_version: 1 }, cookie)).status === 400, '삭제 이름 재확인'); // 잘못된 대상 방지
                check((await api('POST', route + '/datasets/' + readId + '/delete', { confirm_name: '동시 자료', expected_version: 2 }, cookie)).status === 409, '삭제 버전 충돌'); // 갱신 보호
                check((await api('POST', route + '/datasets/' + readId + '/delete', { confirm_name: '동시 자료', expected_version: 1 }, cookie)).status === 200, '관리자 삭제'); // 명시적 삭제
                const [[removed]] = await h.db.query('SELECT COUNT(*) AS n FROM import_rows WHERE dataset_id=?', [readId]); // FK 증거
                check(removed.n === 0 && (await api('GET', route + '/datasets/' + datasetId, null, cookie)).status === 200, '선택 행만 삭제와 다른 자료 보존'); // 삭제 범위
                const grouped = await newDraft('키,값\n,10\n미지정,10\n기타(묶음),10\n' + Array.from({ length: 22 }, (_, i) => 'C' + i + ',1').join('\n') + '\n빈 숫자,\n'); // 실제와 합성 이름
                const groupedColumns = columns.map((column) => ({ ...column, required: false })); // 선택 빈 셀
                const groupReady = await api('POST', route + '/imports/validate', { draft_token: grouped, mode: 'create', name: '범주%_자료', columns: groupedColumns, duplicate_policy: 'skip' }, cookie); // 전체 범주
                const groupSave = await api('POST', route + '/imports/commit', { draft_token: grouped, validation_revision: groupReady.data.validation_revision }, cookie); // 저장 집계 표본
                const groupChart = await api('GET', route + '/datasets/' + groupSave.data.dataset_id + '/chart?category=c0&metric=sum&value=c1', null, cookie); // 정확한 그룹 합
                check(groupChart.status === 200 && groupChart.data.groups.length === 20 && groupChart.data.total === '52' && groupChart.data.excluded === 1, '상위19와 기타·빈 숫자 제외·전체 합'); // 전체 보존
                check(groupChart.data.groups.some((g) => g.kind === 'null' && g.label === '미지정') && groupChart.data.groups.some((g) => g.kind === 'value' && g.label === '미지정') && groupChart.data.groups.some((g) => g.kind === 'value' && g.label === '기타(묶음)') && groupChart.data.groups.some((g) => g.kind === 'other'), '실제 범주와 합성 그룹 구분'); // 표시 충돌 방지
                check(groupChart.data.groups.reduce((sum, g) => sum + Number(g.amount), 0) === 52, '그룹 표시 합과 전체 합 일치'); // 정수 독립 기대값
                check((await api('GET', route + '/datasets?q=%25_', null, cookie)).data.datasets.length === 1, '퍼센트와 밑줄 문자 검색'); // 리터럴 검색 일치
                check((await api('GET', route + '/datasets/' + groupSave.data.dataset_id + '/rows?page[]=1', null, cookie)).status === 400, '배열 페이지 거부'); // 쿼리 주입 방지
                const padded = await newDraft('키,값\nA,0.1\nA ,0.2\n'); // 끝 공백 보존
                const paddedReady = await api('POST', route + '/imports/validate', { draft_token: padded, mode: 'create', name: '공백 범주', columns, duplicate_policy: 'skip' }, cookie); // 별개 문자 값
                const paddedSave = await api('POST', route + '/imports/commit', { draft_token: padded, validation_revision: paddedReady.data.validation_revision }, cookie); // 실제 원문 저장
                const paddedChart = await api('GET', route + '/datasets/' + paddedSave.data.dataset_id + '/chart?category=c0&metric=sum&value=c1', null, cookie); // 합계 경계
                check(paddedChart.data.groups.length === 2 && paddedChart.data.groups.find((g) => g.label === 'A').amount === '0.1' && paddedChart.data.groups.find((g) => g.label === 'A ').amount === '0.2' && paddedChart.data.total === '0.3', '끝 공백 범주별 정확 합계 분리'); // 검토 재현
                const paddedCount = await api('GET', route + '/datasets/' + paddedSave.data.dataset_id + '/chart?category=c0&metric=count', null, cookie); // 건수 경계
                check(paddedCount.data.groups.length === 2 && paddedCount.data.groups.every((g) => g.amount === '1') && paddedCount.data.total === '2', '끝 공백 범주별 건수 분리'); // 전체 건수 보존
                await h.db.query('UPDATE import_drafts SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE status<>?', ['consumed']); // 경합 fixture 공간
                const currentVersion = version + 1; const a = await newDraft('키,값\nA,7\n'); const b = await newDraft('키,값\nA,8\n'); // 같은 대상의 두 초안
                const validatedPair = await Promise.all([a, b].map((draft_token, index) => api('POST', route + '/imports/validate', { draft_token, mode: 'merge', target_dataset_id: datasetId, expected_version: currentVersion, columns: mapping, duplicate_policy: 'update' }, cookie, index))); // 동일 버전 검증
                const races = await Promise.all([a, b].map((draft_token, index) => api('POST', route + '/imports/commit', { draft_token, validation_revision: validatedPair[index].data.validation_revision }, cookie, index))); // 두 실제 서버 경합
                check(races.map((result) => result.status).sort().join() === '200,409', '동일 버전 두 초안 중 하나만 확정'); // 덮어쓰기 차단
                const corrupt = await newDraft('키,값\nA,9\n'); // 기존 해시 충돌 표본
                await h.db.query("UPDATE import_rows SET key_value='다른 원문' WHERE dataset_id=? AND key_value='A'", [datasetId]); // 분리 DB 손상 재현
                check((await api('POST', route + '/imports/validate', { draft_token: corrupt, mode: 'merge', target_dataset_id: datasetId, expected_version: currentVersion + 1, columns: mapping, duplicate_policy: 'update' }, cookie)).status === 409, '같은 해시의 다른 실제 키 차단'); // 잘못된 갱신 금지
                const [[beforeCleanup]] = await h.db.query('SELECT COUNT(*) AS n FROM import_drafts'); // CLI 전 원본
                const cliEnv = { ...process.env, DB_NAME: h.name }; const cli = 'apps/php-api/bin/cleanup-imports.php'; // 고유 DB 명령
                execFileSync('C:/xampp/php/php.exe', [cli], { cwd: h.root, env: cliEnv }); // 기본 dry-run
                const [[afterDry]] = await h.db.query('SELECT COUNT(*) AS n FROM import_drafts'); // 보존 확인
                check(beforeCleanup.n === afterDry.n, '초안 CLI 기본 dry-run 보존'); // 자동 삭제 금지
                await h.db.query('UPDATE import_drafts SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE status<>?', ['consumed']); // 만료 초안
                execFileSync('C:/xampp/php/php.exe', [cli, '--apply'], { cwd: h.root, env: cliEnv }); // 명시 적용
                const [[expiredLeft]] = await h.db.query('SELECT COUNT(*) AS n FROM import_drafts WHERE expires_at<=NOW()'); const [[historyLeft]] = await h.db.query('SELECT COUNT(*) AS n FROM import_runs'); // FK와 이력
                check(expiredLeft.n === 0 && historyLeft.n > 0, '만료 CLI 적용과 이력 보존'); // 독립 수명
                const guests = [cookie, editor.cookie]; // 세션 한도 경합
                const third = await api('POST', '/api/guest/join', { display_name: '한도 확인', invite_code: editInvite.data.code }); guests.push(third.cookie); // 세 번째 세션
                for (const who of guests) // 각 세션3개
                { // 한도 준비
                    for (let i = 0; i < 3; i++) // 최대 정상 초안
                    { // 실제 업로드
                        check((await api('POST', route + '/imports/upload', file('a\n1'), who)).status === 201, '작업실 한도 준비'); // 공개 API 경유
                    } // 실제 업로드 끝
                } // 한도 준비 끝
                const fourth = await api('POST', '/api/guest/join', { display_name: '동시 한도 확인', invite_code: editInvite.data.code }); // 다른 세션
                const quotaRace = await Promise.all([0, 1].map((index) => api('POST', route + '/imports/upload', file('a\n1'), fourth.cookie, index))); // 한 자리 두 요청
                check(quotaRace.map((result) => result.status).sort().join() === '201,429', '작업실10개 초안 동시 한도'); // 직렬화 증거
                await h.db.query('UPDATE user_sessions SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND)'); // 회원 세션 만료
                check((await api('GET', route + '/datasets', null, cookie)).status === 401, '회원 만료 후 저장 자료 접근 차단'); // 기존 인증 결합
            } // 조회 시나리오 끝
        } // 저장 시나리오 끝
        console.log('초안 가져오기 ' + passed + '개 통과'); // 실제 통과 수
    } // 시나리오 끝
    finally // 고유 자원 정리
    { // 정리 시작
        await h.close(); // 두 서버·DB만 제거
    } // 정리 끝
} // 실행 끝
main().catch((error) => // 최종 실패
{ // 오류 보고
    console.error('FAIL ' + error.stack); process.exitCode = 1; // 검증 실패 종료
}); // 오류 보고 끝
