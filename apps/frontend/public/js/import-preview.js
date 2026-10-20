'use strict'; // 엄격한 실행
window.ImportPreview = { mount(root, callbacks) // 작업실 파일 미리보기
{ // 화면 시작
    const find = (name) => root.querySelector('#import-preview-' + name); // 전용 요소
    let active = null; let generation = 0; let draft = null; // 비공개 세션 초안
    function clearResults() // 원본 결과 폐기
    { // 결과 정리
        find('head').replaceChildren(); find('rows').replaceChildren(); find('notices').replaceChildren(); find('meta').textContent = ''; find('results').hidden = true; // 민감한 자료 제거
    } // 결과 정리 끝
    function discard() // 선택 파일의 초안 폐기
    { // 초안 정리
        generation++; draft = null; clearResults(); find('apply').disabled = true; find('path').value = ''; find('candidates').replaceChildren(); find('path-box').hidden = true; // 이전 토큰 재사용 차단
    } // 초안 정리 끝
    function close() // 신원과 화면 수명 종료
    { // 종료 시작
        discard(); active = null; find('file').value = ''; find('message').textContent = ''; find('title').textContent = ''; find('form').hidden = true; find('upload').disabled = true; // 파일과 신원 해제
    } // 종료 끝
    function mayWrite() // 현재 업로드 권한
    { // 역할 검사
        return active && ['editor', 'admin'].includes(active.role); // 편집자 이상
    } // 역할 검사 끝
    function node(tag, text) // HTML 해석 없는 출력
    { // 요소 시작
        const element = document.createElement(tag); element.textContent = text === null ? '—' : String(text); return element; // 원문 텍스트
    } // 요소 끝
    function show(data) // 서버 원본 미리보기
    { // 결과 시작
        draft = { ...draft, ...data }; clearResults(); // 미리보기 응답의 토큰 보존
        find('encoding').value = data.encoding || find('encoding').value; find('path').value = data.json_path || ''; find('path-box').hidden = data.format !== 'json'; // 적용된 해석 상태
        find('candidates').replaceChildren(); const manual = node('option', '직접 입력 또는 루트 배열'); manual.value = ''; find('candidates').append(manual); // 기본 경로
        data.paths.forEach((candidate) => // 서버가 발견한 배열
        { // 경로 후보
            const option = node('option', candidate.path || '루트 배열'); option.value = candidate.path; find('candidates').append(option); // 경로만 안전하게 출력
        }); // 후보 끝
        find('candidates').value = data.json_path || ''; find('apply').disabled = false; // 같은 초안 재해석 가능
        find('meta').textContent = data.file_name + ' · ' + data.format.toUpperCase() + ' · ' + (data.encoding || 'UTF-8') + ' · ' + (data.row_count === null ? '배열 경로 선택 대기' : '전체 ' + data.row_count + '행') + ' · 초안 만료 ' + data.expires_at; // 실제 서버 메타데이터
        find('message').textContent = data.requires_path ? 'JSON 배열 경로를 선택하거나 입력한 뒤 원본 다시 읽기를 누르세요.' : '원본을 읽었습니다. 첫 ' + data.rows.length + '행을 표시합니다.'; // 단계 안내
        if (data.requires_path) // 아직 배열 미선택
        { // 값 노출 보류
            return; // 후보 정보만 표시
        } // 값 노출 보류 끝
        const header = document.createElement('tr'); const first = node('th', '원본 행'); first.scope = 'col'; header.append(first); // 위치 머리글
        data.columns.forEach((column) => // 전체 원본 컬럼
        { // 컬럼 이름
            const cell = node('th', column.label); cell.scope = 'col'; header.append(cell); // 안전한 헤더
        }); // 컬럼 이름 끝
        find('head').append(header); // 머리글 출력
        data.rows.forEach((row) => // 서버 제한 첫20행
        { // 원본 행
            const element = document.createElement('tr'); element.append(node('td', row.source_row)); row.values.forEach((value) => element.append(node('td', value))); find('rows').append(element); // 값 손실 없는 표
            (row.errors || []).forEach((error) => find('notices').append(node('li', row.source_row + '행 · ' + error.message))); // 구조 오류 위치
        }); // 원본 행 끝
        find('results').hidden = false; // 현재 성공 결과만 표시
    } // 결과 끝
    async function run(action, upload) // 요청별 결과 수명
    { // 요청 시작
        const current = ++generation; clearResults(); find('upload').disabled = true; find('apply').disabled = true; find('message').textContent = '파일을 읽고 있습니다…'; // 로딩 상태
        try // 통신 경계
        { // 서버 요청
            const data = await action(); // 실제 API
            if (!active || current !== generation) // 이전 파일 또는 작업실
            { // 응답 폐기
                return; // 현재 결과 보호
            } // 응답 폐기 끝
            show(data); // 현재 결과 적용
        } // 서버 요청 끝
        catch (error) // 구문·한도·통신 실패
        { // 최신 오류만
            if (!active || current !== generation) // 닫힌 요청
            { // 오류 폐기
                return; // 다른 신원 영향 금지
            } // 오류 폐기 끝
            if (error.status === 401 || error.status === 403 || error.code === 'PROJECT_NOT_FOUND') // 실제 접근 상실
            { // 계정 정리
                close(); callbacks.onAccessLost(error); return; // 기존 앱 복귀
            } // 계정 정리 끝
            if (upload || error.status === 410 || error.code === 'DRAFT_NOT_FOUND' || error.code === 'DRAFT_CORRUPT') // 재선택 필요한 원본
            { // 이전 초안 폐기
                discard(); // 손상·만료 토큰 차단
            } // 이전 초안 폐기 끝
            find('message').textContent = error.message || '서버에 연결하지 못했습니다. 다시 시도하세요.'; // 실패를 성공으로 표시 금지
            find('upload').disabled = !mayWrite(); find('apply').disabled = !mayWrite() || !draft; // 현재 오류의 재시도 상태
        } // 최신 오류 끝
        finally // 현재 버튼 복구
        { // 소유권 확인
            if (active && current === generation) // 현재 요청만 처리 종료
            { // 버튼 상태
                find('upload').disabled = !mayWrite(); find('apply').disabled = !mayWrite() || !draft; // 재시도 단계
            } // 버튼 상태 끝
        } // 소유권 확인 끝
    } // 요청 끝
    function changed() // 원본 해석 조건 변경
    { // 이전 미리보기 폐기
        generation++; clearResults(); find('upload').disabled = !mayWrite(); find('apply').disabled = !mayWrite() || !draft; find('message').textContent = draft ? '조건이 변경되었습니다. 원본 다시 읽기를 누르세요.' : '파일 업로드를 누르세요.'; // 새 조건 적용 필요
    } // 이전 미리보기 폐기 끝
    find('file').addEventListener('change', () => // 실제 파일 교체
    { // 이전 파일 차단
        discard(); find('upload').disabled = !mayWrite(); find('message').textContent = '새 파일을 선택했습니다. 파일 업로드를 누르세요.'; // 새 초안만 허용
    }); // 파일 교체 끝
    find('encoding').addEventListener('change', changed); find('path').addEventListener('input', changed); // 명시적 해석 변경
    find('candidates').addEventListener('change', () => // 배열 후보 선택
    { // 경로 반영
        find('path').value = find('candidates').value; changed(); // 직접 입력과 같은 흐름
    }); // 후보 선택 끝
    find('upload').addEventListener('click', () => // 실제 파일 전송
    { // 업로드 시작
        if (!mayWrite()) // 역할과 화면 확인
        { // 요청 차단
            return; // 열람자 쓰기 없음
        } // 요청 차단 끝
        const file = find('file').files && find('file').files[0]; // 현재 선택 파일
        if (!file) // 파일 미선택
        { // 선택 안내
            find('message').textContent = 'CSV 또는 JSON 파일을 먼저 선택하세요.'; find('file').focus(); return; // 첫 입력 이동
        } // 선택 안내 끝
        discard(); const form = new FormData(); form.append('file', file); form.append('encoding', find('encoding').value); // 브라우저 multipart
        const path = '/api/projects/' + active.projectId + '/imports/upload'; // 현재 작업실 고정
        return run(() => window.api.multipart(path, form), true); // 서버 구조 검증
    }); // 업로드 끝
    find('apply').addEventListener('click', () => // 보관 초안 재해석
    { // 미리보기 시작
        if (!mayWrite() || !draft) // 같은 세션의 초안 필요
        { // 요청 차단
            return; // 이전 파일 토큰 금지
        } // 요청 차단 끝
        const path = '/api/projects/' + active.projectId + '/imports/preview'; const body = { draft_token: draft.draft_token, encoding: find('encoding').value, json_path: draft.format === 'json' ? find('path').value : null }; // 요청 시점 조건 고정
        return run(() => window.api.post(path, body), false); // 실제 원문 재해석
    }); // 미리보기 끝
    find('back').addEventListener('click', callbacks.onBack); // 작업실 복귀
    find('form').addEventListener('submit', (event) => event.preventDefault()); // 입력 중 페이지 이동 차단
    function open(options) // 새 작업실 수명
    { // 진입 시작
        close(); active = { ...options }; find('title').textContent = options.title + ' · 데이터 관리'; find('encoding').value = 'UTF-8'; find('form').hidden = !mayWrite(); find('upload').disabled = !mayWrite(); // 역할별 화면
        find('message').textContent = mayWrite() ? '파일을 선택하고 업로드하세요. 원본을 임시로 보관해 미리 봅니다.' : '파일 업로드와 초안 미리보기는 편집자 또는 관리자 권한이 필요합니다.'; // 실제 동작 안내
    } // 진입 끝
    return { open, close }; // 앱 수명 인터페이스
} }; // 화면 끝
