<?php // 업무 원본의 읽기 전용 통계
declare(strict_types=1); // 엄격한 자료형
final class TaskAnalytics // 공통 필터와 SQL 집계
{ // 통계 서비스 시작
    private const FILTERS = ['created_from', 'created_to', 'status', 'assignee_id']; // 허용 조건
    private static function filters(array $query): array // 필터 입력 검증
    { // 검증 시작
        foreach ($query as $key => $value) // 모든 쿼리 조건
        { // 조건 검사
            if (!in_array($key, self::FILTERS, true) || !is_string($value)) // 알 수 없는 조건 또는 배열
            { // 입력 거부
                throw new ApiException(400, 'INVALID_FILTER', '지원하지 않는 통계 필터이거나 값의 형식이 올바르지 않습니다.'); // 명확한 오류
            } // 입력 거부 끝
        } // 조건 검사 끝
        $filters = array_fill_keys(self::FILTERS, null); // 생략 조건의 일관된 응답
        foreach (['created_from', 'created_to'] as $key) // 생성일 범위
        { // 날짜 검사
            if (!array_key_exists($key, $query)) // 생략 날짜
            { // 생략 처리
                continue; // 기간 제한 없음
            } // 생략 끝
            $value = $query[$key]; // 날짜 원문
            if (preg_match('/\A[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}\z/D', $value) !== 1) // DB 날짜 범위와 형식
            { // 날짜 형식 오류
                throw new ApiException(400, 'INVALID_FILTER', '생성일은 1000~9999년의 YYYY-MM-DD 형식이어야 합니다.'); // 날짜 안내
            } // 형식 검사 끝
            $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, new DateTimeZone('Asia/Seoul')); // 서울 달력 날짜
            if ($date === false || $date->format('Y-m-d') !== $value) // 존재하지 않는 날짜
            { // 날짜 거부
                throw new ApiException(400, 'INVALID_FILTER', '실제 존재하는 생성일을 입력하세요.'); // 달력 오류
            } // 달력 검사 끝
            $filters[$key] = $value; // 검증한 날짜
        } // 날짜 검사 끝
        if ($filters['created_from'] !== null && $filters['created_to'] !== null && $filters['created_from'] > $filters['created_to']) // 역순 기간
        { // 범위 거부
            throw new ApiException(400, 'INVALID_FILTER', '시작일은 종료일보다 늦을 수 없습니다.'); // 기간 오류
        } // 기간 검사 끝
        if (array_key_exists('status', $query)) // 상태 조건 존재
        { // 상태 검증
            if (!in_array($query['status'], ['todo', 'doing', 'done'], true)) // 허용 상태 검사
            { // 상태 거부
                throw new ApiException(400, 'INVALID_FILTER', '상태는 todo·doing·done 중 하나여야 합니다.'); // 상태 안내
            } // 상태 거부 끝
            $filters['status'] = $query['status']; // 검증 상태
        } // 상태 조건 끝
        if (array_key_exists('assignee_id', $query)) // 담당자 조건 존재
        { // 담당자 검사
            $value = $query['assignee_id']; // 담당자 원문
            if ($value === 'unassigned') // 명시적 미배정 선택
            { // 미배정 조건
                $filters['assignee_id'] = $value; // NULL과 전체 선택 구분
            } // 미배정 끝
            else // 실제 게스트 식별자
            { // 정수 검사
                $id = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]); // 범위 초과도 거부
                if ($id === false || (string) $id !== $value) // 정규 양의 정수만 허용
                { // 담당자 거부
                    throw new ApiException(400, 'INVALID_FILTER', '담당자는 양의 정수 ID 또는 unassigned여야 합니다.'); // 입력 안내
                } // 담당자 검사 끝
                $filters['assignee_id'] = $id; // 정수 응답
            } // 정수 검사 끝
        } // 담당자 조건 끝
        return $filters; // 정규화한 조건
    } // 검증 끝
    private static function rate(int $done, int $total): float // 분모 0 보호 완료율
    { // 비율 계산
        return $total === 0 ? 0.0 : round($done * 100 / $total, 1); // 백분율 소수 첫째 자리
    } // 비율 끝
    public static function summary(int $projectId, array $query): array // 작업실 통계 구성
    { // 통계 시작
        $filters = self::filters($query); // 단일 공통 필터
        $today = new DateTimeImmutable('today', new DateTimeZone('Asia/Seoul')); // 요청 시점 서울 날짜
        $start = $today->format('Y-m-d H:i:s'); // 오늘 0시
        $tomorrow = $today->modify('+1 day')->format('Y-m-d H:i:s'); // 내일 0시
        $afterSoon = $today->modify('+4 days')->format('Y-m-d H:i:s'); // 3일 임박의 다음 날
        $params = [$start, $start, $tomorrow, $tomorrow, $afterSoon, $afterSoon, $projectId, $projectId]; // SQL 순서의 경계와 작업실
        $where = ['t.project_id = ?']; // 모든 집계의 작업실 범위
        if ($filters['created_from'] !== null) // 시작일 조건
        { // 시작 경계
            $where[] = 't.created_at >= ?'; // 인덱스 활용 가능한 비교
            $params[] = $filters['created_from'] . ' 00:00:00'; // 시작 날짜 포함
        } // 시작 조건 끝
        if ($filters['created_to'] !== null) // 종료일 조건
        { // 종료 경계
            $where[] = 't.created_at <= ?'; // 초 단위 DATETIME의 종료 비교
            $params[] = $filters['created_to'] . ' 23:59:59'; // 종료 날짜 포함
        } // 종료 조건 끝
        if ($filters['status'] !== null) // 상태 조건
        { // 상태 범위
            $where[] = 't.status = ?'; // 검증한 상태만 조회
            $params[] = $filters['status']; // 값 바인딩
        } // 상태 조건 끝
        if ($filters['assignee_id'] === 'unassigned') // 미배정 조건
        { // NULL 범위
            $where[] = 't.assignee_id IS NULL'; // 미배정만 선택
        } // 미배정 끝
        elseif ($filters['assignee_id'] !== null) // 담당 게스트 조건
        { // 사람 범위
            $where[] = 't.assignee_id = ?'; // 작업실 범위 안에서 담당자 선택
            $params[] = $filters['assignee_id']; // 정수 바인딩
        } // 담당 조건 끝
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
            . 'WHERE ' . implode(' AND ', $where) . ' GROUP BY t.assignee_id, g.display_name ORDER BY t.assignee_id IS NULL, t.assignee_id'; // 공통 조건과 안정적 순서
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
