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
    public function quality(Request $request): void // 저장 당시 품질 보고서
    { // 상세 시작
        $projectId = $this->authorize($request, 'viewer'); ImportValues::keys($_GET, []); // 인증 우선·추가 조건 거부
        Response::ok(ImportQuality::detail($projectId, $request->params['runId'])); // 원문 없는 요약과 대조
    } // 상세 끝
    public function qualityRows(Request $request): void // 문제 행 페이지
    { // 행 조회 시작
        $projectId = $this->authorize($request, 'viewer'); // 권한 우선
        Response::ok(ImportQuality::rows($projectId, $request->params['runId'], $_GET)); // 교집합 문제 항목
    } // 행 조회 끝
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
    public function validate(Request $request): void // 전체 행 검증
    { // 검증 시작
        $projectId = $this->authorize($request, 'editor'); // 파싱 전 인증
        Response::ok(ImportService::validate($request, $projectId, $request->json())); // 확정 전 보고서
    } // 검증 끝
    public function commit(Request $request): void // 원자적 저장
    { // 저장 시작
        $projectId = $this->authorize($request, 'editor'); // 파싱 전 인증
        Response::ok(ImportService::commit($request, $projectId, $request->json())); // 멱등 결과
    } // 저장 끝
    public function datasets(Request $request): void // 저장 목록
    { // 목록 시작
        $projectId = $this->authorize($request, 'viewer'); // 조회 권한
        Response::ok(ImportDatasets::list($projectId, $_GET)); // 검색 목록
    } // 목록 끝
    public function detail(Request $request): void // 자료 상세
    { // 상세 시작
        $projectId = $this->authorize($request, 'viewer'); // 조회 권한
        ImportValues::keys($_GET, []); // 불명 조건 차단
        Response::ok(ImportDatasets::detail($projectId, $request->params['datasetId'])); // 저장 스키마
    } // 상세 끝
    public function rows(Request $request): void // 저장 행
    { // 행 시작
        $projectId = $this->authorize($request, 'viewer'); // 조회 권한
        Response::ok(ImportDatasets::rows($projectId, $request->params['datasetId'], $_GET)); // 페이지 표
    } // 행 끝
    public function chart(Request $request): void // 막대 집계
    { // 집계 시작
        $projectId = $this->authorize($request, 'viewer'); // 조회 권한
        Response::ok(ImportDatasets::chart($projectId, $request->params['datasetId'], $_GET)); // 정확한 수치
    } // 집계 끝
    public function runs(Request $request): void // 전체 또는 자료 이력
    { // 이력 시작
        $projectId = $this->authorize($request, 'viewer'); // 조회 권한
        Response::ok(ImportDatasets::runs($projectId, $request->params['datasetId'] ?? null, $_GET)); // 제한된 이력
    } // 이력 끝
    public function delete(Request $request): void // 관리자 자료 삭제
    { // 삭제 시작
        $projectId = $this->authorize($request, 'admin'); // 관리자 보호
        Response::ok(ImportDatasets::delete($request, $projectId, $request->params['datasetId'], $request->json())); // 원자적 삭제
    } // 삭제 끝
} // 컨트롤러 끝
