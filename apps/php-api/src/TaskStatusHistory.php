<?php // 업무 상태 이력 서비스
declare(strict_types=1); // 엄격한 자료형
final class TaskStatusHistory // 멱등 상태 기록
{ // 서비스 시작
    private const STATUSES = ['todo', 'doing', 'done']; // 허용 상태
    public static function record(int $taskId, string $before, string $after, array $actor, string $requestId, ?DateTimeImmutable $changedAt = null): void // 상태 변경 기록
    { // 기록 시작
        if ($taskId < 1 || !in_array($before, self::STATUSES, true) || !in_array($after, self::STATUSES, true)) // 대상과 상태 검사
        { // 입력 거부
            throw new InvalidArgumentException('상태 이력 입력이 올바르지 않습니다.'); // 잘못된 내부 호출
        } // 입력 거부 끝
        if ($before === $after) // 실제 변경 없음
        { // 기록 생략
            return; // 불필요한 이력 차단
        } // 기록 생략 끝
        if ($requestId === '' || strlen($requestId) > 64 || preg_match('/\A[\x21-\x7E]+\z/D', $requestId) !== 1) // 안전한 멱등 키
        { // 요청 키 거부
            throw new InvalidArgumentException('상태 이력 요청 ID가 올바르지 않습니다.'); // 잘못된 내부 호출
        } // 요청 키 거부 끝
        $task = Database::one('SELECT project_id FROM tasks WHERE task_id = ?', [$taskId]); // 실제 작업실 조회
        if ($task === null) // 없는 업무
        { // 대상 거부
            throw new InvalidArgumentException('상태 이력 대상 업무가 없습니다.'); // 고아 이력 차단
        } // 대상 거부 끝
        $guestId = isset($actor['guest_id']) ? (int) $actor['guest_id'] : null; // 게스트 행위자
        $userId = isset($actor['user_id']) ? (int) $actor['user_id'] : null; // 회원 행위자
        $time = ($changedAt ?? new DateTimeImmutable('now', new DateTimeZone('Asia/Seoul')))->setTimezone(new DateTimeZone('Asia/Seoul'))->format('Y-m-d H:i:s'); // 서울 변경 시각
        $statement = Database::run('INSERT IGNORE INTO task_status_history (project_id,task_id,from_status,to_status,actor_guest_id,actor_user_id,request_id,changed_at) VALUES (?,?,?,?,?,?,?,?)', [(int) $task['project_id'], $taskId, $before, $after, $guestId, $userId, $requestId, $time]); // 멱등 저장
        if ($statement->rowCount() === 1) // 새 기록
        { // 기록 완료
            return; // 충돌 검사 생략
        } // 기록 완료 끝
        $existing = Database::one('SELECT task_id,from_status,to_status FROM task_status_history WHERE project_id=? AND request_id=?', [(int) $task['project_id'], $requestId]); // 기존 요청
        if ($existing === null || (int) $existing['task_id'] !== $taskId || $existing['from_status'] !== $before || $existing['to_status'] !== $after) // 다른 변경과 충돌
        { // 충돌 거부
            throw new LogicException('상태 이력 요청 ID가 다른 변경에 사용됐습니다.'); // 조용한 이력 누락 방지
        } // 충돌 거부 끝
    } // 기록 끝
} // 서비스 끝
