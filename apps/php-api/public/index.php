<?php
// TaskCanvas PHP API 프런트 컨트롤러
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php'; // 공통 초기화 로드

$router = new Router(); // 라우터 생성

$router->add('GET', '/api/health', [SystemController::class, 'health']); // 상태 확인
$router->add('POST', '/api/guest/join', [GuestController::class, 'join']); // 게스트 입장
$router->add('POST', '/api/guest/leave', [GuestController::class, 'leave']); // 게스트 퇴장
$router->add('GET', '/api/me', [GuestController::class, 'me']); // 현재 세션 정보
$router->add('POST', '/api/realtime-ticket', [TicketController::class, 'issue']); // 실시간 티켓 발급
$router->add('GET', '/api/projects/{id}/boards', [BoardController::class, 'list']); // 보드 목록
$router->add('POST', '/api/projects/{id}/boards', [BoardController::class, 'create']); // 보드 생성
$router->add('GET', '/api/boards/{id}/snapshot', [BoardController::class, 'snapshot']); // 보드 스냅샷

$router->dispatch(Request::fromGlobals()); // 요청 처리
