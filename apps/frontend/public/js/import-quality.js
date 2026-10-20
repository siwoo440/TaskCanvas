'use strict'; // 엄격한 실행
window.ImportQualityView = (() => // 보고서 전용 화면
{ // 모듈 시작
    const { node, button, field, select, table, access } = window.ImportUI; // 안전한 공통 요소
    const types = [['required_missing', '필수 결측'], ['invalid_number', '숫자 오류'], ['invalid_date', '날짜 오류'], ['invalid_cell', '셀 자료형/길이'], ['invalid_row', '행 구조 오류'], ['optional_missing', '선택 결측'], ['duplicate_file', '파일 안 중복'], ['duplicate_existing', '기존 자료 중복']]; // 고정 분류
    const typeNames = Object.fromEntries(types); // 표시 이름
    function summary(root, data) // 원문 없는 품질 요약
    { // 요약 출력
        root.append(node('h3', '데이터 품질 요약'), node('p', '수신 ' + data.received + '행 · 정상 ' + data.valid_rows + '행 · 오류 행 ' + data.error_rows + ' · 오류 ' + data.error_count + '개 · 경고 행 ' + data.warning_rows + ' · 경고 ' + data.warning_count + '개')); // 행과 항목 구분
        root.append(node('p', '중복 행 ' + data.duplicate_rows + ' · 파일 안 ' + data.file_duplicate_rows + ' · 기존 자료 ' + data.existing_duplicate_rows + ' (서로 겹칠 수 있어 두 수치를 더하지 않습니다.)')); // 합집합 안내
        const columns = node('div'); table(columns, ['컬럼', '자료형', '결측', '결측률', '오류', '형식 오류'], data.columns.map((column) => [column.label, ({ text: '문자', number: '숫자', date: '날짜' })[column.type], column.missing_count, column.missing_rate + '%', column.error_count, column.invalid_count]), '컬럼별 데이터 품질'); root.append(columns); // 컬럼 집계
    } // 요약 끝
    function mount(root, callbacks) // 신원별 보고서 수명
    { // 화면 시작
        let active = null; let lifetime = 0; let rowGeneration = 0; let controls = {}; // 독립 요청 소유권
        function close() // 모든 보고서 자료 폐기
        { // 정리 시작
            active = null; lifetime++; rowGeneration++; controls = {}; root.replaceChildren(); root.hidden = true; // 늦은 응답 차단
        } // 정리 끝
        function path() // 현재 작업실·검사 식별자
        { // 경로 구성
            return '/api/projects/' + active.projectId + '/imports/runs/' + active.runId + '/quality'; // 토큰 없는 URL
        } // 경로 끝
        function fail(error) // 현재 요청 오류
        { // 실패 처리
            if (access(error)) // 인증·권한 상실
            { // 신원 정리
                close(); callbacks.onAccessLost(error); return; // 기존 앱 경계
            } // 신원 정리 끝
            controls.message.textContent = error.message || '품질 보고서를 읽지 못했습니다. 다시 조회하세요.'; // 없는 과거 보고서도 안내
        } // 실패 끝
        function clearRows() // 조건 변경 결과 폐기
        { // 행 정리
            rowGeneration++; controls.rows.replaceChildren(); controls.pager.replaceChildren(); controls.message.textContent = '문제 행 조회를 눌러 조건을 적용하세요.'; // 새 조건 필요
        } // 행 정리 끝
        async function loadRows(page = 1) // 작은 문제 행 페이지
        { // 조회 시작
            if (!active) // 닫힌 화면
            { // 요청 차단
                return; // 잘못된 조회 방지
            } // 요청 차단 끝
            const current = ++rowGeneration; const life = lifetime; const query = new URLSearchParams({ page: String(page) }); controls.rows.replaceChildren(); controls.pager.replaceChildren(); controls.message.textContent = '문제 행 조회 중…'; // 이전 행 제거
            [['severity', controls.severity], ['type', controls.type], ['column', controls.column]].forEach(([name, input]) => // 교집합 조건
            { // 조건 전송
                if (input.value) // 전체 선택 제외
                { // 쿼리 추가
                    query.set(name, input.value); // 안전한 URL 인코딩
                } // 쿼리 추가 끝
            }); // 조건 전송 끝
            try // HTTP 경계
            { // 실제 요청
                const data = await window.api.get(path() + '/rows?' + query); // 원문 없는 항목
                if (!active || life !== lifetime || current !== rowGeneration) // 이전 보고서/필터 응답
                { // 응답 폐기
                    return; // 새 화면 보호
                } // 응답 폐기 끝
                const values = data.rows.flatMap((row) => row.issues.map((issue) => [row.source_row, issue.severity === 'error' ? '오류' : '경고', typeNames[issue.type] || '행 구조', issue.field, issue.message])); // 조건에 맞는 항목만
                table(controls.rows, ['원본 행', '심각도', '유형', '컬럼', '사유'], values, '품질 문제 상세 · 문제 행20개 단위'); // 안전한 설명
                const p = data.pagination; const prev = button('이전', 'quality-prev', () => loadRows(p.page - 1)); const next = button('다음', 'quality-next', () => loadRows(p.page + 1)); prev.disabled = p.page <= 1; next.disabled = p.page >= p.total_pages; // 페이지 경계
                controls.pager.append(prev, node('span', p.page + ' / ' + p.total_pages + '페이지 · 총 ' + p.total + '개 문제 행'), next); controls.message.textContent = p.total ? '같은 행의 여러 문제는 함께 표시됩니다.' : '선택 조건에 해당하는 문제 행이 없습니다.'; // 행과 항목 단위 안내
            } // 실제 요청 끝
            catch (error) // 통신 또는 인증 오류
            { // 최신 요청만
                if (active && life === lifetime && current === rowGeneration) // 소유권 확인
                { // 오류 표시
                    fail(error); // 다시 조회 가능
                } // 오류 표시 끝
            } // 최신 요청 끝
        } // 조회 끝
        async function open(options) // 검사 당시 보고서 열기
        { // 초기화
            const next = { ...options }; close(); active = next; const life = lifetime; root.hidden = false; root.className = 'data-card quality-panel'; // 새 신원 수명
            root.append(node('h2', '데이터 품질 보고서 · 검사 당시 기록')); const actions = node('div'); actions.className = 'data-actions'; actions.append(button('보고서 닫기', 'quality-close', close), button('보고서 새로고침', 'quality-refresh', () => open(next))); root.append(actions); // 재조회·복귀
            const message = node('p', '품질 보고서 조회 중…', 'quality-message'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); root.append(message); controls.message = message; // 로딩·오류 상태
            try // 보고서 요청
            { // 상세 조회
                const data = await window.api.get(path()); // 현재 대상 스냅샷
                if (!active || life !== lifetime) // 옛 신원 응답
                { // 응답 폐기
                    return; // 원문 복원 금지
                } // 응답 폐기 끝
                const names = { invalid: '오류 발견', validated: '검증 완료·미확정', failed: '저장 실패·미확정', success: '저장 완료' }; // 과거 상태
                root.append(node('p', data.file_name + ' · 검사 ' + data.checked_at + ' · ' + (names[data.status] || data.status)), node('p', '당시 대상 버전 ' + (data.target_version ?? '신규') + ' · 키 ' + (data.key_column || '없음') + ' · 중복 ' + (data.duplicate_policy === 'update' ? '갱신' : '건너뛰기'))); // 파일·검사 조건
                summary(root, data.summary); // 요약·컬럼 통계
                const comparison = node('div'); const expected = data.expected; const actual = data.actual; // 확정과 예상 분리
                table(comparison, ['항목', '검사 예상', '실제 확정'], [['신규', expected.inserted, actual ? actual.inserted : '미확정'], ['갱신', expected.updated, actual ? actual.updated : '미확정'], ['건너뛰기', expected.skipped, actual ? actual.skipped : '미확정']], '저장 예상·실제 건수 대조'); root.append(comparison); // 실패를 성공으로 표시하지 않음
                root.append(node('p', '저장 전 ' + expected.before_rows + '행 · 저장 후 ' + (actual ? actual.after_rows + '행 · 확정 버전 ' + actual.version : '미확정') + (data.comparison ? ' · 예상/실제 ' + (data.comparison.counts_match && data.comparison.row_count_match ? '일치' : '불일치') : ''))); // 실제 DB행수 대조
                const form = node('form', '', 'quality-filter'); form.className = 'data-actions'; const severity = select('quality-severity', [['', '전체'], ['error', '오류'], ['warning', '경고']], ''); const type = select('quality-type', [['', '전체'], ...types], ''); const column = select('quality-column', [['', '전체'], ...data.schema.map((item) => [item.source_id, item.label]), ['__row__', '행 구조/중복']], ''); // 필터 선택
                field(form, '심각도', severity); field(form, '문제 유형', type); field(form, '문제 컬럼', column); const submit = node('button', '문제 행 조회'); submit.type = 'submit'; form.append(submit); // 명시적 조회
                form.addEventListener('submit', (event) => // 현재 조건 확정
                { // 필터 조회
                    event.preventDefault(); return loadRows(1); // 첫 페이지
                }); // 필터 조회 끝
                [severity, type, column].forEach((input) => input.addEventListener('change', clearRows)); const rows = node('div', '', 'quality-rows'); const pager = node('nav'); pager.className = 'data-actions'; root.append(form, rows, pager); controls = { message, severity, type, column, rows, pager }; // 현재 DOM만 보관
                return await loadRows(1); // 최초 전체 문제
            } // 상세 조회 끝
            catch (error) // 보고서 없음·접근 실패
            { // 현재 신원만
                if (active && life === lifetime) // 소유권 확인
                { // 오류 표시
                    fail(error); // 과거 보고서 없음 안내
                } // 오류 표시 끝
            } // 현재 신원 끝
        } // 초기화 끝
        close(); return { open, close }; // 명시적 화면 수명
    } // 화면 끝
    return { summary, mount }; // 공통 요약과 전용 뷰
})(); // 모듈 끝
