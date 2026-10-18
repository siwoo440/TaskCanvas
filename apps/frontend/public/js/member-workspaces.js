'use strict'; // 엄격한 문법
(() => // 회원 작업실 화면 범위
{ // 화면 시작
    const panel = document.getElementById('member-workspaces'); // 관리 영역
    const list = document.getElementById('member-workspaces-list'); // 작업실 목록
    const message = document.getElementById('member-workspaces-message'); // 상태 안내
    const link = document.getElementById('member-link-guest'); // 게스트 연결 버튼
    const dialog = document.getElementById('member-link-dialog'); // 비밀번호 확인 창
    const password = document.getElementById('member-link-password'); // 임시 비밀번호
    let busy = false; // 변경 요청 중복 방지
    let generation = 0; // 오래된 조회 응답 차단
    async function refresh() // 본인 작업실 조회
    { // 조회 시작
        const current = ++generation; // 이번 조회 번호
        panel.hidden = !window.TC_MEMBER_USER; // 회원만 관리 표시
        list.replaceChildren(); // 이전 회원 목록 제거
        link.hidden = true; // 검증 전 연결 숨김
        message.textContent = ''; // 이전 안내 정리
        if (panel.hidden) // 비로그인 상태
        { // 조회 제외
            password.value = ''; // 입력 비밀 제거
            dialog.close(); // 이전 확인 창 닫기
            return; // 회원 조회 중단
        } // 비로그인 끝
        try // 서버 소유 확인
        { // 목록 요청
            const data = await window.api.get('/api/auth/workspaces'); // 회원 목록
            if (current !== generation) // 계정 변경 중 응답
            { // 오래된 결과
                return; // 이전 회원 정보 폐기
            } // 결과 검사 끝
            link.hidden = !data.can_link_guest; // 현재 게스트 연결 가능 여부
            message.textContent = data.projects.length ? '계정에 연결된 작업실을 선택하세요.' : '아직 연결된 작업실이 없습니다. 새로 만들거나 초대 코드로 참여하세요.'; // 빈 목록 안내
            for (const project of data.projects) // 검증된 목록
            { // 작업실 버튼
                const button = document.createElement('button'); // 안전한 버튼 생성
                button.type = 'button'; // 폼 제출 방지
                button.textContent = project.title + ' · ' + ({ admin: '관리자', editor: '편집자', viewer: '열람자' }[project.role] || project.role); // 안전한 이름과 역할
                button.addEventListener('click', () => change('/api/auth/workspaces/select', { project_id: project.project_id })); // 서버 선택
                list.appendChild(button); // 목록에 추가
            } // 버튼 생성 끝
        } // 목록 요청 끝
        catch (error) // 조회 오류
        { // 오류 안내
            if (current === generation) // 현재 계정의 결과
            { // 안내 표시
                message.textContent = error.message; // 서버 안내
            } // 안내 끝
        } // 오류 끝
    } // 조회 끝
    async function change(route, body) // 회원 작업실 변경
    { // 변경 시작
        if (busy) // 요청 진행 중
        { // 중복 방지
            return; // 중복 변경 생략
        } // 중복 검사 끝
        if (document.querySelector('dialog[open]') && !dialog.open) // 다른 확인 창
        { // 미완료 작업 보호
            message.textContent = '열려 있는 확인 창을 닫은 뒤 작업실을 선택하세요.'; // 전환 제한 안내
            return; // 다른 대화상자 보존
        } // 보호 끝
        busy = true; // 변경 상태
        const controls = [...panel.querySelectorAll('button'), ...dialog.querySelectorAll('button')]; // 중복 실행 제어
        controls.forEach((button) => // 진행 중 버튼 제어
        { // 개별 버튼
            button.disabled = true; // 중복 실행 차단
        }); // 버튼 제어 끝
        try // 변경 API
        { // 서버 처리
            const data = await window.api.post(route, body); // 역할과 소유 재검사
            password.value = ''; // 제출 비밀번호 제거
            dialog.close(); // 완료 창 닫기
            document.getElementById('member-invite-code').value = ''; // 사용한 코드 제거
            window.dispatchEvent(new CustomEvent('taskcanvas:workspace-selected', { detail: { projectId: data.project_id || null } })); // 기존 화면 재구성
            await refresh(); // 목록 갱신
        } // 변경 처리 끝
        catch (error) // 변경 실패
        { // 오류 표시
            password.value = ''; // 실패 입력도 제거
            (dialog.open ? document.getElementById('member-link-error') : message).textContent = error.message; // 현재 화면 안내
        } // 오류 끝
        finally // 상태 복구
        { // 복구 시작
            busy = false; // 변경 완료
            controls.forEach((button) => // 완료 후 버튼 복원
            { // 개별 버튼
                button.disabled = false; // 다음 작업 허용
            }); // 복원 끝
        } // 복구 끝
    } // 변경 끝
    link.addEventListener('click', () => // 명시적 게스트 연결
    { // 확인 창 열기
        password.value = ''; // 이전 입력 제거
        document.getElementById('member-link-error').textContent = ''; // 이전 오류 정리
        dialog.showModal(); // 연결 결과와 비밀번호 확인
        password.focus(); // 입력 초점
    }); // 열기 등록 끝
    dialog.addEventListener('close', () => // 닫기 입력 정리
    { // 입력 제거
        password.value = ''; // 비밀번호 폐기
    }); // 취소와 완료 비밀 정리
    document.getElementById('member-link-cancel').addEventListener('click', () => dialog.close()); // 연결 취소
    document.getElementById('member-link-form').addEventListener('submit', (event) => // 연결 제출
    { // 제출 처리
        event.preventDefault(); // 기본 폼 이동 방지
        change('/api/auth/guest-link', { password: password.value }); // 본인 비밀번호 재확인
    }); // 연결 등록 끝
    document.getElementById('member-invite-form').addEventListener('submit', (event) => // 회원 초대 참여
    { // 초대 제출
        event.preventDefault(); // 기본 이동 방지
        change('/api/auth/workspaces/join', { invite_code: document.getElementById('member-invite-code').value.trim() }); // 서버 초대 검사
    }); // 초대 등록 끝
    document.getElementById('member-create-workspace').addEventListener('click', () => document.getElementById('home-create-top').click()); // 기존 생성 화면 재사용
    window.addEventListener('taskcanvas:member-change', refresh); // 계정 변경 반영
    window.addEventListener('taskcanvas:workspace-refresh', refresh); // 작업실 생성·연결 반영
    window.addEventListener('focus', refresh); // 다른 탭 복귀 시 재조회
    window.addEventListener('pagehide', () => // 이탈 입력 정리
    { // 입력 제거
        password.value = ''; // 비밀번호 폐기
    }); // 화면 이탈 정리
    refresh(); // 첫 회원 목록
})(); // 회원 UI 실행
