<?php // 공통 분석 필터
declare(strict_types=1); // 엄격한 자료형
final class AnalyticsFilters // 검증과 조건 조립
{ // 필터 시작
    private const FILTERS = ['created_from', 'created_to', 'status', 'assignee_id']; // 허용 조건
    public static function parse(array $query): array // 필터 입력 검증
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
    public static function where(int $projectId, array $filters): array // 공통 SQL 조건
    { // 조건 시작
        $params = [$projectId]; // 작업실 바인딩
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
        return ['sql' => implode(' AND ', $where), 'params' => $params]; // 조건과 바인딩
    } // 조건 끝
} // 필터 끝
