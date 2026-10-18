<?php // 회원 작업실 HTTP 처리
declare(strict_types=1); // 엄격한 자료형
final class MemberWorkspaceController // 회원 작업실 API
{ // 컨트롤러 시작
    public function index(Request $request): void // 회원 작업실 조회
    { // 목록 처리
        $user = MemberWorkspace::requireUser($request); // 로그인 검사
        $guest = Auth::currentGuest($request); // 현재 게스트
        Response::ok(['projects' => MemberWorkspace::workspaces($user), 'can_link_guest' => $guest !== null && $guest['user_id'] === null, 'guest' => $guest === null ? null : ['guest_id' => (int) $guest['guest_id'], 'display_name' => $guest['display_name']]]); // 연결 가능 여부와 목록
    } // 목록 끝
    public function link(Request $request): void // 게스트 소유 연결
    { // 연결 처리
        Auth::requireMutationHeader($request); // 요청 위조 차단
        Response::ok(MemberWorkspace::linkGuest($request)); // 검증된 연결
    } // 연결 끝
    public function select(Request $request): void // 작업실 전환
    { // 전환 처리
        Auth::requireMutationHeader($request); // 요청 위조 차단
        Response::ok(MemberWorkspace::selectWorkspace($request, $request->int('project_id'))); // 본인 작업실만 선택
    } // 전환 끝
    public function join(Request $request): void // 초대 참여
    { // 초대 처리
        Auth::requireMutationHeader($request); // 요청 위조 차단
        Response::ok(MemberWorkspace::joinWorkspace($request, $request->string('invite_code', 120)), 201); // 초대 가입
    } // 초대 끝
} // 컨트롤러 끝
