<?php
// 프로젝트 참여자·공유 업무 조회 (P1: 여러 보드가 같은 업무 원본을 참조)
declare(strict_types=1);

final class ProjectController
{
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
        Response::ok(['project_id' => $projectId, 'tasks' => array_map([self::class, 'formatTask'], $rows)]); // 목록 응답
    }

    public static function formatTask(array $r): array
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
        ]; // 실시간 서버와 같은 업무 응답 형식
    }
}
