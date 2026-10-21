<?php // 같은 읽기 시점의 대시보드
declare(strict_types=1); // 엄격한 자료형
final class AnalyticsDashboard // 기간과 페이지 조회
{ // 서비스 시작
    private static function normalizedFilters(array $query): array // 화면과 CSV 공통 조건
    { // 조건 시작
        $filters = AnalyticsFilters::parse($query); // 공통 검증
        $today = new DateTimeImmutable('today', new DateTimeZone('Asia/Seoul')); // 서울 기준일
        $end = $filters['created_to'] ?? $today->format('Y-m-d'); // 종료 기본값
        $endDate = new DateTimeImmutable($end, new DateTimeZone('Asia/Seoul')); // 종료 날짜
        $start = $filters['created_from'] ?? $endDate->modify('-29 days')->format('Y-m-d'); // 최근 30일
        $startDate = new DateTimeImmutable($start, new DateTimeZone('Asia/Seoul')); // 시작 날짜
        if ($start < '1000-01-01' || $start > $end || (int) $startDate->diff($endDate)->days >= 366) // 날짜 범위
        { // 범위 거부
            throw new ApiException(400, 'INVALID_FILTER', '조회 기간은 1000년 이후의 1~366일이어야 합니다.'); // 범위 안내
        } // 범위 거부 끝
        $filters['created_from'] = $start; // 실제 시작일
        $filters['created_to'] = $end; // 실제 종료일
        return $filters; // 확정 조건
    } // 조건 끝
    public static function get(int $projectId, array $query): array // 인증 후 조회 진입
    { // 조회 시작
        $pageValue = $query['page'] ?? '1'; // 페이지 기본값
        unset($query['page']); // 공통 조건 분리
        $page = is_string($pageValue) ? filter_var($pageValue, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) : false; // 안전한 정수
        if ($page === false || (string) $page !== $pageValue) // 비정규 입력
        { // 입력 거부
            throw new ApiException(400, 'INVALID_FILTER', '페이지는 양의 정수여야 합니다.'); // 페이지 안내
        } // 입력 거부 끝
        $filters = self::normalizedFilters($query); // 공통 검증과 기본 기간
        $today = new DateTimeImmutable('today', new DateTimeZone('Asia/Seoul')); // 요청의 단일 기준일
        $pdo = Database::pdo(); // 동일 연결
        $pdo->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); // 다음 트랜잭션 격리
        $pdo->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'); // 일관된 읽기
        try // 스냅샷 조회
        { // 조회 본문
            $data = self::read($projectId, $filters, $page, $today); // 모든 결과
            $pdo->commit(); // 읽기 종료
            return $data; // 일관된 응답
        } // 조회 본문 끝
        catch (Throwable $error) // SQL 또는 구성 오류
        { // 실패 정리
            if ($pdo->inTransaction()) // 활성 트랜잭션
            { // 읽기 해제
                $pdo->rollBack(); // 예외 후 복구
            } // 읽기 해제 끝
            throw $error; // 기존 오류 처리
        } // 실패 정리 끝
    } // 조회 진입 끝
    public static function allRows(int $projectId, array $query): array // CSV 전체 행
    { // 전체 조회 시작
        $filters = self::normalizedFilters($query); // 화면과 같은 조건
        return ['filters' => $filters, 'rows' => self::chunks($projectId, $filters)]; // 제한된 메모리의 공통 원본
    } // 전체 조회 끝
    private static function chunks(int $projectId, array $filters): Generator // CSV 분할 조회
    { // 분할 시작
        $offset = 0; // 첫 위치
        do // 같은 스냅샷의 전체 순회
        { // 묶음 조회
            $rows = self::taskRows($projectId, $filters, 500, $offset); // 최대 500개 보관
            foreach ($rows as $row) // 개별 업무 전달
            { // 행 전달
                yield $row; // 소비 시 한 행 반환
            } // 행 전달 끝
            $offset += count($rows); // 다음 위치
        } while (count($rows) === 500); // 마지막 묶음까지 순회
    } // 분할 끝
    private static function taskRows(int $projectId, array $filters, ?int $limit, int $offset): array // 상세 업무 공통 조회
    { // 행 조회 시작
        $where = AnalyticsFilters::where($projectId, $filters); // 동일 조건
        $sql = 'SELECT t.task_id,t.title,t.status,t.assignee_id,g.display_name AS assignee_name,t.due_at,t.created_at,' // 업무 표시 필드
            . '(SELECT MIN(bo.board_id) FROM board_objects bo JOIN boards b ON b.board_id=bo.board_id WHERE bo.task_id=t.task_id AND bo.type=\'task\' AND b.project_id=t.project_id) AS board_id,' // 같은 작업실의 원본 보드
            . 'COALESCE(c.total,0) AS item_total,COALESCE(c.done,0) AS item_done FROM tasks t LEFT JOIN guests g ON g.guest_id=t.assignee_id ' // 담당자 이름
            . 'LEFT JOIN (SELECT i.task_id,COUNT(*) AS total,SUM(CASE WHEN i.is_done=1 THEN 1 ELSE 0 END) AS done FROM task_items i JOIN tasks scope ON scope.task_id=i.task_id WHERE scope.project_id=? GROUP BY i.task_id) c ON c.task_id=t.task_id ' // 항목별 중복 제거
            . 'WHERE ' . $where['sql'] . ' ORDER BY t.created_at DESC,t.task_id DESC'; // 안정된 전체 순서
        if ($limit !== null) // 화면 페이지 제한
        { // 제한 추가
            $sql .= ' LIMIT ' . $limit . ' OFFSET ' . $offset; // 검증된 정수 위치
        } // 제한 끝
        $rows = Database::all($sql, array_merge([$projectId], $where['params'])); // 상세 원본
        foreach ($rows as &$row) // 응답 자료형
        { // 행 구성
            $row['task_id'] = (int) $row['task_id']; // 업무 ID
            $row['board_id'] = $row['board_id'] === null ? null : (int) $row['board_id']; // 삭제된 보드 보존
            $row['assignee_id'] = $row['assignee_id'] === null ? null : (int) $row['assignee_id']; // 미배정 보존
            $itemTotal = (int) $row['item_total']; // 항목 수
            $itemDone = (int) $row['item_done']; // 완료 항목
            $row['checklist'] = ['total' => $itemTotal, 'done' => $itemDone, 'completion_rate' => $itemTotal === 0 ? 0.0 : round($itemDone * 100 / $itemTotal, 1)]; // 행 진행률
            unset($row['item_total'], $row['item_done']); // 내부 필드 제거
        } // 행 구성 끝
        unset($row); // 참조 해제
        return $rows; // 상세 행
    } // 행 조회 끝
    public static function read(int $projectId, array $filters, int $page, DateTimeImmutable $today): array // 열린 스냅샷 읽기
    { // 읽기 시작
        $summary = TaskAnalytics::aggregate($projectId, $filters, $today); // 공통 집계
        $where = AnalyticsFilters::where($projectId, $filters); // 동일 업무 조건
        $dailyRows = Database::all('SELECT DATE(t.created_at) AS date, COUNT(*) AS count FROM tasks t WHERE ' . $where['sql'] . ' GROUP BY DATE(t.created_at)', $where['params']); // 일별 원본 수
        $counts = array_column($dailyRows, 'count', 'date'); // 날짜별 값
        $daily = []; // 빈 날짜 포함 결과
        $date = new DateTimeImmutable($filters['created_from'], new DateTimeZone('Asia/Seoul')); // 기간 시작
        $endDate = new DateTimeImmutable($filters['created_to'], new DateTimeZone('Asia/Seoul')); // 날짜 객체 경계
        while ($date <= $endDate) // 9999년 이후 문자열 역전 방지
        { // 날짜 추가
            $key = $date->format('Y-m-d'); // 날짜 키
            $daily[] = ['date' => $key, 'count' => (int) ($counts[$key] ?? 0)]; // 0건 채우기
            $date = $date->modify('+1 day'); // 다음 날짜
        } // 날짜 추가 끝
        $trendRows = Database::all('SELECT DATE(h.changed_at) AS date,h.to_status AS status,COUNT(*) AS count FROM task_status_history h JOIN tasks t ON t.task_id=h.task_id WHERE ' . $where['sql'] . ' AND h.changed_at>=? AND h.changed_at<=? GROUP BY DATE(h.changed_at),h.to_status', array_merge($where['params'], [$filters['created_from'] . ' 00:00:00', $filters['created_to'] . ' 23:59:59'])); // 기록된 실제 상태 변화
        $trendCounts = []; // 날짜·상태 색인
        foreach ($trendRows as $trendRow) // 실제 이력 순회
        { // 색인 구성
            $trendCounts[$trendRow['date']][$trendRow['status']] = (int) $trendRow['count']; // 상태별 건수
        } // 색인 끝
        $statusTrend = []; // 빈 날짜 포함 추이
        $trendDate = new DateTimeImmutable($filters['created_from'], new DateTimeZone('Asia/Seoul')); // 추이 시작
        while ($trendDate <= $endDate) // 모든 날짜
        { // 날짜 추가
            $key = $trendDate->format('Y-m-d'); // 날짜 키
            $statusTrend[] = ['date' => $key, 'todo' => $trendCounts[$key]['todo'] ?? 0, 'doing' => $trendCounts[$key]['doing'] ?? 0, 'done' => $trendCounts[$key]['done'] ?? 0]; // 기록된 변화만 집계
            $trendDate = $trendDate->modify('+1 day'); // 다음 날짜
        } // 날짜 추가 끝
        $options = Database::all('SELECT g.guest_id AS assignee_id, g.display_name FROM guests g JOIN (SELECT guest_id FROM project_members WHERE project_id = ? UNION SELECT assignee_id AS guest_id FROM tasks WHERE project_id = ? AND assignee_id IS NOT NULL) scope ON scope.guest_id = g.guest_id ORDER BY g.guest_id', [$projectId, $projectId]); // 전체 작업실의 선택지
        foreach ($options as &$option) // 공개 자료형
        { // 식별자 변환
            $option['assignee_id'] = (int) $option['assignee_id']; // 정수 ID
        } // 식별자 변환 끝
        unset($option); // 참조 해제
        $total = $summary['tasks']['total']; // 같은 원본의 건수
        $pages = max(1, (int) ceil($total / 20)); // 빈 결과도 1페이지
        $page = min($page, $pages); // 곱셈 전 안전한 보정
        $offset = ($page - 1) * 20; // 작은 범위의 시작 위치
        $rows = self::taskRows($projectId, $filters, 20, $offset); // 현재 페이지
        return [ // 공개 응답
            'project_id' => $projectId, // 범위 ID
            'time_zone' => 'Asia/Seoul', // 날짜 기준
            'as_of_date' => $today->format('Y-m-d'), // 마감 기준일
            'filters' => $filters, // 실제 적용 조건
            'summary' => array_intersect_key($summary, array_flip(['tasks', 'assignees', 'due', 'checklist'])), // 공통 지표
            'daily_created' => $daily, // 날짜별 생성 수
            'status_trend' => $statusTrend, // 실제 상태 변경 추이
            'assignee_options' => $options, // 범위 내 선택지
            'pagination' => ['page' => $page, 'page_size' => 20, 'total' => $total, 'total_pages' => $pages], // 페이지 정보
            'rows' => $rows, // 업무 표
        ]; // 응답 끝
    } // 읽기 끝
} // 서비스 끝
