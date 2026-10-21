'use strict'; // 엄격한 검사
window.AnalyticsCharts = (() => // 차트 전용 모듈
{ // 모듈 시작
    function mount(root, callbacks = {}) // 화면별 차트 수명
    { // 연결 시작
        let charts = []; // 활성 인스턴스
        const find = (id) => root.querySelector('#analytics-' + id); // 분석 요소
        function destroy() // 캔버스 자원 반환
        { // 파기 시작
            charts.forEach((chart) => chart.destroy()); // 이전 차트 정리
            charts = []; // 참조 해제
            find('chart-tables').replaceChildren(); // 대체 표 정리
            find('chart-notice').textContent = ''; // 안내 정리
        } // 파기 끝
        function table(title, headings, rows) // 접근 가능한 데이터 표
        { // 표 시작
            const details = document.createElement('details'); // 접을 수 있는 표
            const label = document.createElement('summary'); // 표 제목
            label.textContent = title + ' 데이터 표'; // 접근 가능한 제목
            const grid = document.createElement('table'); // 숫자 표
            const head = document.createElement('thead'); // 표 머리
            const header = document.createElement('tr'); // 머리 행
            headings.forEach((text) => // 각 열
            { // 머리 셀
                const cell = document.createElement('th'); // 의미 있는 열
                cell.setAttribute('scope', 'col'); // 열 제목
                cell.textContent = text; header.append(cell); // 안전한 텍스트
            }); // 머리 셀 끝
            head.append(header); grid.append(head); // 머리 결합
            const body = document.createElement('tbody'); // 표 본문
            rows.forEach((values) => // 데이터 행
            { // 행 생성
                const row = document.createElement('tr'); // 새 행
                values.forEach((value) => // 셀 값
                { // 셀 생성
                    const cell = document.createElement('td'); // 숫자 셀
                    cell.textContent = String(value); row.append(cell); // 안전 출력
                }); // 셀 끝
                body.append(row); // 본문 추가
            }); // 행 끝
            grid.append(body); details.append(label, grid); // 표 결합
            find('chart-tables').append(details); // 화면 출력
        } // 표 끝
        function render(data) // 서버 값만 표시
        { // 렌더 시작
            destroy(); // 이전 자원 반환
            const tasks = data.summary.tasks; // 상태 집계
            const names = ['할 일', '진행 중', '완료', '기타']; // 고정 상태 이름
            const values = [tasks.todo, tasks.doing, tasks.done, tasks.other]; // 모든 상태
            const assignees = data.summary.assignees; // ID별 집계
            const labels = assignees.map((row) => row.assignee_id === null ? '미배정' : row.display_name + ' (#' + row.assignee_id + ')'); // 동명이인 구분
            table('업무 상태', ['상태', '업무 수'], names.map((name, i) => [name, values[i]])); // 상태 대체 표
            table('담당자별 업무', ['담당자', '전체', '완료'], assignees.map((row, i) => [labels[i], row.total, row.done])); // 막대 대체 표
            table('일별 업무 생성·상태 변경 수', ['날짜', '생성', '완료 전환', '진행 전환', '할 일 전환'], data.daily_created.map((row, index) => [row.date, row.count, data.status_trend[index]?.done ?? 0, data.status_trend[index]?.doing ?? 0, data.status_trend[index]?.todo ?? 0])); // 선 대체 표
            if (!tasks.total || !window.Chart) // 빈 값 또는 외부 파일 실패
            { // 대체 안내
                find('chart-notice').textContent = tasks.total ? '차트를 불러오지 못했습니다. 아래 데이터 표에서 수치를 확인하세요.' : '조회 조건에 해당하는 업무가 없습니다.'; // 정확한 상태
                return; // 임의 차트 조각 금지
            } // 대체 안내 끝
            const shared = { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'bottom' } } }; // 공통 차트 옵션
            find('assignee-frame').style.height = Math.max(260, assignees.length * 42) + 'px'; // 많은 담당자 스크롤
            try // 차트 엔진 오류 보호
            { // 차트 생성
                charts.push(new window.Chart(find('status-chart'), { type: 'doughnut', data: { labels: names, datasets: [{ data: values, backgroundColor: ['#94a3b8', '#3b82f6', '#10b981', '#f59e0b'] }] }, options: { ...shared, onClick: (_, points) => points[0] && points[0].index < 3 && callbacks.onStatus?.(['todo', 'doing', 'done'][points[0].index]) } })); // 지원 상태만 선택
                charts.push(new window.Chart(find('assignee-chart'), { type: 'bar', data: { labels, datasets: [{ label: '전체', data: assignees.map((row) => row.total), backgroundColor: '#3b82f6' }, { label: '완료', data: assignees.map((row) => row.done), backgroundColor: '#10b981' }] }, options: { ...shared, indexAxis: 'y', onClick: (_, points) => points[0] && callbacks.onAssignee?.(assignees[points[0].index].assignee_id ?? 'unassigned'), scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } } })); // 담당자별 업무량 선택
                charts.push(new window.Chart(find('daily-chart'), { type: 'line', data: { labels: data.daily_created.map((row) => row.date), datasets: [{ label: '생성 업무 수', data: data.daily_created.map((row) => row.count), borderColor: '#2563eb', backgroundColor: '#dbeafe', fill: false, pointRadius: data.daily_created.length > 60 ? 0 : 2 }, { label: '완료 전환', data: data.status_trend.map((row) => row.done), borderColor: '#10b981', fill: false, pointRadius: data.status_trend.length > 60 ? 0 : 2 }, { label: '진행 전환', data: data.status_trend.map((row) => row.doing), borderColor: '#8b5cf6', fill: false, pointRadius: data.status_trend.length > 60 ? 0 : 2 }, { label: '할 일 전환', data: data.status_trend.map((row) => row.todo), borderColor: '#64748b', fill: false, pointRadius: data.status_trend.length > 60 ? 0 : 2 }] }, options: { ...shared, scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { beginAtZero: true, ticks: { precision: 0 } } } } })); // 생성과 실제 상태 추이
            } // 차트 생성 끝
            catch (error) // 캔버스 또는 엔진 오류
            { // 대체 표시
                charts.forEach((chart) => chart.destroy()); charts = []; // 일부 생성도 정리
                find('chart-notice').textContent = '차트 표시 오류가 발생했습니다. 데이터 표에서 수치를 확인하세요.'; // 숫자 접근 유지
            } // 대체 표시 끝
        } // 렌더 끝
        return { render, destroy }; // 화면 수명 계약
    } // 연결 끝
    return { mount }; // 공개 인터페이스
})(); // 모듈 끝
