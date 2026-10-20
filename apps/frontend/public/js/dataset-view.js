'use strict'; // 엄격한 실행
window.DatasetView = { mount(root, callbacks) // 작업실 데이터 관리
{ // 화면 수명 시작
    const { node, button, field, select, table, access } = window.ImportUI; // 안전한 요소
    let active = null; let lifetime = 0; let listGeneration = 0; let detailGeneration = 0; let chartGeneration = 0; let runGeneration = 0; // 요청 소유권
    let controls = {}; let selected = null; let chart = null; let listPage = 1; let rowPage = 1; let runPage = 1; let search = ''; // 현재 조회
    const importRoot = node('section'); // 독립 초안 영역
    const importer = window.DataImport.mount(importRoot, // 같은 화면의 가져오기
    { // 가져오기 콜백
        onSaved: (result) => // DB 확정 결과
        { // 현재 자료 갱신
            if (!active) // 이탈한 화면
            { // 응답 폐기
                return; // 오래된 결과 무시
            } // 응답 폐기 끝
            controls.message.textContent = '저장 완료 · 신규 ' + result.inserted + ' · 갱신 ' + result.updated + ' · 건너뛰기 ' + result.skipped; // 실제 확정 건수
            loadList(listPage); choose(result.dataset_id); // DB 재조회
        }, // 저장 콜백 끝
        onAccessLost: (error) => fail(error), // 인증 전체 정리
    }); // 가져오기 연결 끝
    function destroyChart() // 외부 캔버스 정리
    { // 차트 정리
        if (chart) // 생성된 차트
        { // 자원 해제
            chart.destroy(); chart = null; // 이전 인스턴스 폐기
        } // 자원 해제 끝
    } // 차트 정리 끝
    function close() // 신원·작업실 수명 종료
    { // 정리 시작
        lifetime++; listGeneration++; detailGeneration++; chartGeneration++; runGeneration++; importer.close(); destroyChart(); // 모든 요청 무효
        active = null; selected = null; controls = {}; search = ''; listPage = 1; rowPage = 1; runPage = 1; root.replaceChildren(); // 자료 폐기
    } // 정리 끝
    function path() // 현재 작업실 API
    { // 경로 시작
        return '/api/projects/' + active.projectId; // 같은 출처 범위
    } // 경로 끝
    function fail(error) // 현재 요청 오류
    { // 실패 시작
        if (access(error)) // 인증 또는 권한 상실
        { // 신원 정리
            close(); callbacks.onAccessLost(error); return; // 앱 복귀
        } // 신원 정리 끝
        controls.message.textContent = error.message || '통신에 실패했습니다. 새로고침을 눌러 주세요.'; // 재시도 안내
    } // 실패 끝
    function pager(parent, pagination, move, prefix) // 공통 페이지
    { // 페이지 구성
        parent.replaceChildren(); const prev = button('이전', prefix + '-prev', () => move(pagination.page - 1)); const next = button('다음', prefix + '-next', () => move(pagination.page + 1)); // 이동 버튼
        prev.disabled = pagination.page <= 1; next.disabled = pagination.page >= pagination.total_pages; // 경계 제한
        parent.append(prev, node('span', pagination.page + ' / ' + pagination.total_pages + '페이지 · 총 ' + pagination.total + '건'), next); // 실제 보정 결과
    } // 페이지 끝
    async function loadList(page = 1) // 데이터셋 검색
    { // 목록 시작
        if (!active) // 닫힌 화면
        { // 요청 종료
            return; // 새 요청 금지
        } // 요청 종료 끝
        const current = ++listGeneration; const life = lifetime; controls.list.replaceChildren(); controls.listPage.replaceChildren(); // 이전 목록 폐기
        try // 목록 요청
        { // 요청 실행
            const query = new URLSearchParams({ page: String(page) }); // 정규 페이지
            if (search) // 검색어 입력
            { // 검색 반영
                query.set('q', search); // 문자 그대로 전송
            } // 검색 반영 끝
            const data = await window.api.get(path() + '/datasets?' + query); // 실제 DB 목록
            if (!active || life !== lifetime || current !== listGeneration) // 이전 작업실 요청
            { // 응답 폐기
                return; // 현재 목록 유지
            } // 응답 폐기 끝
            listPage = data.pagination.page; // 보정한 페이지
            if (!data.datasets.length) // 빈 목록
            { // 빈 상태
                controls.list.append(node('p', '저장된 데이터셋이 없습니다. CSV·JSON을 가져와 시작하세요.')); // 안내 문구
            } // 빈 상태 끝
            data.datasets.forEach((dataset) => // 선택 가능한 목록
            { // 자료 버튼
                const entry = button(dataset.name + ' · ' + dataset.row_count + '행 · v' + dataset.version, 'dataset-' + dataset.dataset_id, () => choose(dataset.dataset_id)); entry.className = 'dataset-entry'; controls.list.append(entry); // 안전한 자료명
            }); // 자료 버튼 끝
            pager(controls.listPage, data.pagination, loadList, 'dataset-list'); // 목록 이동
        } // 요청 실행 끝
        catch (error) // 목록 실패
        { // 최신 오류만
            if (active && life === lifetime && current === listGeneration) // 현재 소유권
            { // 오류 전달
                fail(error); // 사용자 안내
            } // 오류 전달 끝
        } // 최신 오류 끝
    } // 목록 끝
    async function loadRuns(page = 1, scope = selected ? selected.dataset_id : null) // 전체 또는 선택 이력
    { // 이력 시작
        if (!active) // 닫힌 화면
        { // 요청 차단
            return; // 종료
        } // 요청 차단 끝
        const current = ++runGeneration; const life = lifetime; const datasetId = scope; // 명시한 이력 범위
        controls.runs.replaceChildren(); controls.runPage.replaceChildren(); // 이전 이력 폐기
        try // 이력 조회
        { // 요청 시작
            const data = await window.api.get(path() + (datasetId ? '/datasets/' + datasetId + '/runs' : '/imports/runs') + '?page=' + page); // 서버 범위
            if (!active || life !== lifetime || current !== runGeneration) // 이전 자료 요청
            { // 응답 무시
                return; // 현재 결과 보호
            } // 응답 무시 끝
            runPage = data.pagination.page; // 실제 페이지
            const names = { validated: '검증 완료', invalid: '오류 발견', failed: '저장 실패', success: '저장 완료' }; // 상태 이름
            table(controls.runs, ['파일', '상태', '수신', '신규', '갱신', '건너뜀', '오류', '시각'], data.runs.map((run) => [run.file_name, names[run.status] || run.status, run.received, run.inserted, run.updated, run.skipped, run.error_count, run.created_at]), datasetId ? '선택 자료의 가져오기 이력' : '작업실 전체 가져오기 이력'); // 토큰 없는 기록
            pager(controls.runPage, data.pagination, (next) => loadRuns(next, datasetId), 'dataset-runs'); // 페이지 간 같은 범위
        } // 요청 끝
        catch (error) // 이력 실패
        { // 오류 검사
            if (active && life === lifetime && current === runGeneration) // 최신 요청
            { // 오류 전달
                fail(error); // 사용자 안내
            } // 오류 전달 끝
        } // 오류 검사 끝
    } // 이력 끝
    async function loadChart() // 선택한 기본 집계
    { // 차트 시작
        if (!active || !selected) // 자료 미선택
        { // 요청 차단
            return; // 조회 없음
        } // 요청 차단 끝
        const current = ++chartGeneration; const life = lifetime; const datasetId = selected.dataset_id; // 집계 소유권
        destroyChart(); controls.chartTable.replaceChildren(); controls.chartNote.textContent = '집계를 조회 중입니다…'; // 오래된 수치 폐기
        try // 집계 요청
        { // 요청 시작
            const metric = controls.metric.value; const query = new URLSearchParams({ category: controls.category.value, metric }); // 허용 선택
            if (metric === 'sum') // 숫자 합계
            { // 합계 필드
                query.set('value', controls.value.value); // 선택 컬럼
            } // 합계 필드 끝
            const data = await window.api.get(path() + '/datasets/' + datasetId + '/chart?' + query); // SQL 정확 집계
            if (!active || life !== lifetime || current !== chartGeneration || selected.dataset_id !== datasetId) // 이전 선택 요청
            { // 결과 폐기
                return; // 최신 그래프 유지
            } // 결과 폐기 끝
            const label = (group) => group.kind === 'null' ? '미지정 · 빈 값' : group.kind === 'other' ? '기타(묶음) · 나머지 범주' : group.label + ' · 실제 값'; // 실제와 합성 구분
            table(controls.chartTable, ['범주', metric === 'sum' ? '합계' : '행 수'], data.groups.map((group) => [label(group), group.amount]), '막대차트 데이터 · 정확한 수치'); // 차트 없는 환경도 조회
            controls.chartNote.textContent = '전체 ' + data.row_count + '행 · ' + (metric === 'sum' ? '합계 ' : '건수 ') + data.total + ' · 빈 숫자 제외 ' + data.excluded + '행'; // 원문 합계
            if (typeof window.Chart !== 'function') // 로컬 차트 파일 실패
            { // 대체 안내
                controls.chartNote.textContent += ' · 차트를 불러오지 못했습니다. 아래 표를 확인하세요.'; return; // 수치 보존
            } // 대체 안내 끝
            try // 외부 렌더 경계
            { // 차트 생성
                chart = new window.Chart(controls.canvas, { type: 'bar', data: { labels: data.groups.map(label), datasets: [{ label: metric === 'sum' ? '합계' : '행 수', data: data.groups.map((group) => Number(group.amount)), backgroundColor: '#377f70' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => data.groups[item.dataIndex].amount } } }, scales: { y: { beginAtZero: true } } } }); // 좌표만 숫자 변환
            } // 차트 생성 끝
            catch (error) // 캔버스 실패
            { // 표 유지
                destroyChart(); controls.chartNote.textContent += ' · 차트 표시 오류. 아래 표를 확인하세요.'; // 대체 표 안내
            } // 표 유지 끝
        } // 요청 끝
        catch (error) // 집계 실패
        { // 최신 오류만
            if (active && life === lifetime && current === chartGeneration) // 소유권 확인
            { // 오류 안내
                controls.chartNote.textContent = '집계 조회 실패'; fail(error); // 이전 수치 미표시
            } // 오류 안내 끝
        } // 최신 오류 끝
    } // 차트 끝
    async function choose(datasetId, page = 1) // 저장 자료와 행
    { // 상세 시작
        if (!active) // 화면 종료
        { // 요청 차단
            return; // 잘못된 선택 무시
        } // 요청 차단 끝
        const current = ++detailGeneration; const life = lifetime; chartGeneration++; runGeneration++; importer.close(); destroyChart(); selected = null; // 이전 자료 폐기
        controls.detail.hidden = true; controls.rows.replaceChildren(); controls.rowPage.replaceChildren(); controls.chartTable.replaceChildren(); controls.runs.replaceChildren(); // 민감 자료 정리
        try // 행 조회
        { // 요청 실행
            const data = await window.api.get(path() + '/datasets/' + datasetId + '/rows?page=' + page); // 같은 스냅샷 상세
            if (!active || life !== lifetime || current !== detailGeneration) // 응답 역전
            { // 이전 자료 폐기
                return; // 현재 선택 유지
            } // 이전 자료 폐기 끝
            selected = data.dataset; rowPage = data.pagination.page; controls.detail.hidden = false; // 성공 자료만 표시
            controls.detailTitle.textContent = selected.name; controls.meta.textContent = selected.row_count + '행 · v' + selected.version + ' · 키 ' + (selected.key_column ? selected.schema.find((column) => column.id === selected.key_column).label : '없음'); // 저장 상태
            table(controls.rows, ['저장 ID', '원본 행', ...selected.schema.map((column) => column.label)], data.rows.map((row) => [row.row_id, row.source_row, ...row.values]), '저장 데이터 · 페이지당 20행'); // 정확한 문자열
            pager(controls.rowPage, data.pagination, (next) => choose(datasetId, next), 'dataset-rows'); // 행 페이지
            controls.merge.hidden = active.role === 'viewer' || selected.key_column === null; controls.deleteBox.hidden = active.role !== 'admin'; controls.confirm.value = ''; // 역할별 조작
            const categories = selected.schema.filter((column) => column.type !== 'number'); const numbers = selected.schema.filter((column) => column.type === 'number'); // 허용 집계
            const category = select('dataset-category', categories.map((column) => [column.id, column.label]), categories[0]?.id || ''); const value = select('dataset-value', numbers.map((column) => [column.id, column.label]), numbers[0]?.id || ''); // 기본 선택
            const categoryValue = category.value; const numberValue = value.value; // 요소 이동 전 선택 보관
            controls.category.replaceChildren(...Array.from(category.children)); controls.category.value = categoryValue; controls.value.replaceChildren(...Array.from(value.children)); controls.value.value = numberValue; controls.metric.value = 'count'; controls.value.disabled = true; // 선택 초기화
            controls.chartControls.hidden = !categories.length; controls.chartNote.textContent = categories.length ? '' : '문자 또는 날짜 컬럼이 있어야 범주별 차트를 표시할 수 있습니다.'; // 숫자 전용 표
            if (categories.length) // 차트 가능한 스키마
            { // 자동 기본 집계
                loadChart(); // 건수 조회
            } // 자동 기본 집계 끝
            loadRuns(1); // 대상 이력
        } // 요청 실행 끝
        catch (error) // 자료 삭제 또는 통신 실패
        { // 현재 오류만
            if (active && life === lifetime && current === detailGeneration) // 소유권 확인
            { // 오류 전달
                fail(error); // 목록 재조회 안내
            } // 오류 전달 끝
        } // 현재 오류 끝
    } // 상세 끝
    function open(options) // 작업실 화면 진입
    { // 초기화 시작
        close(); active = { ...options }; root.className = 'data-management'; // 새 신원 수명
        const header = node('header'); header.className = 'data-heading'; const title = node('div'); title.append(node('p', '데이터 라이브러리'), node('h1', options.title + ' · 데이터 관리')); // 화면 제목
        const actions = node('div'); actions.className = 'data-actions'; actions.append(button('작업실로 돌아가기', 'dataset-back', callbacks.onBack), button('새로고침', 'dataset-refresh', () => // DB 현재 상태
        { // 재조회
            importer.close(); loadList(listPage); // 오래된 초안 폐기
            if (selected) // 선택 자료
            { // 선택 갱신
                choose(selected.dataset_id, rowPage); // 최신 version
            } // 선택 갱신 끝
        })); // 재조회 끝
        header.append(title, actions); root.append(header, node('p', '업무와 별도로 파일 데이터를 저장하고 범주별 건수·숫자 합계를 확인하세요.')); // 용도 안내
        const message = node('p', '', 'dataset-message'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); root.append(message); // 공통 상태
        const searchBox = node('form'); searchBox.className = 'data-actions'; const searchInput = node('input', '', 'dataset-search'); searchInput.maxLength = 120; field(searchBox, '데이터셋 이름 검색', searchInput); const submit = node('button', '검색'); submit.type = 'submit'; searchBox.append(submit); // 검색 입력
        searchBox.addEventListener('submit', (event) => // 검색 적용
        { // 검색 시작
            event.preventDefault(); search = searchInput.value; loadList(1); // 입력 확정
        }); // 검색 끝
        const create = button('CSV·JSON 가져오기', 'dataset-create', () => importer.open({ projectId: active.projectId, role: active.role, target: null })); create.hidden = options.role === 'viewer'; searchBox.append(create); root.append(searchBox); // 권한별 신규 가져오기
        const layout = node('div'); layout.className = 'data-layout'; const sidebar = node('section'); sidebar.className = 'data-card'; sidebar.append(node('h2', '저장 데이터셋')); const list = node('div'); const listPager = node('nav'); listPager.className = 'data-actions'; sidebar.append(list, listPager); // 목록 영역
        const detail = node('section'); detail.className = 'data-card'; detail.hidden = true; const detailTitle = node('h2'); const meta = node('p'); detail.append(detailTitle, meta); // 선택 자료
        const merge = button('이 자료에 재가져오기', 'dataset-merge', () => importer.open({ projectId: active.projectId, role: active.role, target: selected })); detail.append(merge); // 키 기반 갱신
        const rows = node('div'); const rowsPager = node('nav'); rowsPager.className = 'data-actions'; detail.append(rows, rowsPager); // 저장 표
        const chartControls = node('form'); chartControls.className = 'data-actions'; const category = select('dataset-category', []); const metric = select('dataset-metric', [['count', '행 수'], ['sum', '숫자 합계']], 'count'); const value = select('dataset-value', []); field(chartControls, '범주', category); field(chartControls, '집계 방식', metric); field(chartControls, '합계 값', value); // 집계 선택
        const chartSubmit = node('button', '차트 조회'); chartSubmit.type = 'submit'; chartControls.append(chartSubmit); chartControls.addEventListener('submit', (event) => // 집계 적용
        { // 집계 시작
            event.preventDefault(); loadChart(); // 현재 선택 조회
        }); // 집계 끝
        metric.addEventListener('change', () => // 합계 선택
        { // 선택 반영
            value.disabled = metric.value !== 'sum'; // 숫자 필드 활성
            chartGeneration++; destroyChart(); controls.chartTable.replaceChildren(); controls.chartNote.textContent = '차트 조회를 눌러 선택을 적용하세요.'; // 이전 결과 폐기
        }); // 선택 반영 끝
        [category, value].forEach((input) => input.addEventListener('change', () => // 집계 조건 변경
        { // 이전 집계 폐기
            chartGeneration++; destroyChart(); controls.chartTable.replaceChildren(); controls.chartNote.textContent = '차트 조회를 눌러 선택을 적용하세요.'; // 새 요청 필요
        })); // 조건 연결 끝
        const canvasFrame = node('div'); canvasFrame.className = 'data-chart-frame'; const canvas = node('canvas'); canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', '선택 범주의 막대차트. 정확한 수치는 아래 표 참고'); canvasFrame.append(canvas); const chartNote = node('p'); chartNote.setAttribute('role', 'status'); const chartTable = node('div'); detail.append(node('h3', '기본 막대차트'), chartControls, chartNote, canvasFrame, chartTable); // 차트와 접근 가능한 표
        const deleteBox = node('div'); const confirm = node('input', '', 'dataset-confirm'); field(deleteBox, '삭제 확인 · 데이터셋 이름을 정확히 입력', confirm); deleteBox.append(button('데이터셋 삭제', 'dataset-delete', async () => // 관리자 삭제
        { // 삭제 시작
            if (!active || !selected) // 선택 확인
            { // 삭제 차단
                return; // 잘못된 대상 방지
            } // 삭제 차단 끝
            const life = lifetime; const current = detailGeneration; const target = selected; // 삭제 소유권
            try // 서버 재확인
            { // 삭제 요청
                await window.api.post(path() + '/datasets/' + target.dataset_id + '/delete', { confirm_name: confirm.value, expected_version: target.version }); // 이름과 version
                if (active && life === lifetime && current === detailGeneration) // 현재 화면
                { // 선택 정리
                    selected = null; detailGeneration++; chartGeneration++; runGeneration++; destroyChart(); importer.close(); detail.hidden = true; rows.replaceChildren(); chartTable.replaceChildren(); controls.message.textContent = '데이터셋을 삭제했습니다.'; loadList(1); loadRuns(1); // 삭제 뒤 DB 목록
                } // 선택 정리 끝
            } // 삭제 요청 끝
            catch (error) // 삭제 충돌 또는 접근 실패
            { // 오류 소유권
                if (active && life === lifetime && current === detailGeneration) // 최신 요청
                { // 오류 전달
                    fail(error); // 재조회 안내
                } // 오류 전달 끝
            } // 오류 소유권 끝
        })); detail.append(deleteBox); layout.append(sidebar, detail); root.append(importRoot, layout); // 삭제 영역
        const history = node('section'); history.className = 'data-card'; const runs = node('div'); const runsPager = node('nav'); runsPager.className = 'data-actions'; history.append(node('h2', '가져오기 이력'), button('작업실 전체 이력', 'dataset-all-runs', () => // 전체 이력 선택
        { // 이력 범위 변경
            return loadRuns(1, null); // 전체 범위 유지
        }), runs, runsPager); root.append(history); // 이력 표
        controls = { message, list, listPage: listPager, detail, detailTitle, meta, merge, rows, rowPage: rowsPager, category, metric, value, chartControls, canvas, chartNote, chartTable, deleteBox, confirm, runs, runPage: runsPager }; // 현재 DOM
        return loadList(1); // 최초 저장 목록
    } // 초기화 끝
    return { open, close }; // 화면 인터페이스
} }; // 모듈 끝
