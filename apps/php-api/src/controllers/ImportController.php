<?php // 작업실 파일 가져오기 API
declare(strict_types=1); // 엄격한 자료형
final class ImportController // 인증 우선 처리
{ // 컨트롤러 시작
    private function authorize(Request $request, string $role): int // 공통 작업실 권한
    { // 인증 시작
        if ($request->method === 'POST') // 상태 변경
        { // 변경 헤더
            Auth::requireMutationHeader($request); // CSRF 보호
        } // 변경 헤더 끝
        $guest = Auth::requireGuest($request); $projectId = $request->params['id']; // 실제 신원
        Auth::requireRole((int) $guest['guest_id'], $projectId, $role); // 파싱 전 역할
        return $projectId; // 검증한 범위
    } // 인증 끝
    public function upload(Request $request): void // 파일 전송
    { // 업로드 시작
        $projectId = $this->authorize($request, 'editor'); // 사전 권한
        Response::ok(ImportDrafts::upload($request, $projectId), 201); // 새 초안
    } // 업로드 끝
    public function preview(Request $request): void // 원본 미리보기
    { // 미리보기 시작
        $projectId = $this->authorize($request, 'editor'); // 사전 권한
        Response::ok(ImportDrafts::preview($request, $projectId, $request->json())); // 제한된 원본
    } // 미리보기 끝
} // 컨트롤러 끝
