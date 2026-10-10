<?php
// 작업실(프로젝트) 직접 만들기·이름 변경, 참여자·공유 업무 조회
declare(strict_types=1);

final class ProjectController
{
    public const FIRST_BOARD = '첫 보드'; // 직접 만든 작업실에 처음부터 넣어 두는 보드 이름

    // 초대 코드 없이 작업실을 직접 만든다. 만든 사람은 관리자가 되고 바로 입장한 상태가 된다
    public function create(Request $request): void
    {
        Auth::requireMutationHeader($request); // CSRF 헤더 검사
        if (!Env::bool('ALLOW_WORKSPACE_CREATE'))
        {
            throw new ApiException(403, 'CREATE_DISABLED', '이 서버에서는 작업실을 직접 만들 수 없습니다. 관리자에게 초대 코드를 받아 입장하세요.'); // 서버 설정으로 꺼 둠
        }
        Throttle::check($request->clientIp()); // 요청 제한 검사(입장 시도와 함께 셈)
        $name = $request->string('display_name', 60); // 만든 사람의 표시 이름
        $title = $request->string('title', 120); // 작업실 이름
        if ($name === '' || $title === '')
        {
            throw new ApiException(400, 'BAD_REQUEST', '이름과 작업실 이름을 모두 입력해야 합니다.'); // 필수값 검사
        }

        $pdo = Database::pdo(); // 트랜잭션용 PDO
        $pdo->beginTransaction(); // 게스트·작업실·보드·코드는 함께 만들어지거나 함께 취소
        try
        {
            Database::run('INSERT INTO guests (display_name) VALUES (?)', [$name]); // 게스트 생성
            $guestId = Database::lastId(); // 새 게스트 ID
            Database::run('INSERT INTO projects (title, created_by) VALUES (?, ?)', [$title, $guestId]); // 작업실 생성(만든 사람 기록)
            $projectId = Database::lastId(); // 새 작업실 ID
            Database::run('INSERT INTO project_members (project_id, guest_id, role) VALUES (?, ?, ?)', [$projectId, $guestId, 'admin']); // 만든 사람은 관리자
            Database::run('INSERT INTO boards (project_id, title) VALUES (?, ?)', [$projectId, self::FIRST_BOARD]); // 바로 쓸 수 있게 보드 하나
            $boardId = Database::lastId(); // 첫 보드 ID
            $owner = Invite::issueOwner($projectId); // 만든 사람이 나중에 다시 들어올 때 쓰는 재입장 전용 코드
            Auth::issueSession($guestId); // 세션 쿠키 발급
            $pdo->commit(); // 확정
        }
        catch (Throwable $e)
        {
            $pdo->rollBack(); // 실패 시 전부 취소
            throw $e;
        }
        Throttle::record($request->clientIp(), true); // 시도 기록(짧은 시간에 작업실을 계속 만드는 것을 제한)

        Response::ok([
            'guest' => ['guest_id' => $guestId, 'display_name' => $name],
            'project' => ['project_id' => $projectId, 'title' => $title, 'role' => 'admin'],
            'board' => ['board_id' => $boardId, 'title' => self::FIRST_BOARD],
            'owner_code' => $owner['code'],
            'owner_code_days' => $owner['days'],
        ], 201); // 재입장 코드 원문은 이 응답에서만 한 번 전달(세션 토큰은 쿠키에만)
    }

    public function rename(Request $request): void
    {
        Auth::requireMutationHeader($request); // CSRF 헤더 검사
        $guest = Auth::requireGuest($request); // 현재 게스트
        $projectId = $request->params['id']; // 작업실 ID
        Auth::requireRole((int) $guest['guest_id'], $projectId, 'admin'); // 관리자만
        $title = $request->string('title', 120); // 새 이름
        if ($title === '')
        {
            throw new ApiException(400, 'BAD_REQUEST', '작업실 이름을 입력해야 합니다.'); // 필수값 검사
        }
        Database::run('UPDATE projects SET title = ? WHERE project_id = ?', [$title, $projectId]); // 이름 변경
        Response::ok(['project' => ['project_id' => $projectId, 'title' => $title]]); // 변경 응답(다른 참여자는 다음에 작업실을 열 때 새 이름을 봄)
    }

    public function members(Request $request): void
    {
        $guest = Auth::requireGuest($request); // 현재 게스트
        $projectId = $request->params['id']; // 프로젝트 ID
        Auth::requireRole((int) $guest['guest_id'], $projectId, 'viewer'); // 참여자 확인
        $rows = Database::all(
            'SELECT g.guest_id, g.display_name, m.role FROM project_members m
               JOIN guests g ON g.guest_id = m.guest_id
              WHERE m.project_id = ? ORDER BY m.joined_at',
            [$projectId]
        ); // 참여자 목록 조회
        Response::ok(['project_id' => $projectId, 'members' => array_map(static fn(array $r) => ['guest_id' => (int) $r['guest_id'], 'display_name' => $r['display_name'], 'role' => $r['role']], $rows)]); // 목록 응답
    }

    public function tasks(Request $request): void
    {
        $guest = Auth::requireGuest($request); // 현재 게스트
        $projectId = $request->params['id']; // 프로젝트 ID
        Auth::requireRole((int) $guest['guest_id'], $projectId, 'viewer'); // 참여자 확인
        $rows = Database::all(
            'SELECT t.task_id, t.project_id, t.title, t.description, t.status, t.assignee_id, g.display_name AS assignee_name, t.due_at, t.version
               FROM tasks t LEFT JOIN guests g ON g.guest_id = t.assignee_id
              WHERE t.project_id = ? ORDER BY t.task_id',
            [$projectId]
        ); // 업무 원본 목록 조회
        $items = Database::all(
            'SELECT i.task_id, i.item_id, i.title, i.is_done
               FROM task_items i JOIN tasks t ON t.task_id = i.task_id
              WHERE t.project_id = ? ORDER BY i.item_id',
            [$projectId]
        ); // 프로젝트의 모든 체크리스트 항목(만든 순서)
        $checklists = []; // task_id → 항목 목록
        foreach ($items as $item)
        {
            $checklists[(int) $item['task_id']][] = ['item_id' => (int) $item['item_id'], 'title' => $item['title'], 'done' => (int) $item['is_done'] === 1]; // 업무별로 묶음
        }
        Response::ok(['project_id' => $projectId, 'tasks' => array_map(static fn(array $r) => self::formatTask($r, $checklists[(int) $r['task_id']] ?? []), $rows)]); // 목록 응답
    }

    public static function formatTask(array $r, array $checklist = []): array
    {
        return [
            'task_id' => (int) $r['task_id'],
            'project_id' => (int) $r['project_id'],
            'title' => $r['title'],
            'description' => $r['description'],
            'status' => $r['status'],
            'assignee_id' => $r['assignee_id'] === null ? null : (int) $r['assignee_id'],
            'assignee_name' => $r['assignee_name'],
            'due_at' => $r['due_at'] === null ? null : substr((string) $r['due_at'], 0, 10),
            'version' => (int) $r['version'],
            'checklist' => $checklist,
        ]; // 실시간 서버와 같은 업무 응답 형식(checklist: 세부 항목 [{item_id, title, done}])
    }
}
