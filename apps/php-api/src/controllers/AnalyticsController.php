<?php // 작업실 통계 조회 API
declare(strict_types=1); // 엄격한 자료형
final class AnalyticsController // 읽기 전용 통계 처리
{ // 컨트롤러 시작
    public function export(Request $request): void // CSV 내보내기
    { // 내보내기 시작
        $guest = Auth::requireGuest($request); // 기존 결합 인증
        $projectId = $request->params['id']; // 작업실 번호
        Auth::requireRole((int) $guest['guest_id'], $projectId, 'viewer'); // 다운로드 권한
        AnalyticsExport::download($projectId, $_GET); // 공통 필터 CSV
    } // 내보내기 끝
    public function dashboard(Request $request): void // 대시보드 조회
    { // 조회 시작
        $guest = Auth::requireGuest($request); // 기존 결합 인증
        $projectId = $request->params['id']; // 작업실 번호
        Auth::requireRole((int) $guest['guest_id'], $projectId, 'viewer'); // 필터 전 역할 검사
        Response::ok(AnalyticsDashboard::get($projectId, $_GET)); // 읽기 응답
    } // 조회 끝
    public function summary(Request $request): void // 작업실 집계
    { // 조회 시작
        $guest = Auth::requireGuest($request); // 회원 결합 또는 독립 게스트 인증
        $projectId = $request->params['id']; // 라우터의 정수 작업실 번호
        Auth::requireRole((int) $guest['guest_id'], $projectId, 'viewer'); // 모든 필터 처리 전 접근 권한
        Response::ok(TaskAnalytics::summary($projectId, $_GET)); // 기존 no-store JSON 응답
    } // 조회 끝
} // 컨트롤러 끝
