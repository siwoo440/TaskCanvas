'use strict'; // 엄격한 검사
window.AnalyticsDashboard = (() => // 분석 조회 모듈
{ // 모듈 시작
    function mount(root, callbacks) // 한 화면의 수명 관리
    { // 화면 연결
        const find = (id) => root.querySelector('#analytics-' + id); // 내부 요소
        const charts = window.AnalyticsCharts.mount(root, { onStatus: (value) => applyChartFilter('status', value), onAssignee: (value) => applyChartFilter('assignee', value) }); // 차트 선택 연결
        const statusNames = { todo: '할 일', doing: '진행 중', done: '완료' }; // 상태 이름
        let generation = 0; // 응답 순서 보호
        let active = null; // 현재 작업실
        let used = {}; // 마지막 요청 조건
        let page = 1; // 실제 페이지
        let totalPages = 1; // 마지막 페이지
        const savedViews = window.SavedViews?.mount(root.querySelector('#saved-views'), { onApply: (filters) => load(filters, 1) }); // 개인 조건 연결
        function applyChartFilter(field, value) // 차트 드릴다운
        { // 필터 적용 시작
            find(field).value = value; // 선택 조건 반영
            return load({ ...used, [field === 'assignee' ? 'assignee_id' : 'status']: value }, 1); // 같은 기간의 상세 조회
        } // 필터 적용 끝
        function filterQuery(filters) // 서버 적용 조건 쿼리
        { // 쿼리 시작
            const params = new URLSearchParams(); // 안전한 인코딩
            Object.entries(filters).forEach(([key, value]) => // 모든 조건
            { // 조건 추가
                if (value !== null && value !== '') // 전체 조건 생략
                { // 실제 조건
                    params.set(key, String(value)); // 조건 인코딩
                } // 실제 조건 끝
            }); // 조건 추가 끝
            return params; // 완성 쿼리
        } // 쿼리 끝
        function clear() // 기존 숫자 폐기
        { // 초기화 시작
            savedViews?.clearApplied(); // 실패한 조회의 조건 저장 차단
            charts.destroy(); // 차트와 대체 표 해제
            find('kpis').replaceChildren(); find('rows').replaceChildren(); // 실제 데이터 폐기
            find('applied').textContent = ''; find('page').textContent = ''; // 조건과 페이지 폐기
            find('export').href = '#'; find('export').setAttribute('aria-disabled', 'true'); // 이전 CSV 링크 폐기
            find('results').hidden = true; // 오래된 결과 숨김
        } // 초기화 끝
        function busy(value) // 현재 요청의 조작 상태
        { // 상태 시작
            root.setAttribute('aria-busy', String(value)); // 접근성 로딩
            ['submit', 'refresh', 'prev', 'next'].forEach((id) => // 중복 조회 제한
            { // 버튼 상태
                find(id).disabled = value || (id === 'prev' && page <= 1) || (id === 'next' && page >= totalPages); // 페이지 경계
            }); // 버튼 상태 끝
        } // 상태 끝
        function close() // 인증과 화면 이탈
        { // 닫기 시작
            generation += 1; active = null; used = {}; page = 1; totalPages = 1; // 요청 무효화
            clear(); busy(false); // 화면과 로딩 초기화
            savedViews?.close(); // 이전 회원 설정 폐기
            ['from', 'to', 'status', 'assignee'].forEach((id) => find(id).value = ''); // 입력 초기화
            find('assignee').replaceChildren(); // 이전 담당자 제거
            find('message').textContent = ''; find('title').textContent = ''; // 신원 정보 폐기
        } // 닫기 끝
        function kpi(label, value, detail) // 읽기 쉬운 지표
        { // 카드 시작
            const card = document.createElement('article'); // 지표 카드
            const name = document.createElement('h2'); name.textContent = label; // 지표 이름
            const number = document.createElement('strong'); number.textContent = String(value); // 숫자
            const hint = document.createElement('p'); hint.textContent = detail; // 분모와 의미
            card.append(name, number, hint); find('kpis').append(card); // 안전 출력
        } // 카드 끝
        function option(value, label) // 담당자 선택지
        { // 선택지 생성
            const node = document.createElement('option'); node.value = value; node.textContent = label; // 이름 안전 출력
            find('assignee').append(node); // 목록 결합
        } // 선택지 끝
        function render(data) // 현재 응답 표시
        { // 표시 시작
            const stats = data.summary; // 공통 요약
            const percent = (value) => Number(value).toFixed(1) + '%'; // 소수 첫째 자리
            kpi('전체 업무', stats.tasks.total, '선택 조건에 해당하는 업무'); // 업무 수
            kpi('업무 완료율', percent(stats.tasks.completion_rate), stats.tasks.done + ' / ' + stats.tasks.total + '건 완료'); // 완료 비율
            kpi('마감 초과', stats.due.overdue, '서울 기준 오늘 이전 마감의 미완료 업무'); // 기한 경과
            kpi('체크리스트 완료율', percent(stats.checklist.completion_rate), stats.checklist.done + ' / ' + stats.checklist.total + '개 완료'); // 항목 비율
            find('from').value = data.filters.created_from; find('to').value = data.filters.created_to; // 서버 기본값 반영
            find('status').value = data.filters.status ?? ''; // 적용 상태
            find('assignee').replaceChildren(); option('', '전체 담당자'); option('unassigned', '미배정'); // 고정 선택
            data.assignee_options.forEach((row) => option(String(row.assignee_id), row.display_name + ' (#' + row.assignee_id + ')')); // ID별 선택지
            find('assignee').value = data.filters.assignee_id === null ? '' : String(data.filters.assignee_id); // 적용 담당자
            const person = data.filters.assignee_id === null ? '전체 담당자' : data.filters.assignee_id === 'unassigned' ? '미배정' : '담당자 #' + data.filters.assignee_id; // 실제 조건 설명
            find('applied').textContent = data.filters.created_from + ' ~ ' + data.filters.created_to + ' · ' + (statusNames[data.filters.status] ?? '전체 상태') + ' · ' + person + ' · 조회 ' + new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }); // 성공 조회 시각
            find('export').href = '/api/projects/' + data.project_id + '/analytics/export?' + filterQuery(data.filters); // 현재 조건 CSV
            find('export').setAttribute('aria-disabled', 'false'); // 성공한 현재 링크 활성
            data.rows.forEach((task) => // 현재 페이지
            { // 행 생성
                const row = document.createElement('tr'); // 업무 행
                const values = [task.title, statusNames[task.status] ?? '기타', task.assignee_id === null ? '미배정' : task.assignee_name + ' (#' + task.assignee_id + ')', task.due_at ?? '없음', task.created_at, task.checklist.done + '/' + task.checklist.total + ' (' + percent(task.checklist.completion_rate) + ')']; // 표시 필드
                values.forEach((value) => // 각 열
                { // 셀 생성
                    const cell = document.createElement('td'); cell.textContent = String(value); row.append(cell); // HTML 주입 방지
                }); // 셀 끝
                const boardCell = document.createElement('td'); // 원본 보드 셀
                if (task.board_id === null) // 연결 보드 없음
                { // 안내 출력
                    boardCell.textContent = '연결된 보드 없음'; // 삭제·미배치 안내
                } // 안내 끝
                else // 이동 가능한 보드
                { // 버튼 생성
                    const button = document.createElement('button'); button.type = 'button'; button.textContent = '보드 열기'; // 이동 버튼
                    button.addEventListener('click', async () => // 원본 이동
                    { // 이동 시작
                        const current = generation; // 이동 요청 소유권
                        button.disabled = true; // 반복 이동 제한
                        try // 최신 권한·보드 확인
                        { // 이동 확인
                            if (await callbacks.onOpenBoard(task.board_id) === false && current === generation) // 최신 목록에서 사라진 보드
                            { // 이동 실패
                                find('message').textContent = '원본 보드가 삭제되었거나 접근할 수 없습니다. 새로고침 후 다시 확인하세요.'; // 실패 안내
                            } // 이동 실패 끝
                        } // 이동 확인 끝
                        catch (error) // 삭제·권한·통신 실패
                        { // 실패 처리
                            if (current === generation) // 현재 화면만 갱신
                            { // 안내 출력
                                find('message').textContent = '원본 보드를 열지 못했습니다. 삭제 여부와 접근 권한을 확인하세요.'; // 이동 실패 안내
                            } // 안내 끝
                        } // 실패 처리 끝
                        finally // 이동 버튼 복원
                        { // 복원 시작
                            button.disabled = false; // 재시도 허용
                        } // 복원 끝
                    }); // 이동 끝
                    boardCell.append(button); // 버튼 결합
                } // 이동 버튼 끝
                row.append(boardCell); // 원본 열 추가
                find('rows').append(row); // 표에 결합
            }); // 행 끝
            page = data.pagination.page; totalPages = data.pagination.total_pages; // 실제 보정 페이지
            find('page').textContent = page + ' / ' + totalPages + '페이지 · 총 ' + data.pagination.total + '건'; // 페이지 안내
            find('results').hidden = false; charts.render(data); // 현재 결과 노출
            savedViews?.setApplied(data.filters); // 성공한 실제 조건만 보관
        } // 표시 끝
        async function load(filters, requestedPage = 1) // 현재 조건 조회
        { // 요청 시작
            if (!active) // 닫힌 화면
            { // 요청 차단
                return; // 새 요청 금지
            } // 요청 차단 끝
            const current = ++generation; const projectId = active.projectId; // 응답 소유권
            used = { ...filters }; clear(); busy(true); // 실패 재시도 조건과 로딩
            find('message').textContent = '업무 데이터를 불러오는 중입니다.'; // 로딩 안내
            const params = filterQuery(filters); // 안전한 공통 조건
            params.set('page', String(requestedPage)); // 페이지 지정
            try // HTTP 조회
            { // 응답 처리
                const data = await window.api.get('/api/projects/' + projectId + '/analytics/dashboard?' + params); // 기존 쿠키 인증
                if (current !== generation || !active || active.projectId !== projectId) // 이전 화면 응답
                { // 오래된 응답 무시
                    return; // 현재 화면 유지
                } // 무시 끝
                used = { ...data.filters }; render(data); // 확정 조건과 결과
                find('message').textContent = data.pagination.total ? '' : '조회 조건에 해당하는 업무가 없습니다.'; // 빈 결과
            } // 응답 처리 끝
            catch (error) // 입력과 서버 오류
            { // 오류 처리
                if (current !== generation || !active) // 이전 실패
                { // 실패 무시
                    return; // 현재 인증 보호
                } // 실패 무시 끝
                clear(); find('message').textContent = error.status ? error.message || '데이터를 불러오지 못했습니다. 새로고침으로 다시 조회하세요.' : '서버에 연결하지 못했습니다. 연결 상태를 확인하고 새로고침을 누르세요.'; // 이해 가능한 재시도 안내
                if ([401, 403, 404].includes(error.status)) // 현재 접근 상실
                { // 기존 인증 처리
                    close(); callbacks.onAccessLost(error); // 모든 결과 폐기
                } // 인증 처리 끝
            } // 오류 처리 끝
            finally // 현재 로딩만 종료
            { // 종료 처리
                if (current === generation) // 요청 소유권 유지
                { // 조작 복원
                    busy(false); // 페이지 경계 반영
                } // 조작 복원 끝
            } // 종료 처리 끝
        } // 요청 끝
        async function open(project) // 새 분석 화면
        { // 열기 시작
            close(); active = { ...project }; // 이전 신원 제거
            find('title').textContent = project.title + ' 분석'; // 현재 작업실
            const token = generation; const preferred = savedViews ? await savedViews.open(project) : null; // 회원 기본 조건 조회
            if (token !== generation || !active) // 설정 조회 중 화면 이탈
            { // 이전 요청 제외
                return; // 다른 화면 조회 방지
            } // 제외 끝
            return load(preferred ?? {}, 1); // 개인 기본값 또는 최근 30일
        } // 열기 끝
        find('form').addEventListener('submit', (event) => // 새 조건 적용
        { // 조회 동작
            event.preventDefault(); // 문서 이동 방지
            return load({ created_from: find('from').value, created_to: find('to').value, status: find('status').value, assignee_id: find('assignee').value }, 1); // 초안 적용
        }); // 조회 동작 끝
        find('refresh').addEventListener('click', () => load(used, page)); // 적용 조건 재시도
        find('export').addEventListener('click', (event) => // 키보드 다운로드 보호
        { // 링크 검사
            if (find('export').getAttribute('aria-disabled') === 'true') // 현재 결과 없음
            { // 다운로드 중단
                event.preventDefault(); // 비활성 링크 이동 차단
            } // 다운로드 중단 끝
        }); // 링크 검사 끝
        find('prev').addEventListener('click', () => load(used, page - 1)); // 이전 페이지
        find('next').addEventListener('click', () => load(used, page + 1)); // 다음 페이지
        find('back').addEventListener('click', () => // 작업실 복귀
        { // 복귀 동작
            close(); callbacks.onBack(); // 자원 해제 후 기존 흐름
        }); // 복귀 동작 끝
        return { open, close }; // 공개 화면 계약
    } // 화면 연결 끝
    return { mount }; // 공개 모듈
})(); // 모듈 끝
