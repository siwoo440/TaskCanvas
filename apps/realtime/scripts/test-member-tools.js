'use strict'; // 엄격한 검사
const assert = require('assert/strict'); // 독립 기대값
const Harness = require('./lib/import-harness.cjs'); // 두 PHP 서버·고유 DB
let passed = 0; // 통과 개수
function check(value, label) // 동작 검사
{ // 검사 시작
    assert(value, label); passed += 1; console.log('PASS ' + label); // 결과 출력
} // 검사 끝
async function main() // 회원 흐름 API 통합 검사
{ // 실행 시작
    const h = await Harness.start(); // 운영 자료와 분리
    const api = h.request.bind(h); // 실제 HTTP
    try // 자원 정리 보장
    { // 검사 자료 준비
        check((await api('GET', '/api/auth/home')).status === 401, '개인 홈 비인증 차단'); // 구현 전 실패 지점
        const password = 'Member34-test!'; // 가상 회원 비밀번호
        const account = async (loginId) => // 독립 회원 세션
        { // 가입·로그인
            await api('POST', '/api/auth/register', { login_id: loginId, display_name: loginId, password, password_confirm: password }); // 테스트 계정
            return (await api('POST', '/api/auth/login', { login_id: loginId, password })).cookie; // 회원 쿠키
        }; // 가입 끝
        const userA = await account('member34a'); const userB = await account('member34b'); const userC = await account('member34c'); // 격리 계정 세 개
        const made = await api('POST', '/api/projects', { title: '공유 작업실', display_name: '관리자 A' }, userA); // 회원 소유 작업실
        const project = made.data.project.project_id; const board = made.data.board.board_id; const guestA = made.data.guest.guest_id; // 생성 식별자
        const cookieA = userA + '; ' + made.cookie; const route = '/api/projects/' + project; // 활성 회원 결합
        const invite = await api('POST', route + '/invites', { role: 'admin', days: 1 }, cookieA); // 회원 초대
        const joined = await api('POST', '/api/auth/workspaces/join', { invite_code: invite.data.code }, userB); // 기존 회원 초대 재사용
        check(joined.status === 201, '기존 회원 초대 참여 유지'); // 기존 인증 회귀
        const selected = await api('POST', '/api/auth/workspaces/select', { project_id: project }, userB); // B 활성 게스트
        const cookieB = userB + '; ' + selected.cookie; const guestB = selected.data.guest.guest_id; // 회원 B 범위
        const outsider = await api('POST', '/api/projects', { title: '외부 비공개', display_name: '외부 회원' }, userC); // 타 작업실
        const foreignBoard = outsider.data.board.board_id; // 검색·즐겨찾기 제외 대상
        const views = route + '/analytics/views'; // 공통 저장 뷰 경로
        const filters = { created_from: '2026-10-01', created_to: '2026-10-21', status: 'done', assignee_id: null }; // 독립 필터 fixture
        check((await api('GET', views, null, made.cookie)).status === 401, '회원 쿠키 없는 저장 뷰 차단'); // 회원 결합 유지
        check((await api('GET', views, null, userC)).status === 403, '타 작업실 저장 뷰 차단'); // 범위 보호
        const saved = await api('POST', views, { name: '완료 모음', filters, is_default: true }, userA); // 회원 A 개인 저장
        check(saved.status === 201 && saved.data.view.version === 1, '저장 뷰 생성과 버전'); // 최초 저장
        const viewId = saved.data.view.view_id; // 개인 보기 ID
        const list = await api('GET', views, null, userA); // 본인 보기
        check(list.data.views.length === 1 && list.data.views[0].filters.status === 'done', '적용 조건 재조회'); // 필터 직렬화
        check((await api('GET', views, null, userB)).data.views.length === 0, '같은 작업실 다른 회원 보기 비공개'); // 소유권
        check((await api('POST', views, { view_id: viewId, version: 1, name: '탈취', filters, is_default: true }, userB)).status === 404, '다른 회원 보기 수정 거부'); // 위조 ID
        check((await api('POST', views + '/' + viewId + '/delete', { version: 1 }, userB)).status === 404, '다른 회원 보기 삭제 거부'); // 삭제 경계
        check((await api('POST', views, { name: '역순', filters: { ...filters, created_from: '2026-10-22' } }, userA)).status === 400, '저장 뷰 역순 날짜 거부'); // 기존 필터 검증
        check((await api('POST', views, { name: '배열', filters: { ...filters, status: [] } }, userA)).status === 400, '저장 뷰 잘못된 자료형 거부'); // JSON 검증
        check((await api('POST', views, { name: '보호', filters }, userA, 0, false)).status === 403, '저장 뷰 변경 보호 헤더'); // CSRF
        const updated = await api('POST', views, { view_id: viewId, version: 1, name: '완료 변경', filters, is_default: true }, userA); // 정상 수정
        check(updated.status === 200 && updated.data.view.version === 2, '저장 뷰 버전 증가'); // 낙관적 동시성
        check((await api('POST', views, { view_id: viewId, version: 1, name: '오래된 수정', filters }, userA)).status === 409, '오래된 저장 뷰 수정 거부'); // 덮어쓰기 방지
        await api('POST', views, { name: '두 번째 기본', filters, is_default: true }, userA); // 기본값 교체
        check((await api('GET', views, null, userA)).data.views.filter((view) => view.is_default).length === 1, '회원별 기본 보기 한 개'); // 원자적 기본값
        const favorite = '/api/auth/boards/' + board + '/favorite'; // 즐겨찾기 경로
        check((await api('POST', favorite, { active: true }, userA)).status === 200, '접근 가능한 보드 즐겨찾기'); // 개인 설정
        await api('POST', favorite, { active: true }, userA); // 동일 요청 재시도
        check((await api('GET', '/api/auth/home', null, userA)).data.favorites.length === 1, '즐겨찾기 재시도 중복 없음'); // 멱등 동작
        check((await api('GET', '/api/auth/home', null, userB)).data.favorites.length === 0, '회원별 즐겨찾기 격리'); // 타 사용자 비공개
        check((await api('POST', '/api/auth/boards/' + foreignBoard + '/favorite', { active: true }, userA)).status === 403, '타 작업실 즐겨찾기 차단'); // ID 위조
        check((await api('POST', '/api/auth/boards/' + board + '/visit', {}, userA)).status === 200, '보드 방문 기록'); // 최근 보드
        await h.db.query("INSERT INTO tasks (project_id,title,status,assignee_id,due_at) VALUES (?,?, 'todo',?,DATE_ADD(CURDATE(),INTERVAL 1 DAY)),(?,?,'todo',NULL,NULL),(?,?,'todo',NULL,NULL)", [project, '한글 100%_업무', guestA, project, '다른 담당 업무', outsider.data.project.project_id, '한글 외부 비밀']); // 검색·홈 자료
        await h.db.query("INSERT INTO board_objects (board_id,type,payload_json) VALUES (?,'note',?), (?,'note',?)", [board, JSON.stringify({ text: '한글 메모 내용' }), foreignBoard, JSON.stringify({ text: '한글 비공개 메모' })]); // 실제 메모
        const home = (await api('GET', '/api/auth/home', null, userA)).data; // 개인 집계
        check(home.tasks.length === 1 && home.due_soon.length === 1 && home.recent.length === 1, '내 업무·마감·최근 보드 분리 조회'); // 본인 연결 게스트 기준
        check((await api('GET', '/api/auth/home', null, userB)).data.tasks.length === 0, '다른 회원 담당 업무 비공개'); // 개인 업무 경계
        const search = await api('GET', '/api/auth/search?q=' + encodeURIComponent('한글'), null, userA); // 한글 부분 검색
        check(search.status === 200 && search.data.results.length === 2 && search.data.results.every((result) => result.project_id === project), '업무·메모 검색과 타 작업실 차단'); // 실제 결과
        check((await api('GET', '/api/auth/search?q=%25_', null, userA)).data.results.length === 1, '검색 %와 _ 리터럴 처리'); // 와일드카드 우회 방지
        check((await api('GET', '/api/auth/search?q[]=' + encodeURIComponent('한글'), null, userA)).status === 400, '배열 검색어 거부'); // 입력 자료형
        check((await api('GET', '/api/auth/search?q=' + 'x'.repeat(81), null, userA)).status === 400, '검색어 80자 제한'); // 자원 경계
        if (!process.argv.includes('--personal')) // 역할 관리 범위
        { // 멤버 관리 검사
            const manage = route + '/members'; // 관리 경로
            check((await api('GET', manage + '/manage', null, userA)).status === 200, '회원 관리자의 참여자 관리'); // 서버 관리자 확인
            const alias = await h.db.query("INSERT INTO guests (display_name) VALUES ('B의 이전 이름')"); // 같은 회원의 다른 별칭
            const guestAlias = alias[0].insertId; // 별칭 식별자
            const [[linkB]] = await h.db.query('SELECT user_id FROM guest_user_links WHERE guest_id=?', [guestB]); // 실제 회원 B ID
            await h.db.query('INSERT INTO guest_user_links (guest_id,user_id) VALUES (?,?); INSERT INTO project_members (project_id,guest_id,role) VALUES (?, ?, ?)', [guestAlias, linkB.user_id, project, guestAlias, 'admin']); // 최고 역할 우회 fixture
            check((await api('POST', manage + '/role', { target_guest_id: guestB, role: 'viewer' }, userA)).status === 200, '회원 역할 변경'); // 정상 관리자 동작
            const [roles] = await h.db.query('SELECT role FROM project_members WHERE project_id=? AND guest_id IN (?,?)', [project, guestB, guestAlias]); // 실제 별칭 상태
            check(roles.length === 2 && roles.every((row) => row.role === 'viewer'), '같은 회원 별칭의 최고 역할 우회 차단'); // 전체 연결 변경
            check((await api('POST', manage + '/role', { target_guest_id: guestA, role: 'viewer' }, userA)).status === 409, '마지막 관리자 강등 거부'); // 관리자 보존
            check((await api('POST', manage + '/role', { target_guest_id: guestA, role: 'admin' }, userB)).status === 403, '강등 즉시 HTTP 관리자 권한 상실'); // 최신 권한 검사
            check((await api('POST', manage + '/remove', { target_guest_id: guestA, confirm_name: 'member34a' }, userA)).status === 409, '마지막 관리자 내보내기 거부'); // 실제 회원 표시 이름
            check((await api('POST', manage + '/role', { target_guest_id: guestB, role: 'admin' }, userA)).status === 200, '관리자 재승격'); // 동시성 준비
            const concurrent = await Promise.all([api('POST', manage + '/role', { target_guest_id: guestA, role: 'viewer' }, userA, 0), api('POST', manage + '/role', { target_guest_id: guestB, role: 'viewer' }, userB, 1)]); // 두 관리자의 동시 자기 강등
            check(concurrent.filter((reply) => reply.status === 200).length === 1, '동시 강등 하나만 승인'); // 직렬화 결과
            const [[remaining]] = await h.db.query("SELECT COUNT(*) AS n FROM project_members WHERE project_id=? AND role='admin'", [project]); // 남은 관리자
            check(remaining.n >= 1, '동시 요청 후 관리자 보존'); // 무결성
            const adminCookie = concurrent[0].status === 200 ? userB : userA; // 남은 관리자 세션
            const targetGuest = concurrent[0].status === 200 ? guestA : guestB; // 강등된 회원
            const targetName = concurrent[0].status === 200 ? 'member34a' : 'member34b'; // 회원 게스트의 실제 표시 이름
            check((await api('POST', manage + '/remove', { target_guest_id: targetGuest, confirm_name: '잘못된 이름' }, adminCookie)).status === 400, '내보내기 이름 확인'); // 실수 방지
            check((await api('POST', manage + '/remove', { target_guest_id: targetGuest, confirm_name: targetName }, adminCookie)).status === 200, '확인된 회원 내보내기'); // 실제 제거
            const removedUser = targetGuest === guestA ? userA : userB; // 접근 해제 회원
            check((await api('GET', views, null, removedUser)).status === 403, '내보낸 회원 저장 뷰 접근 차단'); // 설정 권한 재확인
            check((await api('GET', '/api/auth/search?q=' + encodeURIComponent('한글'), null, removedUser)).data.results.length === 0, '내보낸 회원 검색 결과 제외'); // 검색 권한 회수
            const [[removedLink]] = await h.db.query('SELECT user_id FROM guest_user_links WHERE guest_id=?', [targetGuest]); // 해제 회원 ID
            await h.db.query('DELETE FROM user_board_favorites WHERE user_id=?', [removedLink.user_id]); // 임시 검사 자료 초기화
            for (let index = 0; index < 100; index += 1) // 접근 해제된 즐겨찾기 한도
            { // 옛 보드 준비
                const [oldBoard] = await h.db.query('INSERT INTO boards (project_id,title) VALUES (?,?)', [project, '해제 보드 ' + index]); // 옛 작업실 보드
                await h.db.query('INSERT INTO user_board_favorites (user_id,board_id) VALUES (?,?)', [removedLink.user_id, oldBoard.insertId]); // 숨겨진 개인 설정
            } // 준비 끝
            check((await api('GET', '/api/auth/home', null, removedUser)).data.favorites.length === 0, '접근 해제된 즐겨찾기 숨김'); // 현재 멤버십 필터
            const newWorkspace = await api('POST', '/api/projects', { title: '새 개인 작업실', display_name: targetName }, removedUser); // 해제 회원의 새 작업실
            check((await api('POST', '/api/auth/boards/' + newWorkspace.data.board.board_id + '/favorite', { active: true }, removedUser)).status === 200, '접근 해제된 즐겨찾기로 신규 등록 봉쇄 방지'); // 숨은 한도 회귀
        } // 역할 검사 끝
        await api('POST', '/api/auth/logout', {}, userA); // 회원 세션 폐기
        check((await api('GET', '/api/auth/home', null, userA)).status === 401, '로그아웃 후 개인 자료 차단'); // 세션 경계
        console.log('회원 도구 API ' + passed + '개 통과'); // 최종 결과
    } // 시나리오 끝
    finally // 고유 환경만 정리
    { // 정리 시작
        await h.close(); // 두 서버·임시 DB 정리
    } // 정리 끝
} // 실행 끝
main().catch((error) => // 실패 보고
{ // 오류 처리
    console.error(error); process.exitCode = 1; // 실제 실패 종료
}); // 오류 처리 끝
