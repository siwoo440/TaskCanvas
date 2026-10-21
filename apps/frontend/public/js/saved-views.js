'use strict'; // 엄격한 검사
window.SavedViews = (() => // 회원별 조회 설정
{ // 모듈 시작
    function mount(root, callbacks) // 화면 연결
    { // 연결 시작
        const find = (id) => root.querySelector('#saved-' + id); // 내부 요소
        let generation = 0; let active = null; let views = []; let applied = null; // 현재 요청과 조건
        const current = (token) => token === generation && active && active.userId === window.TC_MEMBER_USER?.user_id; // 계정과 요청 일치
        const selected = () => views.find((view) => String(view.view_id) === find('select').value); // 선택 설정
        function clearApplied() // 미확정 조건 차단
        { // 초기화 시작
            applied = null; find('save').disabled = true; // 이전 성공 조건 폐기
        } // 초기화 끝
        function setApplied(filters) // 성공 조건 보관
        { // 보관 시작
            applied = { ...filters }; find('save').disabled = false; // 서버 확정값만 저장
        } // 보관 끝
        function choose() // 선택 내용 표시
        { // 선택 시작
            const view = selected(); // 현재 항목
            find('name').value = view?.name ?? ''; find('default').checked = !!view?.is_default; // 이름과 기본값
            find('load').disabled = !view; find('delete').disabled = !view; // 기존 항목 조작
            find('confirm').value = ''; // 삭제 확인 초기화
        } // 선택 끝
        function render(id = 0) // 안전한 목록 표시
        { // 표시 시작
            find('select').replaceChildren(); // 이전 계정 목록 제거
            [{ view_id: 0, name: '새 조회 설정' }, ...views].forEach((view) => // 선택 항목
            { // 항목 생성
                const option = document.createElement('option'); option.value = String(view.view_id); option.textContent = view.name; // 이름 안전 출력
                find('select').append(option); // 목록 연결
            }); // 항목 끝
            find('select').value = String(id); choose(); // 선택 상태 복구
        } // 표시 끝
        function close() // 화면 이탈
        { // 닫기 시작
            generation += 1; active = null; views = []; clearApplied(); root.hidden = true; // 이전 응답 무효화
            find('select').replaceChildren(); find('message').textContent = ''; // 개인 정보 제거
            find('name').value = ''; find('confirm').value = ''; find('default').checked = false; // 이전 회원 입력 폐기
            find('load').disabled = true; find('delete').disabled = true; // 이전 대상 조작 차단
        } // 닫기 끝
        async function open(project) // 회원 설정 조회
        { // 열기 시작
            close(); // 이전 작업실 폐기
            if (!window.TC_MEMBER_USER) // 게스트 화면
            { // 회원 전용 제한
                return null; // 기본 조회 유지
            } // 제한 끝
            active = { projectId: project.projectId, userId: window.TC_MEMBER_USER.user_id }; const token = generation; // 요청 소유권
            root.hidden = false; find('message').textContent = '조회 설정을 불러오는 중입니다.'; // 로딩 안내
            try // 설정 조회
            { // 조회 시작
                const data = await window.api.get('/api/projects/' + active.projectId + '/analytics/views'); // 본인 설정
                if (!current(token)) // 이전 화면 응답
                { // 응답 무시
                    return null; // 신원 보호
                } // 무시 끝
                views = data.views; const preferred = views.find((view) => view.is_default); render(preferred?.view_id); // 기본 항목 선택
                find('message').textContent = ''; return preferred?.filters ?? null; // 기본 조건 적용
            } // 조회 끝
            catch (error) // 설정 조회 실패
            { // 실패 시작
                if (current(token)) // 현재 화면
                { // 안내 갱신
                    find('message').textContent = error.message || '조회 설정을 불러오지 못했습니다.'; // 오류 안내
                } // 안내 끝
                return null; // 기존 분석 조회 유지
            } // 실패 끝
        } // 열기 끝
        async function mutate(remove) // 저장과 삭제
        { // 변경 시작
            const view = selected(); const token = generation; // 변경 대상 고정
            if (!active || (!remove && !applied) || (remove && (!view || find('confirm').value !== view.name))) // 미확정 조건과 삭제 오입력
            { // 변경 차단
                find('message').textContent = '조회 성공 후 저장하거나, 삭제할 설정의 이름을 정확히 입력하세요.'; return; // 확인 안내
            } // 차단 끝
            const base = '/api/projects/' + active.projectId + '/analytics/views'; // 현재 작업실 경로
            find('save').disabled = true; find('delete').disabled = true; // 중복 변경 제한
            try // 변경 요청
            { // 요청 시작
                const body = remove ? { version: view.version } : { name: find('name').value, filters: { ...applied }, is_default: find('default').checked, ...(view ? { view_id: view.view_id, version: view.version } : {}) }; // 소유 버전과 확정 조건
                const data = await window.api.post(remove ? base + '/' + view.view_id + '/delete' : base, body); // 서버 검증
                if (!current(token)) // 이전 계정 응답
                { // 응답 폐기
                    return; // 현재 화면 유지
                } // 폐기 끝
                const list = await window.api.get(base); // 실제 최신 설정
                if (current(token)) // 현재 작업실
                { // 결과 표시
                    views = list.views; render(remove ? 0 : data.view.view_id); find('message').textContent = remove ? '설정을 삭제했습니다.' : '조회 설정을 저장했습니다.'; // 변경 안내
                } // 표시 끝
            } // 요청 끝
            catch (error) // 충돌과 권한 오류
            { // 오류 시작
                if (current(token)) // 현재 요청
                { // 실패 안내
                    find('message').textContent = error.message || '설정을 변경하지 못했습니다. 분석 화면을 다시 열어 확인하세요.'; // 재시도 안내
                } // 안내 끝
            } // 오류 끝
            finally // 버튼 복원
            { // 복원 시작
                if (current(token)) // 현재 화면
                { // 조작 복원
                    find('save').disabled = !applied; find('delete').disabled = !selected(); // 유효 조건 반영
                } // 복원 끝
            } // 복원 끝
        } // 변경 끝
        find('select').addEventListener('change', choose); // 선택 내용 갱신
        find('load').addEventListener('click', () => // 저장 조건 적용
        { // 적용 시작
            const view = selected(); // 선택 설정
            if (view) // 기존 설정
            { // 조회 연결
                return callbacks.onApply({ ...view.filters }); // 기존 분석 흐름
            } // 연결 끝
        }); // 적용 끝
        find('save').addEventListener('click', () => mutate(false)); // 조건 저장
        find('delete').addEventListener('click', () => mutate(true)); // 확인 후 삭제
        close(); return { open, close, setApplied, clearApplied }; // 공개 화면 계약
    } // 연결 끝
    return { mount }; // 공개 모듈
})(); // 모듈 끝
