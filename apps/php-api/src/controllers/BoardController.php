<?php
// 프로젝트 보드 목록·생성·스냅샷
declare(strict_types=1);

final class BoardController
{
    public function list(Request $request): void
    {
        $guest = Auth::requireGuest($request); // 현재 게스트
        $projectId = $request->params['id']; // 프로젝트 ID
        $role = Auth::requireRole((int) $guest['guest_id'], $projectId, 'viewer'); // 참여자 확인
        $boards = Database::all('SELECT board_id, title, created_at, updated_at FROM boards WHERE project_id = ? ORDER BY board_id', [$projectId]); // 보드 목록 조회
        Response::ok(['project_id' => $projectId, 'role' => $role, 'boards' => array_map([$this, 'formatBoard'], $boards)]); // 목록 응답
    }

    public function create(Request $request): void
    {
        Auth::requireMutationHeader($request); // CSRF 헤더 검사
        $guest = Auth::requireGuest($request); // 현재 게스트
        $projectId = $request->params['id']; // 프로젝트 ID
        Auth::requireRole((int) $guest['guest_id'], $projectId, 'editor'); // 편집자 이상 확인
        $title = $request->string('title', 120); // 보드 이름
        if ($title === '')
        {
            throw new ApiException(400, 'BAD_REQUEST', '보드 이름을 입력해야 합니다.'); // 필수값 검사
        }
        Database::run('INSERT INTO boards (project_id, title) VALUES (?, ?)', [$projectId, $title]); // 보드 생성
        $board = Database::one('SELECT board_id, title, created_at, updated_at FROM boards WHERE board_id = ?', [Database::lastId()]); // 생성 결과 조회
        Response::ok(['board' => $this->formatBoard($board)], 201); // 생성 응답
    }

    public function rename(Request $request): void
    {
        Auth::requireMutationHeader($request); // CSRF 헤더 검사
        $guest = Auth::requireGuest($request); // 현재 게스트
        $boardId = $request->params['id']; // 보드 ID
        $projectId = Auth::boardProject($boardId); // 보드의 프로젝트(없으면 404)
        Auth::requireRole((int) $guest['guest_id'], $projectId, 'editor'); // 편집자 이상 확인
        $title = $request->string('title', 120); // 새 이름
        if ($title === '')
        {
            throw new ApiException(400, 'BAD_REQUEST', '보드 이름을 입력해야 합니다.'); // 필수값 검사
        }
        Database::run('UPDATE boards SET title = ? WHERE board_id = ?', [$title, $boardId]); // 이름 변경
        $board = Database::one('SELECT board_id, title, created_at, updated_at FROM boards WHERE board_id = ?', [$boardId]); // 변경 결과 조회
        Response::ok(['board' => $this->formatBoard($board)]); // 변경 응답(보드 안 참여자에게는 실시간 서버가 알림)
    }

    public function delete(Request $request): void
    {
        Auth::requireMutationHeader($request); // CSRF 헤더 검사
        $guest = Auth::requireGuest($request); // 현재 게스트
        $boardId = $request->params['id']; // 보드 ID
        $projectId = Auth::boardProject($boardId); // 보드의 프로젝트(없으면 404)
        Auth::requireRole((int) $guest['guest_id'], $projectId, 'admin'); // 삭제는 관리자만
        Database::run('DELETE FROM boards WHERE board_id = ?', [$boardId]); // 보드 삭제(객체·연결선·티켓은 외래키로 함께 삭제, 이미지 파일·공유 업무 원본은 유지)
        Response::ok(['deleted' => true, 'board_id' => $boardId]); // 삭제 응답(보드 안 참여자에게는 실시간 서버가 알림)
    }

    public function snapshot(Request $request): void
    {
        $guest = Auth::requireGuest($request); // 현재 게스트
        $boardId = $request->params['id']; // 보드 ID
        $projectId = Auth::boardProject($boardId); // 보드의 프로젝트
        $role = Auth::requireRole((int) $guest['guest_id'], $projectId, 'viewer'); // 참여자 확인
        $rows = Database::all(
            'SELECT object_id, task_id, type, x, y, width, height, payload_json, style_json, version, updated_at
               FROM board_objects WHERE board_id = ? ORDER BY object_id',
            [$boardId]
        ); // 저장 완료 객체 조회
        $objects = array_map(static fn(array $r) => [
            'object_id' => (int) $r['object_id'],
            'task_id' => $r['task_id'] === null ? null : (int) $r['task_id'],
            'type' => $r['type'],
            'x' => (float) $r['x'],
            'y' => (float) $r['y'],
            'width' => (float) $r['width'],
            'height' => (float) $r['height'],
            'payload' => $r['payload_json'] === null ? null : json_decode($r['payload_json'], true),
            'style' => $r['style_json'] === null ? null : json_decode($r['style_json'], true),
            'version' => (int) $r['version'],
            'updated_at' => $r['updated_at'],
        ], $rows); // 응답 형식 변환
        $links = array_map(static fn(array $l) => [
            'link_id' => (int) $l['link_id'],
            'board_id' => $boardId,
            'from_object_id' => (int) $l['from_object_id'],
            'to_object_id' => (int) $l['to_object_id'],
            'label' => $l['label'],
        ], Database::all('SELECT link_id, from_object_id, to_object_id, label FROM board_links WHERE board_id = ? ORDER BY link_id', [$boardId])); // 연결선 목록(P1)
        Response::ok(['board_id' => $boardId, 'project_id' => $projectId, 'role' => $role, 'objects' => $objects, 'links' => $links]); // 스냅샷 응답
    }

    private function formatBoard(array $b): array
    {
        return ['board_id' => (int) $b['board_id'], 'title' => $b['title'], 'created_at' => $b['created_at'], 'updated_at' => $b['updated_at']]; // 보드 응답 형식
    }
}
