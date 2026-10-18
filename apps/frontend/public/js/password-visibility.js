'use strict'; // 엄격한 문법 검사
(() => // 비밀번호 일시 보기 범위
{ // 일시 보기 시작
    const buttons = document.querySelectorAll('[data-password-target]'); // 눈 버튼 목록
    const hideAll = () => // 모든 비밀번호 숨김
    { // 전체 숨김 시작
        for (const button of buttons) // 연결된 입력 순회
        { // 입력 숨김 시작
            document.getElementById(button.dataset.passwordTarget).type = 'password'; // 입력 마스킹 복구
            button.setAttribute('aria-pressed', 'false'); // 보기 상태 해제
        } // 입력 숨김 끝
    }; // 전체 숨김 끝
    for (const button of buttons) // 비밀번호별 눈 버튼 연결
    { // 버튼 연결 시작
        const input = document.getElementById(button.dataset.passwordTarget); // 이 버튼의 비밀번호 입력
        const reveal = () => // 현재 비밀번호 일시 표시
        { // 표시 시작
            hideAll(); // 다른 비밀번호 먼저 숨김
            input.type = 'text'; // 누르는 동안 원문 표시
            button.setAttribute('aria-pressed', 'true'); // 보조 기기의 보기 상태
        }; // 표시 끝
        button.addEventListener('pointerdown', (event) => // 마우스와 터치 누름
        { // 누름 처리 시작
            if (!event.isPrimary || event.button !== 0) // 왼쪽 버튼과 첫 터치만 허용
            { // 다른 입력 무시 시작
                return; // 보조 입력 제외
            } // 다른 입력 무시 끝
            button.setPointerCapture(event.pointerId); // 버튼 밖에서 놓아도 해제 감지
            reveal(); // 비밀번호 일시 표시
        }); // 누름 처리 끝
        for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) // 일시 표시 종료 조건
        { // 종료 조건 연결 시작
            button.addEventListener(eventName, hideAll); // 손을 떼거나 초점 이탈 시 숨김
        } // 종료 조건 연결 끝
        button.addEventListener('keydown', (event) => // 키보드 누름
        { // 키 누름 시작
            if (event.key === ' ' || event.key === 'Enter') // 키보드의 보기 동작
            { // 보기 키 처리 시작
                event.preventDefault(); // 스크롤과 양식 제출 차단
                reveal(); // 키를 누르는 동안 표시
            } // 보기 키 처리 끝
        }); // 키 누름 끝
        button.addEventListener('keyup', (event) => // 키보드 해제
        { // 키 해제 시작
            if (event.key === ' ' || event.key === 'Enter') // 보기 키를 놓는 순간
            { // 보기 해제 시작
                event.preventDefault(); // 기본 버튼 동작 차단
                hideAll(); // 즉시 마스킹 복구
            } // 보기 해제 끝
        }); // 키 해제 끝
    } // 버튼 연결 끝
    document.getElementById('member-auth-form').addEventListener('submit', hideAll, true); // 제출 전에 원문 숨김
    window.addEventListener('blur', hideAll); // 창 이탈 시 숨김
    window.addEventListener('pagehide', hideAll); // 페이지 이동 시 숨김
    window.addEventListener('pageshow', hideAll); // 뒤로 가기 복원 시 숨김
    document.addEventListener('visibilitychange', hideAll); // 탭 전환 시 숨김
    document.addEventListener('keydown', (event) => // 긴급 숨김 키
    { // 숨김 키 처리 시작
        if (event.key === 'Escape') // 취소 키 확인
        { // 취소 처리 시작
            hideAll(); // 원문 즉시 숨김
        } // 취소 처리 끝
    }); // 숨김 키 처리 끝
})(); // 비밀번호 일시 보기 실행
