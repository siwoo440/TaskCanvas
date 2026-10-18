'use strict'; // 엄격한 문법 검사
(() => // 공통 계정 상태 범위
{ // 계정 상태 범위 시작
    const login = document.getElementById('member-login'); // 로그인 링크
    const account = document.getElementById('member-account'); // 회원 이름 영역
    const name = document.getElementById('member-name'); // 회원 이름 요소
    const logout = document.getElementById('member-logout'); // 로그아웃 버튼
    const retry = document.getElementById('member-retry'); // 재확인 버튼
    const message = document.getElementById('member-status-message'); // 상태 안내 요소
    let pending = false; // 요청 중복 방지 상태
    function showUser(user) // 회원 표시 갱신
    { // 회원 표시 범위 시작
        const previous = window.TC_MEMBER_USER; // 이전 계정 상태
        window.TC_MEMBER_USER = user; // 현재 계정 공유
        if (previous === undefined || (previous && previous.user_id) !== (user && user.user_id)) // 계정 식별 변경
        { // 상태 알림
            window.dispatchEvent(new CustomEvent('taskcanvas:member-change', { detail: { user, initial: previous === undefined } })); // 화면과 목록 동기화
        } // 알림 끝
        login.hidden = Boolean(user); // 로그인 링크 표시 상태
        account.hidden = !user; // 회원 영역 표시 상태
        logout.hidden = !user; // 로그아웃 표시 상태
        name.textContent = user ? user.display_name : ''; // 안전한 이름 출력
        name.title = user ? user.display_name : ''; // 긴 이름 전체 안내
    } // 회원 표시 범위 마침
    function setMessage(text, failed = false) // 상태 안내 갱신
    { // 상태 안내 범위 시작
        message.textContent = text; // 안내 문구 출력
        message.hidden = !text; // 빈 안내 숨김
        message.classList.toggle('member-status-error', failed); // 오류 색상 구분
    } // 상태 안내 범위 마침
    function clearPasswords() // 비밀번호 입력 정리
    { // 비밀번호 정리 범위 시작
        document.querySelectorAll('input[type="password"]').forEach((input) => // 비밀번호 입력 목록
        { // 입력별 정리 시작
            input.value = ''; // 비밀번호 값 제거
        }); // 입력별 정리 마침
    } // 비밀번호 정리 범위 마침
    async function refresh() // 서버 회원 상태 확인
    { // 회원 확인 범위 시작
        if (pending) // 확인 진행 여부
        { // 중복 확인 분기 시작
            return; // 중복 확인 차단
        } // 중복 확인 분기 마침
        pending = true; // 확인 진행 표시
        retry.disabled = true; // 재확인 중복 차단
        logout.disabled = true; // 확인 중 로그아웃 차단
        try // 회원 상태 요청
        { // 상태 요청 범위 시작
            const data = await window.api.get('/api/auth/me'); // 현재 회원 조회
            if (!data || !data.user || typeof data.user.display_name !== 'string') // 회원 응답 검사
            { // 응답 오류 분기 시작
                throw new Error('INVALID_USER'); // 잘못된 회원 응답 예외
            } // 응답 오류 분기 마침
            showUser(data.user); // 로그인 회원 표시
            retry.hidden = true; // 재확인 버튼 숨김
            setMessage(''); // 이전 상태 안내 정리
        } // 상태 요청 범위 마침
        catch (error) // 상태 요청 오류 처리
        { // 상태 오류 범위 시작
            if (error instanceof window.api.ApiError && error.status === 401) // 비로그인 응답 구분
            { // 비로그인 처리 시작
                showUser(null); // 비로그인 메뉴 표시
                retry.hidden = true; // 재확인 버튼 숨김
                setMessage(''); // 정상 비로그인 안내 정리
            } // 비로그인 처리 마침
            else // 확인 실패 처리
            { // 확인 실패 범위 시작
                retry.hidden = false; // 재확인 버튼 표시
                setMessage('계정 상태를 확인하지 못했습니다. 다시 확인해 주세요.', true); // 확인 실패 안내
            } // 확인 실패 범위 마침
        } // 상태 오류 범위 마침
        finally // 요청 상태 복구
        { // 상태 복구 범위 시작
            pending = false; // 확인 진행 해제
            retry.disabled = false; // 재확인 활성화
            logout.disabled = false; // 로그아웃 활성화
        } // 상태 복구 범위 마침
    } // 회원 확인 범위 마침
    logout.addEventListener('click', async () => // 회원 로그아웃 동작
    { // 로그아웃 범위 시작
        if (pending) // 요청 진행 여부
        { // 중복 요청 분기 시작
            return; // 중복 요청 차단
        } // 중복 요청 분기 마침
        pending = true; // 로그아웃 진행 표시
        logout.disabled = true; // 로그아웃 중복 차단
        retry.disabled = true; // 확인 중복 차단
        try // 로그아웃 요청
        { // 로그아웃 요청 범위 시작
            await window.api.post('/api/auth/logout'); // 빈 본문의 회원 세션 해제
            clearPasswords(); // 비밀번호 입력 정리
            showUser(null); // 비로그인 메뉴 표시
            retry.hidden = true; // 이전 재확인 숨김
            setMessage('로그아웃되었습니다.'); // 로그아웃 결과 안내
            login.focus(); // 로그인 링크로 초점 이동
        } // 로그아웃 요청 범위 마침
        catch (error) // 로그아웃 실패 처리
        { // 로그아웃 오류 범위 시작
            setMessage('로그아웃하지 못했습니다. 다시 시도해 주세요.', true); // 로그아웃 실패 안내
        } // 로그아웃 오류 범위 마침
        finally // 로그아웃 버튼 복구
        { // 로그아웃 복구 범위 시작
            pending = false; // 요청 진행 해제
            logout.disabled = false; // 로그아웃 활성화
            retry.disabled = false; // 재확인 활성화
        } // 로그아웃 복구 범위 마침
    }); // 로그아웃 이벤트 등록 마침
    retry.addEventListener('click', refresh); // 재확인 이벤트 등록
    window.addEventListener('focus', refresh); // 다른 창 복귀 시 계정 재확인
    document.addEventListener('visibilitychange', () => // 다른 탭 복귀 처리
    { // 탭 복귀 범위 시작
        if (document.visibilityState === 'visible') // 현재 탭 표시 여부
        { // 탭 재확인 분기 시작
            refresh(); // 보이는 탭 계정 재확인
        } // 탭 재확인 분기 마침
    }); // 탭 복귀 이벤트 등록 마침
    window.addEventListener('pageshow', (event) => // 뒤로 가기 복원 처리
    { // 화면 복원 범위 시작
        if (event.persisted) // 브라우저 캐시 복원 여부
        { // 캐시 복원 처리 시작
            clearPasswords(); // 복원 비밀번호 정리
            refresh(); // 최신 회원 상태 확인
        } // 캐시 복원 처리 마침
    }); // 화면 복원 이벤트 등록 마침
    refresh(); // 첫 회원 상태 확인
})(); // 공통 계정 상태 실행
