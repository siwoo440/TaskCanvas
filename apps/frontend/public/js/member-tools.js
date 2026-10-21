'use strict'; // 엄격한 검사
window.MemberTools = (() => // 개인 홈과 빠른 검색
{ // 모듈 시작
    function mount(callbacks) // 화면 연결
    { // 연결 시작
        const find = (id) => document.getElementById(id); // 화면 요소
        const panel = find('personal-home'); const dialog = find('member-search-dialog'); const query = find('member-search-query'); const results = find('member-search-results'); // 주요 영역
        let generation = 0; let searchGeneration = 0; let timer = 0; let opener = null; let favorites = new Set(); let resultButtons = []; // 개인 상태
        const currentUser = () => window.TC_MEMBER_USER?.user_id; // 현재 회원
        const sameUser = (uid) => uid && uid === currentUser(); // 계정 일치
        function closeSearch() // 검색 자료 폐기
        { // 닫기 시작
            searchGeneration += 1; clearTimeout(timer); query.value = ''; results.replaceChildren(); resultButtons = []; // 지연 응답 무효화
            find('member-search-message').textContent = ''; // 이전 안내 제거
            if (dialog.open) // 열린 검색
            { // 네이티브 닫기
                dialog.close(); // 기본 초점 처리
            } // 닫기 끝
            opener?.focus(); opener = null; // 호출 요소 복원
        } // 닫기 끝
        function openSearch() // 키보드 검색 진입
        { // 열기 시작
            if (!currentUser() || document.querySelector('dialog[open]')) // 회원과 중첩 대화상자 확인
            { // 진입 제한
                return; // 미완료 입력 보호
            } // 제한 끝
            opener = document.activeElement; dialog.showModal(); query.focus(); // 네이티브 초점 가두기
        } // 열기 끝
        async function navigate(item, button) // 권한 재검사 이동
        { // 이동 시작
            const uid = currentUser(); button.disabled = true; // 중복 이동 제한
            closeSearch(); // 검색과 개인 입력 제거
            try // 기존 작업실 이동
            { // 이동 요청
                await callbacks.onNavigate(item); // 서버 선택과 최신 목록
            } // 요청 끝
            catch (error) // 삭제와 권한 변경
            { // 실패 처리
                if (sameUser(uid)) // 현재 계정
                { // 안내 출력
                    find('personal-message').textContent = error.message || '대상에 접근할 수 없습니다. 목록을 새로고침하세요.'; // 복구 안내
                } // 안내 끝
            } // 실패 끝
            finally // 재시도 허용
            { // 복원 시작
                button.disabled = false; // 이동 버튼 복원
            } // 복원 끝
        } // 이동 끝
        function itemButton(item, label) // 안전한 이동 버튼
        { // 버튼 시작
            const button = document.createElement('button'); button.type = 'button'; button.textContent = label; // HTML 주입 방지
            button.addEventListener('click', () => navigate(item, button)); return button; // 기존 이동 연결
        } // 버튼 끝
        function syncFavorites() // 모든 보드 표시 동기화
        { // 동기화 시작
            document.querySelectorAll('[data-favorite-board]').forEach((button) => // 현재 보드 버튼
            { // 상태 표시
                const active = favorites.has(Number(button.dataset.favoriteBoard)); // 본인 즐겨찾기
                button.textContent = active ? '★ 즐겨찾기 해제' : '☆ 즐겨찾기'; button.setAttribute('aria-pressed', String(active)); // 텍스트와 접근성
            }); // 표시 끝
        } // 동기화 끝
        async function refresh() // 개인 자료 조회
        { // 조회 시작
            const token = ++generation; const uid = currentUser(); favorites = new Set(); // 이전 자료 무효화
            ['tasks', 'due', 'recent', 'favorites'].forEach((id) => find('personal-' + id).replaceChildren()); // 이전 회원 목록 폐기
            panel.hidden = !uid; find('member-search-open').hidden = !uid; find('personal-message').textContent = ''; // 회원 전용 표시
            if (!uid) // 로그아웃 상태
            { // 정리 시작
                closeSearch(); syncFavorites(); return; // 검색과 표시 폐기
            } // 정리 끝
            try // 최신 범위 조회
            { // 요청 시작
                const data = await window.api.get('/api/auth/home'); // 본인 업무와 보드
                if (token !== generation || !sameUser(uid)) // 이전 계정 응답
                { // 응답 폐기
                    return; // 신원 정보 보호
                } // 폐기 끝
                favorites = new Set(data.favorites.map((row) => Number(row.board_id))); syncFavorites(); // 보드 버튼 동기화
                [['tasks', data.tasks], ['due', data.due_soon], ['recent', data.recent], ['favorites', data.favorites]].forEach(([id, rows]) => // 네 가지 목록
                { // 목록 표시
                    const list = find('personal-' + id); // 현재 목록
                    if (!rows.length) // 빈 목록
                    { // 빈 상태
                        const empty = document.createElement('p'); empty.textContent = '표시할 항목이 없습니다.'; list.append(empty); // 빈 안내
                    } // 빈 상태 끝
                    rows.forEach((row) => // 현재 항목
                    { // 버튼 표시
                        const item = { ...row, kind: row.task_id ? 'task' : 'board', id: Number(row.task_id || row.board_id) }; // 이동 식별자
                        list.append(itemButton(item, row.project_title + ' · ' + row.title + (row.due_at ? ' · ' + row.due_at : ''))); // 안전한 이름
                    }); // 항목 끝
                }); // 목록 끝
            } // 요청 끝
            catch (error) // 서버 오류
            { // 실패 시작
                if (token === generation && sameUser(uid)) // 현재 계정
                { // 안내 표시
                    find('personal-message').textContent = error.message || '개인 자료를 불러오지 못했습니다.'; // 재조회 안내
                } // 안내 끝
            } // 실패 끝
        } // 조회 끝
        function favoriteButton(board) // 보드별 즐겨찾기
        { // 버튼 시작
            const button = document.createElement('button'); button.type = 'button'; button.dataset.favoriteBoard = String(board.board_id); // 보드 번호
            const active = favorites.has(Number(board.board_id)); button.textContent = active ? '★ 즐겨찾기 해제' : '☆ 즐겨찾기'; button.setAttribute('aria-pressed', String(active)); // 초기 상태
            button.addEventListener('click', async () => // 개인 설정 변경
            { // 변경 시작
                const uid = currentUser(); const desired = !favorites.has(Number(board.board_id)); button.disabled = true; // 현재 소유와 목표
                try // 변경 요청
                { // 요청 시작
                    await window.api.post('/api/auth/boards/' + board.board_id + '/favorite', { active: desired }); // 서버 권한 확인
                    if (sameUser(uid)) // 현재 계정
                    { // 목록 갱신
                        await refresh(); // 확정 상태 재조회
                    } // 갱신 끝
                } // 요청 끝
                catch (error) // 한도와 접근 오류
                { // 실패 안내
                    if (sameUser(uid)) // 현재 계정
                    { // 안내 표시
                        find('personal-message').textContent = error.message || '즐겨찾기를 변경하지 못했습니다.'; // 실패 이유
                    } // 안내 끝
                } // 실패 끝
                finally // 버튼 복원
                { // 복원 시작
                    button.disabled = false; // 재시도 허용
                } // 복원 끝
            }); // 변경 끝
            return button; // 카드 연결
        } // 버튼 끝
        async function search() // 통합 검색
        { // 검색 시작
            clearTimeout(timer); const token = ++searchGeneration; const uid = currentUser(); const text = query.value.trim(); // 검색 소유권
            results.replaceChildren(); resultButtons = []; find('member-search-message').textContent = ''; // 이전 검색 폐기
            if (!text || !dialog.open || !uid) // 빈 입력과 이탈
            { // 조회 제외
                return; // 이전 결과 노출 방지
            } // 제외 끝
            try // 검색 API
            { // 조회 시작
                const data = await window.api.get('/api/auth/search?' + new URLSearchParams({ q: text })); // 검색어 안전 인코딩
                if (token !== searchGeneration || !dialog.open || !sameUser(uid)) // 이전 입력과 계정
                { // 응답 폐기
                    return; // 현재 검색 유지
                } // 폐기 끝
                const names = { project: '작업실', board: '보드', task: '업무', note: '메모' }; // 유형 이름
                resultButtons = data.results.map((item) => itemButton(item, names[item.kind] + ' · ' + item.title)); results.append(...resultButtons); // 안전한 결과 버튼
                find('member-search-message').textContent = data.results.length + '개 결과 · 유형별 최대 10개'; // 결과 상한 안내
            } // 조회 끝
            catch (error) // 검색 실패
            { // 실패 시작
                if (token === searchGeneration && dialog.open && sameUser(uid)) // 현재 검색
                { // 안내 표시
                    find('member-search-message').textContent = error.message || '검색하지 못했습니다.'; // 실패 이유
                } // 안내 끝
            } // 실패 끝
        } // 검색 끝
        query.addEventListener('input', () => // 입력 지연 검색
        { // 예약 시작
            searchGeneration += 1; clearTimeout(timer); results.replaceChildren(); resultButtons = []; // 즉시 이전 결과 무효화
            timer = setTimeout(search, 200); // 과도한 조회 방지
        }); // 예약 끝
        dialog.addEventListener('keydown', (event) => // 검색 결과 키보드 이동
        { // 키 처리
            if (event.isComposing || event.keyCode === 229) // 한글 조합 중
            { // 조합 보호
                return; // Enter 조기 실행 방지
            } // 조합 보호 끝
            if (['ArrowDown', 'ArrowUp'].includes(event.key) && resultButtons.length) // 결과 순환
            { // 방향 이동
                event.preventDefault(); const index = resultButtons.indexOf(document.activeElement); // 현재 초점
                resultButtons[(index + (event.key === 'ArrowDown' ? 1 : resultButtons.length - 1) + resultButtons.length) % resultButtons.length].focus(); // 순환 초점
            } // 방향 이동 끝
            if (event.key === 'Enter' && document.activeElement === query) // 검색창 Enter
            { // 기본 제출 차단
                event.preventDefault(); search(); // 조합 종료 뒤 조회
            } // Enter 끝
        }); // 키 처리 끝
        dialog.addEventListener('cancel', (event) => // Escape 정리
        { // 취소 시작
            event.preventDefault(); closeSearch(); // 초점 복원
        }); // 취소 끝
        dialog.addEventListener('close', () => // 외부 화면 전환 닫기
        { // 이탈 정리
            searchGeneration += 1; clearTimeout(timer); query.value = ''; results.replaceChildren(); resultButtons = []; // 늦은 응답 폐기
        }); // 이탈 끝
        find('member-search-close').addEventListener('click', closeSearch); // 검색 닫기
        find('member-search-open').addEventListener('click', openSearch); // 검색 버튼
        find('personal-refresh').addEventListener('click', refresh); // 명시적 재조회
        window.addEventListener('keydown', (event) => // 전역 빠른 검색
        { // 단축키 시작
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !event.isComposing && currentUser()) // 회원 단축키
            { // 검색 진입
                event.preventDefault(); openSearch(); // 브라우저 기본 검색 대체
            } // 검색 진입 끝
        }); // 단축키 끝
        window.addEventListener('taskcanvas:member-change', () => // 계정 변경
        { // 변경 정리
            closeSearch(); return refresh(); // 이전 검색과 개인 자료 제거
        }); // 변경 끝
        window.addEventListener('taskcanvas:workspace-refresh', refresh); // 멤버십 변경 반영
        window.addEventListener('focus', refresh); // 다른 탭 변경 재조회
        refresh(); return { refresh, favoriteButton, openSearch, closeSearch, search }; // 공개 화면 계약
    } // 연결 끝
    return { mount }; // 공개 모듈
})(); // 모듈 끝
