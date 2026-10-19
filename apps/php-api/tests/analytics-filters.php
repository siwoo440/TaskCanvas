<?php // 공통 필터의 실제 입력과 조건 검증
declare(strict_types=1); // 엄격한 자료형
require dirname(__DIR__) . '/src/ApiException.php'; // 입력 오류
require dirname(__DIR__) . '/src/AnalyticsFilters.php'; // 공통 필터
$filters = AnalyticsFilters::parse(['created_from' => '2024-02-29', 'status' => 'done', 'assignee_id' => 'unassigned']); // 윤일과 교집합
$where = AnalyticsFilters::where(17, $filters); // 작업실 제한
assert($where['params'] === [17, '2024-02-29 00:00:00', 'done']); // 실제 바인딩 순서
assert(str_contains($where['sql'], 't.assignee_id IS NULL')); // 미배정 조건
assert(AnalyticsFilters::parse([]) === ['created_from' => null, 'created_to' => null, 'status' => null, 'assignee_id' => null]); // 기존 무제한 조회
echo "PASS 공통 필터·윤일·바인딩·미배정\n"; // 검증 결과
