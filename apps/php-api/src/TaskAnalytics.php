<?php // 업무 원본의 읽기 전용 통계
declare(strict_types=1); // 엄격한 자료형
final class TaskAnalytics // 공통 필터와 SQL 집계
{ // 통계 서비스 시작
    private static function rate(int $done, int $total): float // 분모 0 보호 완료율
    { // 비율 계산
        return $total === 0 ? 0.0 : round($done * 100 / $total, 1); // 백분율 소수 첫째 자리
    } // 비율 끝
    public static function summary(int $projectId, array $query): array // 작업실 통계 구성
    { // 통계 시작
        $filters = AnalyticsFilters::parse($query); // 단일 공통 필터
        $today = new DateTimeImmutable('today', new DateTimeZone('Asia/Seoul')); // 요청 시점 서울 날짜
        return self::aggregate($projectId, $filters, $today); // 고정 기준일 전달
    } // 공개 조회 끝
    public static function aggregate(int $projectId, array $filters, DateTimeImmutable $today): array // 정규화 조건 집계
    { // 집계 시작
        $start = $today->format('Y-m-d H:i:s'); // 오늘 0시
        $tomorrow = $today->modify('+1 day')->format('Y-m-d H:i:s'); // 내일 0시
        $afterSoon = $today->modify('+4 days')->format('Y-m-d H:i:s'); // 3일 임박의 다음 날
        $params = [$start, $start, $tomorrow, $tomorrow, $afterSoon, $afterSoon, $projectId]; // SQL 순서의 경계와 작업실
        $where = AnalyticsFilters::where($projectId, $filters); // 공통 조건
        $params = array_merge($params, $where['params']); // 조건 바인딩 결합
        $sql = 'SELECT t.assignee_id, g.display_name, COUNT(*) AS total, ' // 담당자별 업무 원본 개수
            . "SUM(CASE WHEN t.status = 'todo' THEN 1 ELSE 0 END) AS todo, " // 할 일 수
            . "SUM(CASE WHEN t.status = 'doing' THEN 1 ELSE 0 END) AS doing, " // 진행 중 수
            . "SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done, " // 완료 수
            . "SUM(CASE WHEN t.status NOT IN ('todo','doing','done') THEN 1 ELSE 0 END) AS other, " // 기존 알 수 없는 상태 보존
            . "SUM(CASE WHEN t.status <> 'done' AND t.due_at < ? THEN 1 ELSE 0 END) AS overdue, " // 미완료 기한 초과
            . "SUM(CASE WHEN t.status <> 'done' AND t.due_at >= ? AND t.due_at < ? THEN 1 ELSE 0 END) AS today, " // 오늘 마감
            . "SUM(CASE WHEN t.status <> 'done' AND t.due_at >= ? AND t.due_at < ? THEN 1 ELSE 0 END) AS soon, " // 내일부터 3일 이내
            . "SUM(CASE WHEN t.status <> 'done' AND t.due_at >= ? THEN 1 ELSE 0 END) AS later, " // 4일 이후
            . 'SUM(CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END) AS no_due, ' // 상태 무관 마감 없음
            . "SUM(CASE WHEN t.status = 'done' AND t.due_at IS NOT NULL THEN 1 ELSE 0 END) AS closed, " // 마감 있는 완료 업무
            . 'SUM(COALESCE(c.item_total,0)) AS item_total, SUM(COALESCE(c.item_done,0)) AS item_done ' // 항목의 독립 합계
            . 'FROM tasks t LEFT JOIN guests g ON g.guest_id = t.assignee_id ' // 이름이 아닌 ID 기준 그룹
            . 'LEFT JOIN (SELECT i.task_id, COUNT(*) AS item_total, SUM(CASE WHEN i.is_done = 1 THEN 1 ELSE 0 END) AS item_done FROM task_items i JOIN tasks scope ON scope.task_id = i.task_id WHERE scope.project_id = ? GROUP BY i.task_id) c ON c.task_id = t.task_id ' // 먼저 업무별 항목을 한 행으로 축약
            . 'WHERE ' . $where['sql'] . ' GROUP BY t.assignee_id, g.display_name ORDER BY t.assignee_id IS NULL, t.assignee_id'; // 공통 조건과 안정적 순서
        $rows = Database::all($sql, $params); // 한 문장의 일관된 DB 스냅샷
        $tasks = array_fill_keys(['total', 'todo', 'doing', 'done', 'other'], 0); // 빈 업무 집계
        $due = array_fill_keys(['overdue', 'today', 'soon', 'later', 'none', 'closed'], 0); // 배타적 마감 분류
        $checklist = ['total' => 0, 'done' => 0]; // 빈 체크리스트
        $assignees = []; // 실제 업무가 있는 담당자 목록
        foreach ($rows as $row) // SQL 그룹 합산
        { // 응답 구성
            foreach (array_keys($tasks) as $field) // 업무 카운터
            { // 카운터 합산
                $tasks[$field] += (int) $row[$field]; // SQL 정수 변환
            } // 업무 합산 끝
            foreach (array_keys($due) as $field) // 마감 카운터
            { // 마감 합산
                $due[$field] += (int) $row[$field === 'none' ? 'no_due' : $field]; // 마감 없음 별칭 매핑
            } // 마감 합산 끝
            $checklist['total'] += (int) $row['item_total']; // 전체 항목
            $checklist['done'] += (int) $row['item_done']; // 완료 항목
            $assignees[] = [ // 담당자별 공개 결과
                'assignee_id' => $row['assignee_id'] === null ? null : (int) $row['assignee_id'], // 미배정 ID는 NULL
                'display_name' => $row['display_name'] ?? '미배정', // 안전한 데이터 이름
                'total' => (int) $row['total'], // 담당 업무 수
                'done' => (int) $row['done'], // 담당 완료 수
                'completion_rate' => self::rate((int) $row['done'], (int) $row['total']), // 담당 완료율
            ]; // 담당 결과 끝
        } // 응답 구성 끝
        $tasks['completion_rate'] = self::rate($tasks['done'], $tasks['total']); // 전체 업무 완료율
        $checklist['completion_rate'] = self::rate($checklist['done'], $checklist['total']); // 항목 기준 완료율
        return [ // 차트 화면에서 재사용할 계약
            'project_id' => $projectId, // 작업실 식별
            'time_zone' => 'Asia/Seoul', // 날짜 해석 기준
            'as_of_date' => $today->format('Y-m-d'), // 마감 분류 기준일
            'filters' => $filters, // 적용한 실제 필터
            'tasks' => $tasks, // 업무 KPI와 상태 분포
            'assignees' => $assignees, // 담당자별 업무량
            'due' => $due, // 마감 분류
            'checklist' => $checklist, // 체크리스트 진행률
        ]; // 결과 반환
    } // 통계 끝
} // 서비스 끝
