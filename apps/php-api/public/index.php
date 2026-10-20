<?php
// TaskCanvas PHP API 프런트 컨트롤러
declare(strict_types=1);

if (PHP_SAPI === 'cli-server' && !str_starts_with(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/', '/api/'))
{
    return false; // 내장 서버 개발 모드: /api 가 아니면 문서 루트(프론트엔드)의 정적 파일 제공
}

require __DIR__ . '/../src/bootstrap.php'; // 공통 초기화 로드

$router = new Router(); // 라우터 생성

$router->add('GET', '/api/health', [SystemController::class, 'health']); // 상태 확인
$router->add('POST', '/api/auth/register', [MemberAuthController::class, 'register']); // 정식 회원가입
$router->add('POST', '/api/auth/login', [MemberAuthController::class, 'login']); // 회원 로그인
$router->add('GET', '/api/auth/me', [MemberAuthController::class, 'me']); // 회원 로그인 상태
$router->add('POST', '/api/auth/logout', [MemberAuthController::class, 'logout']); // 회원 로그아웃
$router->add('GET', '/api/auth/workspaces', [MemberWorkspaceController::class, 'index']); // 회원 작업실 목록
$router->add('POST', '/api/auth/guest-link', [MemberWorkspaceController::class, 'link']); // 현재 게스트 연결
$router->add('POST', '/api/auth/workspaces/select', [MemberWorkspaceController::class, 'select']); // 회원 작업실 선택
$router->add('POST', '/api/auth/workspaces/join', [MemberWorkspaceController::class, 'join']); // 회원 초대 참여
$router->add('POST', '/api/guest/join', [GuestController::class, 'join']); // 게스트 입장
$router->add('POST', '/api/guest/leave', [GuestController::class, 'leave']); // 게스트 퇴장
$router->add('GET', '/api/me', [GuestController::class, 'me']); // 현재 세션 정보
$router->add('POST', '/api/realtime-ticket', [TicketController::class, 'issue']); // 실시간 티켓 발급
$router->add('POST', '/api/projects', [ProjectController::class, 'create']); // 작업실 직접 만들기(초대 코드 없이, 만든 사람이 관리자)
$router->add('POST', '/api/projects/{id}/rename', [ProjectController::class, 'rename']); // 작업실 이름 변경(관리자)
$router->add('POST', '/api/projects/{id}/delete', [ProjectController::class, 'delete']); // 작업실 삭제(관리자, 되돌릴 수 없음)
$router->add('GET', '/api/projects/{id}/boards', [BoardController::class, 'list']); // 보드 목록
$router->add('POST', '/api/projects/{id}/boards', [BoardController::class, 'create']); // 보드 생성
$router->add('GET', '/api/boards/{id}/snapshot', [BoardController::class, 'snapshot']); // 보드 스냅샷
$router->add('POST', '/api/boards/{id}/rename', [BoardController::class, 'rename']); // 보드 이름 변경(편집자 이상)
$router->add('POST', '/api/boards/{id}/delete', [BoardController::class, 'delete']); // 보드 삭제(관리자)
$router->add('GET', '/api/projects/{id}/members', [ProjectController::class, 'members']); // 참여자 목록
$router->add('GET', '/api/projects/{id}/tasks', [ProjectController::class, 'tasks']); // 공유 업무 목록(P1)
$router->add('GET', '/api/projects/{id}/analytics/summary', [AnalyticsController::class, 'summary']); // 작업실 SQL 통계
$router->add('GET', '/api/projects/{id}/analytics/dashboard', [AnalyticsController::class, 'dashboard']); // 분석 화면 조회
$router->add('POST', '/api/projects/{id}/imports/upload', [ImportController::class, 'upload']); // 세션 결합 파일 초안
$router->add('POST', '/api/projects/{id}/imports/preview', [ImportController::class, 'preview']); // 원본 경로 미리보기
$router->add('POST', '/api/projects/{id}/imports/validate', [ImportController::class, 'validate']); // 전체 행·중복 검증
$router->add('POST', '/api/projects/{id}/imports/commit', [ImportController::class, 'commit']); // 원자적 데이터셋 저장
$router->add('GET', '/api/projects/{id}/datasets', [ImportController::class, 'datasets']); // 저장 목록
$router->add('GET', '/api/projects/{id}/datasets/{datasetId}', [ImportController::class, 'detail']); // 자료 상세
$router->add('GET', '/api/projects/{id}/datasets/{datasetId}/rows', [ImportController::class, 'rows']); // 저장 행
$router->add('GET', '/api/projects/{id}/datasets/{datasetId}/chart', [ImportController::class, 'chart']); // 정확한 막대 집계
$router->add('GET', '/api/projects/{id}/datasets/{datasetId}/runs', [ImportController::class, 'runs']); // 자료 이력
$router->add('GET', '/api/projects/{id}/imports/runs', [ImportController::class, 'runs']); // 전체 가져오기 이력
$router->add('GET', '/api/projects/{id}/imports/runs/{runId}/quality', [ImportController::class, 'quality']); // 검사 스냅샷·저장 대조
$router->add('GET', '/api/projects/{id}/imports/runs/{runId}/quality/rows', [ImportController::class, 'qualityRows']); // 문제 행 교집합·페이지
$router->add('POST', '/api/projects/{id}/datasets/{datasetId}/delete', [ImportController::class, 'delete']); // 관리자 삭제
$router->add('GET', '/api/projects/{id}/invites', [InviteController::class, 'list']); // 초대 코드 목록(관리자)
$router->add('POST', '/api/projects/{id}/invites', [InviteController::class, 'create']); // 초대 코드 발급(관리자)
$router->add('POST', '/api/invites/{id}/revoke', [InviteController::class, 'revoke']); // 초대 코드 취소(관리자)
$router->add('POST', '/api/images', [ImageController::class, 'upload']); // 이미지 업로드
$router->add('GET', '/api/images/{id}', [ImageController::class, 'show']); // 이미지 반환

$router->dispatch(Request::fromGlobals()); // 요청 처리
