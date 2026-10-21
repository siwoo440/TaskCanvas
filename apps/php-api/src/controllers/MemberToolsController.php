<?php // 회원 개인 도구 API
declare(strict_types=1); // 엄격한 자료형
final class MemberToolsController // 소유권 보호 HTTP 경계
{ // 컨트롤러 시작
    public function members(Request $request): void // 관리 참여자 목록
    { // 관리 조회
        Response::ok(['members' => MemberManagement::list(MemberWorkspace::requireUser($request), $request->params['id'])]); // 회원 관리자 범위
    } // 관리 조회 끝
    public function role(Request $request): void // 참여자 역할 변경
    { // 역할 변경
        Auth::requireMutationHeader($request); // 변경 요청 보호
        MemberManagement::change(MemberWorkspace::requireUser($request), $request->params['id'], $request->int('target_guest_id'), $request->string('role', 20)); // 서버 최신 권한 확인
        Response::ok(['changed' => true]); // 확정 응답
    } // 역할 변경 끝
    public function remove(Request $request): void // 회원 내보내기
    { // 내보내기 시작
        Auth::requireMutationHeader($request); // 변경 요청 보호
        MemberManagement::change(MemberWorkspace::requireUser($request), $request->params['id'], $request->int('target_guest_id'), null, $request->string('confirm_name', 60)); // 이름 확인·관리자 보호
        Response::ok(['removed' => true]); // 확정 응답
    } // 내보내기 끝
    public function home(Request $request): void // 개인 홈
    { // 조회 시작
        Response::ok(MemberHome::get(MemberWorkspace::requireUser($request))); // 인증 뒤 개인 집계
    } // 조회 끝
    public function search(Request $request): void // 통합 검색
    { // 검색 시작
        Response::ok(MemberSearch::get(MemberWorkspace::requireUser($request), $_GET)); // 회원 접근 범위
    } // 검색 끝
    public function views(Request $request): void // 저장 보기 목록
    { // 조회 시작
        Response::ok(['views' => SavedViews::list(MemberWorkspace::requireUser($request), $request->params['id'])]); // 회원·작업실 격리
    } // 조회 끝
    public function saveView(Request $request): void // 보기 생성·수정
    { // 저장 시작
        Auth::requireMutationHeader($request); $user = MemberWorkspace::requireUser($request); // CSRF·회원 인증
        $body = $request->json(); $view = SavedViews::save($user, $request->params['id'], $body); // 검증한 저장
        Response::ok(['view' => $view], empty($body['view_id']) ? 201 : 200); // 생성 상태 구분
    } // 저장 끝
    public function deleteView(Request $request): void // 보기 삭제
    { // 삭제 시작
        Auth::requireMutationHeader($request); // 변경 보호
        SavedViews::delete(MemberWorkspace::requireUser($request), $request->params['id'], $request->params['viewId'], $request->int('version')); // 본인 보기·버전
        Response::ok(['deleted' => true]); // 완료 응답
    } // 삭제 끝
    public function favorite(Request $request): void // 즐겨찾기 등록·해제
    { // 변경 시작
        Auth::requireMutationHeader($request); $user = MemberWorkspace::requireUser($request); // 보호 경계
        $active = $request->json()['active'] ?? null; // 명시적 원하는 상태
        if (!is_bool($active)) // 토글 오작동 방지
        { // 입력 거부
            throw new ApiException(400, 'BAD_REQUEST', 'active는 true 또는 false여야 합니다.'); // 자료형 안내
        } // 입력 거부 끝
        MemberHome::board($user, $request->params['id'], $active); Response::ok(['active' => $active]); // 멱등 저장
    } // 변경 끝
    public function visit(Request $request): void // 최근 보드 기록
    { // 기록 시작
        Auth::requireMutationHeader($request); // 보호 헤더
        MemberHome::board(MemberWorkspace::requireUser($request), $request->params['id'], null); Response::ok(['recorded' => true]); // 권한 확인 후 방문
    } // 기록 끝
} // 컨트롤러 끝
