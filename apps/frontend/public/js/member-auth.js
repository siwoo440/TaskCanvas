'use strict'; // 엄격한 문법 검사
(() => // 회원 입력 화면 범위
{ // 입력 화면 범위 시작
    const form = document.getElementById('member-auth-form'); // 회원 입력 양식
    const register = form.dataset.mode === 'register'; // 회원가입 화면 구분
    const loginId = document.getElementById('login-id'); // 로그인 아이디 입력
    const password = document.getElementById('password'); // 비밀번호 입력
    const displayName = document.getElementById('display-name'); // 표시 이름 입력
    const confirm = document.getElementById('password-confirm'); // 비밀번호 확인 입력
    const error = document.getElementById('auth-error'); // 오류 안내 요소
    const status = document.getElementById('auth-status'); // 진행 안내 요소
    const submit = document.getElementById('auth-submit'); // 제출 버튼
    let pending = false; // 제출 중복 방지 상태
    function fail(text, input) // 입력 오류 안내
    { // 입력 오류 범위 시작
        error.textContent = text; // 오류 문구 출력
        error.hidden = false; // 오류 안내 표시
        if (input) // 오류 입력 존재 여부
        { // 오류 입력 분기 시작
            input.setAttribute('aria-invalid', 'true'); // 오류 입력 표시
        } // 오류 입력 분기 마침
        (input || error).focus(); // 오류 위치 초점 이동
    } // 입력 오류 범위 마침
    function clearPasswords() // 비밀번호 입력 정리
    { // 비밀번호 정리 범위 시작
        password.value = ''; // 비밀번호 제거
        if (confirm) // 확인 입력 존재 여부
        { // 확인 입력 분기 시작
            confirm.value = ''; // 확인 비밀번호 제거
        } // 확인 입력 분기 마침
    } // 비밀번호 정리 범위 마침
    form.addEventListener('input', (event) => // 입력 수정 반영
    { // 입력 수정 범위 시작
        event.target.removeAttribute('aria-invalid'); // 수정 입력 오류 표시 해제
    }); // 입력 이벤트 등록 마침
    form.addEventListener('submit', async (event) => // 회원 입력 제출
    { // 제출 범위 시작
        event.preventDefault(); // 기본 페이지 제출 차단
        if (pending) // 제출 진행 여부
        { // 중복 제출 분기 시작
            return; // 제출 중복 차단
        } // 중복 제출 분기 마침
        error.textContent = ''; // 이전 오류 정리
        error.hidden = true; // 이전 오류 숨김
        form.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid')); // 이전 입력 표시 정리
        const normalizedId = loginId.value.trim().toLowerCase(); // 아이디 소문자 통일
        if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(normalizedId)) // 아이디 규칙 검사
        { // 아이디 검사 실패 범위
            fail('아이디는 영문·숫자로 시작하는 3~40자의 영문·숫자·마침표·밑줄·하이픈으로 입력해 주세요.', loginId); // 아이디 오류 안내
            return; // 제출 중단
        } // 아이디 검사 마침
        const payload = // 비밀번호 원문과 아이디 구성
        { // 제출 본문 시작
            login_id: normalizedId, // 소문자 아이디
            password: password.value, // 공백을 보존한 비밀번호
        }; // 제출 본문 마침
        if (register) // 회원가입 추가 검사
        { // 가입 검사 범위 시작
            const name = displayName.value.trim(); // 표시 이름 여백 정리
            if (Array.from(name).length < 1 || Array.from(name).length > 60) // 표시 이름 길이 검사
            { // 이름 오류 범위 시작
                fail('이름은 1~60자로 입력해 주세요.', displayName); // 이름 오류 안내
                return; // 제출 중단
            } // 이름 오류 범위 마침
            if (Array.from(password.value).length < 8 || new TextEncoder().encode(password.value).length > 72 || password.value.includes('\0')) // 비밀번호 길이와 문자 검사
            { // 비밀번호 오류 범위 시작
                fail('비밀번호는 8자 이상, UTF-8 기준 72바이트 이하로 입력해 주세요. 한글 등은 글자당 여러 바이트입니다.', password); // 비밀번호 규칙 안내
                return; // 제출 중단
            } // 비밀번호 오류 범위 마침
            if (password.value !== confirm.value) // 비밀번호 확인 검사
            { // 확인 오류 범위 시작
                fail('비밀번호가 일치하지 않습니다.', confirm); // 확인 오류 안내
                return; // 제출 중단
            } // 확인 오류 범위 마침
            payload.display_name = name; // 가입 이름 추가
            payload.password_confirm = confirm.value; // 확인 비밀번호 추가
        } // 가입 검사 범위 마침
        pending = true; // 제출 진행 표시
        submit.disabled = true; // 제출 버튼 비활성화
        form.setAttribute('aria-busy', 'true'); // 보조 기기 진행 안내
        status.textContent = register ? '회원가입 중…' : '로그인 중…'; // 진행 안내 출력
        status.hidden = false; // 진행 안내 표시
        try // 회원 요청 실행
        { // 회원 요청 범위 시작
            await window.api.post(register ? '/api/auth/register' : '/api/auth/login', payload); // 가입 또는 로그인 요청
            clearPasswords(); // 성공 비밀번호 정리
            window.location.assign(register ? '/login.html?registered=1' : '/'); // 고정된 성공 화면 이동
        } // 회원 요청 범위 마침
        catch (requestError) // 회원 요청 실패 처리
        { // 요청 실패 범위 시작
            status.textContent = ''; // 진행 안내 정리
            status.hidden = true; // 진행 안내 숨김
            const text = requestError instanceof window.api.ApiError ? requestError.message : '서버에 연결하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.'; // 서버 또는 연결 오류 구분
            fail(text); // 요청 오류 안내
        } // 요청 실패 범위 마침
        finally // 제출 상태 복구
        { // 제출 복구 범위 시작
            pending = false; // 진행 상태 해제
            submit.disabled = false; // 제출 버튼 활성화
            form.removeAttribute('aria-busy'); // 보조 기기 진행 표시 해제
        } // 제출 복구 범위 마침
    }); // 제출 이벤트 등록 마침
    window.addEventListener('pageshow', (event) => // 캐시 복원 입력 정리
    { // 복원 처리 범위 시작
        if (event.persisted) // 브라우저 캐시 복원 여부
        { // 비밀번호 복원 분기 시작
            clearPasswords(); // 복원 비밀번호 제거
        } // 비밀번호 복원 분기 마침
    }); // 복원 이벤트 등록 마침
    if (!register && new URLSearchParams(window.location.search).get('registered') === '1') // 가입 완료 경로 구분
    { // 가입 완료 안내 범위 시작
        status.textContent = '회원가입이 완료되었습니다. 새 계정으로 로그인해 주세요.'; // 가입 완료 안내
        status.hidden = false; // 완료 안내 표시
    } // 가입 완료 안내 범위 마침
})(); // 회원 입력 화면 실행
