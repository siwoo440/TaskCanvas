'use strict'; // 엄격한 검사
window.MemberManagement = (() => // 회원 관리자 화면
{ // 모듈 시작
    function mount(root, callbacks) // 화면 수명 연결
    { // 연결 시작
        const find = (id) => root.querySelector('#manage-' + id); // 내부 요소
        const roles = { admin: '관리자', editor: '편집자', viewer: '열람자' }; // 역할 이름
        let generation = 0; let project = null; let uid = null; let busy = false; // 현재 권한과 요청
        const current = (token) => token === generation && uid === window.TC_MEMBER_USER?.user_id; // 계정 변경 보호
        function close() // 이전 권한 폐기
        { // 닫기 시작
            generation += 1; project = null; uid = null; busy = false; root.hidden = true; // 응답 무효화
            find('list').replaceChildren(); find('message').textContent = ''; // 참여자와 입력 제거
        } // 닫기 끝
        async function change(member, role, confirm, remove) // 서버 역할 변경
        { // 변경 시작
            if (busy || !project || (remove && confirm.value !== member.display_name)) // 중복과 확인 이름
            { // 변경 제한
                find('message').textContent = '내보내려면 참여자 이름을 정확히 입력하세요.'; return; // 실수 방지
            } // 제한 끝
            const token = generation; const id = project.project_id; busy = true; // 요청 소유권
            try // 관리자 재검사
            { // 요청 시작
                const body = remove ? { target_guest_id: member.guest_id, confirm_name: confirm.value } : { target_guest_id: member.guest_id, role: role.value }; // 대상 별칭과 확인값
                await window.api.post('/api/projects/' + id + '/members/' + (remove ? 'remove' : 'role'), body); // 서버 잠금과 무결성
                if (current(token)) // 현재 계정
                { // 최신 화면 복구
                    close(); await callbacks.onChanged(id); // 자기 강등도 서버 역할로 재진입
                } // 복구 끝
            } // 요청 끝
            catch (error) // 마지막 관리자와 접근 오류
            { // 실패 시작
                if (current(token)) // 현재 화면
                { // 오류 표시
                    find('message').textContent = error.message || '참여자를 변경하지 못했습니다.'; // 명확한 실패 이유
                } // 표시 끝
            } // 실패 끝
            finally // 재시도 허용
            { // 복원 시작
                if (current(token)) // 현재 화면
                { // 상태 복구
                    busy = false; // 다음 변경 허용
                } // 복구 끝
            } // 복원 끝
        } // 변경 끝
        async function open(value) // 관리자 목록 조회
        { // 열기 시작
            close(); // 이전 작업실 입력 제거
            if (!window.TC_MEMBER_USER || value.role !== 'admin') // 회원 관리자 제한
            { // 표시 제외
                return; // 게스트 기존 흐름 보존
            } // 제외 끝
            project = { ...value }; uid = window.TC_MEMBER_USER.user_id; const token = generation; root.hidden = false; // 현재 범위
            try // 관리 범위 조회
            { // 조회 시작
                const data = await window.api.get('/api/projects/' + project.project_id + '/members/manage'); // 회원 관리자 재검사
                if (!current(token)) // 이전 계정 응답
                { // 응답 폐기
                    return; // 현재 화면 보호
                } // 폐기 끝
                const seen = new Set(); // 같은 회원 묶음
                data.members.forEach((member) => // 참여자 목록
                { // 행 생성
                    const key = member.user_id ? 'u' + member.user_id : 'g' + member.guest_id; // 회원 또는 게스트
                    if (seen.has(key)) // 동일 회원 별칭
                    { // 중복 제외
                        return; // 대표 이름 한 번 표시
                    } // 제외 끝
                    seen.add(key); const card = document.createElement('div'); card.className = 'manage-member'; // 회원 행
                    const name = document.createElement('strong'); name.textContent = member.display_name + (member.user_id ? ' · 회원' : ' · 게스트'); // 안전 이름
                    const role = document.createElement('select'); role.setAttribute('aria-label', member.display_name + ' 역할'); // 역할 선택 이름
                    Object.entries(roles).forEach(([value, label]) => // 허용 역할
                    { // 선택지 생성
                        const option = document.createElement('option'); option.value = value; option.textContent = label; role.append(option); // 안전 출력
                    }); // 선택지 끝
                    const rank = { viewer: 1, editor: 2, admin: 3 }; // 서버와 같은 역할 순위
                    role.value = data.members.filter((row) => member.user_id ? row.user_id === member.user_id : row.guest_id === member.guest_id).reduce((best, row) => rank[row.role] > rank[best] ? row.role : best, 'viewer'); // 회원 묶음의 실제 최고 역할
                    const save = document.createElement('button'); save.type = 'button'; save.textContent = '역할 변경'; // 변경 버튼
                    const confirm = document.createElement('input'); confirm.type = 'text'; confirm.maxLength = 60; confirm.placeholder = '내보낼 참여자 이름'; confirm.setAttribute('aria-label', member.display_name + ' 내보내기 확인 이름'); // 명시적 확인
                    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '내보내기'; remove.className = 'danger-link'; // 위험 동작 구분
                    save.addEventListener('click', () => change(member, role, confirm, false)); remove.addEventListener('click', () => change(member, role, confirm, true)); // 서버 변경 연결
                    card.append(name, role, save, confirm, remove); find('list').append(card); // 행 연결
                }); // 목록 끝
                find('message').textContent = '같은 회원의 연결 이름에는 역할 변경과 내보내기가 함께 적용됩니다. 마지막 관리자는 보호됩니다.'; // 변경 범위 설명
            } // 조회 끝
            catch (error) // 최신 권한 상실
            { // 실패 시작
                if (current(token)) // 현재 화면
                { // 실패 표시
                    find('list').replaceChildren(); find('message').textContent = error.message || '참여자를 조회하지 못했습니다.'; // 오래된 목록 제거
                } // 표시 끝
            } // 실패 끝
        } // 열기 끝
        close(); return { open, close }; // 공개 화면 계약
    } // 연결 끝
    return { mount }; // 공개 모듈
})(); // 모듈 끝
