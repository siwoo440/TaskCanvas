'use strict'; // 엄격한 실행
window.ImportUI = (() => // 안전한 공통 요소
{ // 도우미 시작
    function node(tag, text = '', id = '') // HTML 해석 없는 요소
    { // 요소 생성
        const element = document.createElement(tag); element.textContent = text; // 원문 출력
        if (id) // 식별자 지정
        { // ID 시작
            element.id = id; // 고유 요소
        } // ID 끝
        return element; // 생성 결과
    } // 요소 생성 끝
    function button(text, id, action) // 명시적 버튼
    { // 버튼 생성
        const element = node('button', text, id); element.type = 'button'; element.addEventListener('click', action); // 이벤트 연결
        return element; // 버튼 반환
    } // 버튼 생성 끝
    function field(parent, text, element) // 연결된 라벨
    { // 입력 생성
        const wrapper = node('div'); const label = node('label', text); label.htmlFor = element.id; wrapper.append(label, element); parent.append(wrapper); // 레이블과 입력
        return element; // 입력 반환
    } // 입력 생성 끝
    function select(id, choices, value = '') // 선택 요소
    { // 선택 생성
        const element = node('select', '', id); // 선택 상자
        choices.forEach(([key, label]) => // 선택지 추가
        { // 옵션 생성
            const option = node('option', label); option.value = key; element.append(option); // 안전한 이름
        }); // 옵션 끝
        element.value = value; return element; // 초기 선택
    } // 선택 생성 끝
    function table(parent, headers, rows, caption) // 스크롤 가능한 데이터 표
    { // 표 시작
        parent.replaceChildren(); const scroll = node('div'); scroll.className = 'data-table-scroll'; scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', caption); // 내부 스크롤
        const table = node('table'); table.append(node('caption', caption)); const head = node('thead'); const header = node('tr'); // 표 구조
        headers.forEach((text) => // 머리글
        { // 머리글 생성
            const cell = node('th', text); cell.scope = 'col'; header.append(cell); // 열 이름
        }); // 머리글 끝
        head.append(header); table.append(head); const body = node('tbody'); // 표 본문
        rows.forEach((values) => // 데이터 행
        { // 행 생성
            const row = node('tr'); values.forEach((value) => row.append(node('td', value === null ? '—' : String(value)))); body.append(row); // 셀 원문
        }); // 행 끝
        table.append(body); scroll.append(table); parent.append(scroll); // 표 출력
    } // 표 끝
    function access(error) // 인증 상실 판별
    { // 오류 검사
        return error.status === 401 || error.status === 403 || error.code === 'PROJECT_NOT_FOUND'; // 자료404와 구분
    } // 오류 검사 끝
    return { node, button, field, select, table, access }; // 공통 경계
})(); // 도우미 끝
window.DataImport = { mount(root, callbacks) // 세션 초안 화면
{ // 화면 생성
    const { node, button, field, select, table, access } = window.ImportUI; // 안전한 요소
    let active = null; let generation = 0; let sourceGeneration = 0; let draft = null; let revision = null; let mappings = []; let controls = {}; let saving = null; // 원본·검증별 소유권과 저장 잠금
    function invalidate(sourceChanged = false) // 설정별 검증 폐기
    { // 검증 폐기
        if (saving) // 확정 요청 진행
        { // 변경 차단
            return; // 같은 저장 식별자 유지
        } // 변경 차단 끝
        generation++; sourceGeneration += sourceChanged === true ? 1 : 0; revision = null; controls.commit.disabled = true; controls.report.replaceChildren(); // DOM 이벤트와 명시적 원본 변경 구분
    } // 검증 폐기 끝
    function close() // 신원과 화면 폐기
    { // 종료 시작
        generation++; sourceGeneration++; active = null; draft = null; revision = null; mappings = []; controls = {}; saving = null; root.replaceChildren(); root.hidden = true; // 원본·검증 응답과 파일·토큰 해제
    } // 종료 끝
    async function run(action, success, sourceRequest = false) // 요청 종류별 소유권 확인
    { // 요청 시작
        if (!active) // 닫힌 화면
        { // 요청 종료
            return; // 이전 버튼 무시
        } // 요청 종료 끝
        const current = ++generation; const currentSource = sourceGeneration; controls.message.textContent = '처리 중입니다…'; controls.commit.disabled = true; // 원본과 검증 요청 식별
        try // 네트워크 경계
        { // 요청 실행
            const data = await action(); // 실제 서버
            if (active && (sourceRequest ? sourceGeneration === currentSource : generation === current)) // 요청에 관련된 변경만 확인
            { // 최신 성공
                controls.message.textContent = ''; success(data); // 현재 결과 적용
            } // 최신 성공 끝
        } // 요청 실행 끝
        catch (error) // 서버와 통신 실패
        { // 실패 처리
            if (!active || (sourceRequest ? sourceGeneration !== currentSource : generation !== current)) // 닫힘·파일 변경·검증 조건 변경
            { // 응답 폐기
                return; // 신원 변경 금지
            } // 응답 폐기 끝
            if (access(error)) // 실제 접근 상실
            { // 인증 정리
                close(); callbacks.onAccessLost(error); return; // 전체 화면 통지
            } // 인증 정리 끝
            if (error.status === 410 || error.code === 'DRAFT_NOT_FOUND' || error.code === 'DRAFT_CORRUPT') // 만료·정리·손상 초안
            { // 원본 폐기
                draft = null; revision = null; mappings = []; controls.mapping.replaceChildren(); controls.preview.replaceChildren(); controls.report.replaceChildren(); controls.path.value = ''; controls.pathHint.textContent = ''; controls.pathBox.hidden = true; controls.validate.disabled = true; controls.repreview.disabled = true; // 원문과 재시도 조건 폐기
            } // 원본 폐기 끝
            if (error.status === 409 || error.status === 422) // 검증 또는 버전 변경
            { // 재검증 필요
                revision = null; // 이전 저장 불가
            } // 재검증 필요 끝
            controls.message.textContent = error.message || '통신에 실패했습니다. 같은 저장을 다시 시도할 수 있습니다.'; controls.commit.disabled = revision === null; // 응답 유실 재시도
        } // 실패 처리 끝
    } // 요청 끝
    function path() // 현재 작업실 경로
    { // 경로 시작
        return '/api/projects/' + active.projectId + '/imports/'; // 같은 출처 API
    } // 경로 끝
    function refreshKeys() // 포함 컬럼의 식별자
    { // 선택 재구성
        const previous = controls.key.value; const choices = [['', '키 없음 · 신규 저장만 가능']]; // 기본 선택
        mappings.filter((mapping) => mapping.type.value !== 'exclude').forEach((mapping) => choices.push([mapping.source.source_id, mapping.label.value])); // 현재 포함 순서
        const next = select('import-key', choices, choices.some(([key]) => key === previous) ? previous : ''); // 현재 선택 유지
        const nextValue = next.value; controls.key.replaceChildren(...Array.from(next.children)); controls.key.value = nextValue; // 이동 전 선택 유지
    } // 선택 재구성 끝
    function showSource(data) // 원본 미리보기와 매핑
    { // 원본 출력
        draft = { ...draft, ...data }; revision = null; controls.commit.disabled = true; controls.mapping.replaceChildren(); mappings = []; // 토큰 유지와 새 원본 상태
        controls.preview.replaceChildren(); controls.report.replaceChildren(); // 이전 결과 폐기
        controls.path.value = data.json_path || controls.path.value; controls.pathBox.hidden = data.format !== 'json' && !data.requires_path; // JSON 경로만
        controls.pathHint.textContent = data.paths.length ? '배열 경로: ' + data.paths.map((item) => typeof item === 'string' ? item : item.path).join(', ') : '루트 배열은 경로를 비워 두세요.'; // 후보와 직접 입력
        controls.message.textContent = data.requires_path ? 'JSON 배열 경로를 입력하고 원본 다시 읽기를 누르세요.' : '원본 ' + data.row_count + '행 · 첫 20행 미리보기'; // 전체 행 수
        controls.validate.disabled = data.requires_path; controls.repreview.disabled = false; // 단계 제어
        table(controls.preview, ['원본 행', ...data.columns.map((column) => column.label)], data.rows.map((row) => [row.source_row, ...row.values]), '원본 미리보기 · 첫 20행'); // 실제 원본
        const fixed = active.target ? active.target.schema : data.columns; // 기존 스키마 또는 원본
        fixed.forEach((source, index) => // 매핑 구성
        { // 필드 행
            const row = node('div'); row.className = 'import-column'; const prefix = 'import-column-' + index; // 필드 그룹
            if (active.target) // 고정 스키마 재연결
            { // 기존 필드
                row.append(node('strong', source.label + ' · ' + source.type + (source.required ? ' · 필수' : ''))); // 스키마 읽기 전용
                const match = data.columns.find((column) => column.label === source.label) || data.columns[index]; // 이름 우선 제안
                const input = select(prefix, data.columns.map((column) => [column.source_id, column.label]), match ? match.source_id : ''); field(row, '원본 컬럼', input); input.addEventListener('change', invalidate); mappings.push({ id: source.id, input }); // 서버가 중복 재검사
            } // 기존 필드 끝
            else // 신규 필드
            { // 자유 매핑
                const label = node('input', '', prefix + '-label'); label.value = source.label; label.maxLength = 120; field(row, '컬럼 이름 · ' + source.label, label); // 출력 이름
                const type = select(prefix + '-type', [['text', '문자'], ['number', '숫자'], ['date', '날짜'], ['exclude', '제외']], 'text'); field(row, '자료형', type); // 명시 타입
                const required = node('input', '', prefix + '-required'); required.type = 'checkbox'; field(row, '필수 값', required); // 필수 여부
                mappings.push({ source, label, type, required }); // 매핑만 보관
                [label, type, required].forEach((input) => input.addEventListener(input === label ? 'input' : 'change', () => // 조건 변경
                { // 새 검증 필요
                    invalidate(); refreshKeys(); // 이전 revision 폐기
                })); // 변경 연결 끝
            } // 자유 매핑 끝
            controls.mapping.append(row); // 필드 출력
        }); // 매핑 구성 끝
        if (!active.target) // 신규 키 갱신
        { // 키 구성
            refreshKeys(); // 포함 컬럼 선택
        } // 키 구성 끝
    } // 원본 출력 끝
    function configuration() // 서버 검증 입력
    { // 설정 시작
        const common = { draft_token: draft.draft_token, mode: active.target ? 'merge' : 'create', duplicate_policy: controls.policy.value }; // 초안 식별자
        if (active.target) // 기존 자료
        { // 고정 매핑
            return { ...common, target_dataset_id: active.target.dataset_id, expected_version: active.target.version, columns: mappings.map((mapping) => ({ id: mapping.id, source_id: mapping.input.value })) }; // 기존 버전
        } // 고정 매핑 끝
        const included = mappings.filter((mapping) => mapping.type.value !== 'exclude'); const keyIndex = included.findIndex((mapping) => mapping.source.source_id === controls.key.value); // 포함 순서
        return { ...common, name: controls.name.value, columns: included.map((mapping) => ({ source_id: mapping.source.source_id, label: mapping.label.value, type: mapping.type.value, required: mapping.required.checked })), key_column: keyIndex < 0 ? null : 'c' + keyIndex }; // 타입과 키
    } // 설정 끝
    function open(options) // 새 가져오기 시작
    { // 초기 화면
        if (saving) // 같은 화면의 중복 시작
        { // 새 초안 차단
            return; // 진행 중 저장 유지
        } // 새 초안 차단 끝
        close(); active = { ...options }; root.hidden = options.role === 'viewer'; // 신원별 새 수명
        if (options.role === 'viewer') // 읽기 권한
        { // 쓰기 차단
            return; // UI 쓰기 없음
        } // 쓰기 차단 끝
        root.className = 'data-card import-panel'; root.append(node('h2', options.target ? '기존 데이터셋 재가져오기' : 'CSV·JSON 가져오기')); // 단계 제목
        root.append(node('p', '파일 선택 → 원본 확인 → 컬럼 지정 → 전체 검증 → 저장. 최대 5MiB·10,000행·50열. 초안은 15분 뒤 만료됩니다.')); // 사용 흐름
        const file = node('input', '', 'import-file'); file.type = 'file'; file.accept = '.csv,.json'; field(root, 'CSV 또는 JSON 파일', file); // 실제 파일
        const encoding = select('import-encoding', [['UTF-8', 'UTF-8 / BOM'], ['CP949', 'CP949 · CSV 전용']], 'UTF-8'); field(root, 'CSV 문자 인코딩', encoding); // 인코딩 선택
        const pathBox = node('div'); const jsonPath = node('input', '', 'import-path'); jsonPath.placeholder = '/data/items'; field(pathBox, 'JSON 배열 경로 · JSON Pointer', jsonPath); const pathHint = node('p'); pathBox.append(pathHint); root.append(pathBox); pathBox.hidden = true; // 경로 입력
        const name = node('input', '', 'import-name'); name.maxLength = 120; name.value = options.target ? options.target.name : '가져온 데이터'; name.disabled = !!options.target; field(root, '데이터셋 이름', name); // 자료 이름
        const key = select('import-key', [['', '키 없음 · 신규 저장만 가능']], ''); const keyBox = node('div'); field(keyBox, '행을 식별할 키 컬럼 · 선택 시 필수 값', key); root.append(keyBox); keyBox.hidden = !!options.target; // 키 선택
        const policy = select('import-policy', [['skip', '중복 건너뛰기 · 첫 행 유지'], ['update', '중복 갱신 · 마지막 행 적용']], 'skip'); field(root, '중복 처리', policy); // 정책
        const message = node('p', '', 'import-message'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); const preview = node('div'); const mapping = node('div'); const report = node('div'); // 결과 영역
        const actions = node('div'); actions.className = 'data-actions'; // 단계 버튼
        const upload = button('1. 파일 업로드', 'import-upload', async () => // 원본 업로드
        { // 업로드 시작
            if (saving) // 확정 중 원본 교체
            { // 교체 차단
                return; // 저장 완료 대기
            } // 교체 차단 끝
            if (!file.files || !file.files[0]) // 파일 미선택
            { // 선택 안내
                message.textContent = '파일을 먼저 선택하세요.'; file.focus(); return; // 사용자 수정
            } // 선택 안내 끝
            draft = null; invalidate(true); mapping.replaceChildren(); preview.replaceChildren(); jsonPath.value = ''; pathHint.textContent = ''; pathBox.hidden = true; controls.validate.disabled = true; controls.repreview.disabled = true; // 이전 초안과 경로 폐기
            const form = new FormData(); form.append('file', file.files[0]); form.append('encoding', encoding.value); // 브라우저 multipart
            return run(() => window.api.multipart(path() + 'upload', form), showSource, true); // 원본 요청 전용 소유권
        }); // 업로드 끝
        const repreview = button('원본 다시 읽기', 'import-repreview', () => // 경로·인코딩 반영
        { // 재해석 시작
            if (!draft || saving) // 초안과 현재 단계 필요
            { // 요청 종료
                return; // 선택 전 무시
            } // 요청 종료 끝
            invalidate(true); return run(() => window.api.post(path() + 'preview', { draft_token: draft.draft_token, encoding: encoding.value, json_path: jsonPath.value }), showSource, true); // 원본 재해석 전용 소유권
        }); // 재해석 끝
        const validate = button('2. 전체 행 검증', 'import-validate', () => // 모든 행 검증
        { // 검증 시작
            if (!draft || saving) // 초안과 현재 단계 필요
            { // 요청 종료
                return; // 잘못된 단계 차단
            } // 요청 종료 끝
            revision = null; return run(() => window.api.post(path() + 'validate', configuration()), (data) => // 최신 서버 보고서
            { // 보고서 출력
                revision = data.report.can_commit ? data.validation_revision : null; commit.disabled = revision === null; report.replaceChildren(); // 서버 허용만 저장
                report.append(node('h3', '전체 검증 결과'), node('p', '수신 ' + data.report.received + '행 · 신규 ' + data.report.inserted + ' · 갱신 ' + data.report.updated + ' · 건너뛰기 ' + data.report.skipped + ' · 오류 ' + data.report.error_count + '개')); // 전체 집계
                const normalized = node('div'); table(normalized, ['원본 행', ...data.schema.map((column) => column.label)], data.rows.map((row) => [row.source_row, ...row.values]), '정규화 미리보기 · 첫 20행'); report.append(normalized); // 실제 변환 결과
                const errors = node('ul'); data.report.errors.forEach((error) => errors.append(node('li', error.source_row + '행 · ' + error.field + ' · ' + error.message))); report.append(errors); // 오류 위치 최대100
                if (data.report.error_count > data.report.errors.length) // 전체 오류보다 짧은 목록
                { // 표시 한도 안내
                    report.append(node('p', '전체 ' + data.report.error_count + '개 중 첫 ' + data.report.errors.length + '개 오류 표시')); // 누락된 위치의 이유
                } // 표시 한도 안내 끝
                message.textContent = revision === null ? '오류를 수정한 파일을 다시 업로드하세요. 오류가 있는 자료는 저장되지 않습니다.' : '전체 검증을 통과했습니다. 저장을 누르면 DB에 반영됩니다.'; // 단계 안내
            }); // 보고서 출력 끝
        }); // 검증 끝
        const commit = button('3. DB에 저장', 'import-commit', () => // 확정 저장
        { // 저장 시작
            if (!draft || revision === null || saving) // 검증 없는 중복 저장
            { // 요청 종료
                return; // 이전 검증 차단
            } // 요청 종료 끝
            const request = { draft_token: draft.draft_token, validation_revision: revision }; // 확정 요청 고정
            const fields = [...controls.inputs, ...mappings.flatMap((mapping) => mapping.input ? [mapping.input] : [mapping.label, mapping.type, mapping.required])]; // 충돌 가능한 모든 조작
            const lock = fields.map((input) => [input, input.disabled]); saving = lock; fields.forEach((input) => input.disabled = true); // 처리 중 편집 잠금
            return run(() => window.api.post(path() + 'commit', request), (result) => // 동일 식별자의 멱등 API
            { // 확정 성공
                const notify = callbacks.onSaved; close(); notify(result); // 원문 폐기 후 현재 자료 조회
            }).finally(() => // 현재 저장의 잠금만 해제
            { // 처리 후 복구
                if (saving !== lock) // 닫힌 화면 또는 새 수명
                { // 이전 잠금 무시
                    return; // 현재 화면 영향 금지
                } // 이전 잠금 무시 끝
                saving = null; lock.forEach(([input, disabled]) => input.disabled = disabled); // 이전 상태 복구
                commit.disabled = revision === null; validate.disabled = !draft || draft.requires_path; repreview.disabled = !draft; // 오류 후 단계 반영
            }); // 처리 후 복구 끝
        }); // 저장 끝
        const dismiss = button('가져오기 닫기', 'import-close', close); actions.append(upload, repreview, validate, commit, dismiss); root.append(actions, message, preview, mapping, report); // 화면 구성
        controls = { name, key, policy, path: jsonPath, pathBox, pathHint, message, preview, mapping, report, commit, validate, repreview, inputs: [file, encoding, jsonPath, name, key, policy, upload, repreview, validate, commit, dismiss] }; // 현재 요소와 저장 잠금 대상
        repreview.disabled = true; validate.disabled = true; commit.disabled = true; // 순차 단계
        [name, key, policy, encoding, jsonPath, file].forEach((input) => input.addEventListener(input === name || input === jsonPath ? 'input' : 'change', () => // 입력 변경
        { // 검증 무효화
            invalidate(input === file || input === encoding || input === jsonPath); // 원본 조건과 매핑 변경 구분
            if (input === file) // 다른 실제 파일 선택
            { // 이전 원본 폐기
                draft = null; mappings = []; mapping.replaceChildren(); preview.replaceChildren(); jsonPath.value = ''; pathHint.textContent = ''; pathBox.hidden = true; repreview.disabled = true; // 이전 토큰과 JSON 경로 폐기
            } // 이전 원본 폐기 끝
            if (input === file || input === encoding || input === jsonPath) // 원본 해석 변경
            { // 재해석 필요
                validate.disabled = true; message.textContent = input === file ? '파일 업로드를 다시 눌러 주세요.' : '원본 다시 읽기를 눌러 주세요.'; // 필요한 단계 안내
            } // 재해석 필요 끝
        })); // 입력 연결 끝
        file.focus(); // 첫 입력 접근
    } // 초기 화면 끝
    return { open, close }; // 수명 인터페이스
} }; // 화면 끝
