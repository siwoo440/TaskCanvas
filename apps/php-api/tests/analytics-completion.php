<?php // 33일차 실제 분석·CSV 검증
declare(strict_types=1); // 엄격한 자료형
require __DIR__ . '/import-test-support.php'; // 고유 DB 수명
ob_start(); // 검사 로그와 다운로드 헤더 분리
$mode = $argv[1] ?? 'history'; // 실행 범위
ImportTest::database(static function (PDO $pdo) use ($mode): void // 운영 자료와 분리
{ // 검사 시작
    Database::run("INSERT INTO guests (display_name) VALUES ('담당자')"); // 담당자 자료
    Database::run("INSERT INTO projects (title) VALUES ('통계'),('외부')"); // 작업실 격리
    Database::run("INSERT INTO boards (project_id,title) VALUES (1,'원본'),(2,'외부 보드')"); // 보드 자료
    Database::run("INSERT INTO tasks (project_id,title,status,assignee_id,created_at) VALUES (1,'기존 완료','done',1,'2026-10-20 12:00:00'),(1,'진행 업무','doing',NULL,'2026-10-20 12:00:00'),(2,'외부','done',1,'2026-10-20 12:00:00')"); // 기준 업무
    $filters = ['created_from' => '2026-10-20', 'created_to' => '2026-10-21']; // 공통 기간
    if ($mode === 'history') // 상태 추이 검사
    { // 이력 검사 시작
        TaskStatusHistory::record(1, 'todo', 'done', ['guest_id' => 1], 'done-1', new DateTimeImmutable('2026-10-21 00:00:00+09:00')); // 자정 포함
        TaskStatusHistory::record(2, 'todo', 'doing', ['guest_id' => 1], 'doing-1', new DateTimeImmutable('2026-10-20 23:59:59+09:00')); // 전날 끝
        TaskStatusHistory::record(3, 'todo', 'done', ['guest_id' => 1], 'foreign-1', new DateTimeImmutable('2026-10-21 12:00:00+09:00')); // 타 작업실 제외
        Database::run("INSERT INTO board_objects (board_id,task_id,type) VALUES (1,1,'task'),(2,2,'task')"); // 잘못된 교차 참조 포함
        $data = AnalyticsDashboard::get(1, $filters); // 실제 집계
        ImportTest::same($data['status_trend'], [['date' => '2026-10-20', 'todo' => 0, 'doing' => 1, 'done' => 0], ['date' => '2026-10-21', 'todo' => 0, 'doing' => 0, 'done' => 1]], '서울 자정·실제 이력·작업실 격리'); // 날짜별 정확한 기대값
        ImportTest::same($data['rows'][0]['board_id'], null, '다른 작업실 보드 연결 제외'); // 보드 범위
        ImportTest::same($data['rows'][1]['board_id'], 1, '유효한 원본 보드 이동점'); // 연결 계약
        $done = AnalyticsDashboard::get(1, $filters + ['status' => 'done']); // 상태 교집합
        ImportTest::same([$done['pagination']['total'], count($done['rows']), array_sum(array_column($done['status_trend'], 'doing'))], [1, 1, 0], '상태 조건의 지표·행·추이 일치'); // 공통 필터
        $none = AnalyticsDashboard::get(1, ['created_from' => '2026-10-21', 'created_to' => '2026-10-21']); // 생성일에 해당하지 않는 업무
        ImportTest::same($none['status_trend'][0]['done'], 0, '생성일 필터 밖 업무의 이력 제외'); // 조회 의미 고정
        Database::run('DELETE FROM task_status_history WHERE project_id=1'); // 기록 없는 기존 자료
        ImportTest::same(array_sum(array_column(AnalyticsDashboard::get(1, $filters)['status_trend'], 'done')), 0, '현재 완료 상태로 과거 이력 추정 금지'); // 기록 이전 미추정
        return; // CSV 범위 생략
    } // 이력 검사 끝
    $title = "=SUM(1,2)\n쉼표, 역슬래시\\\"인용"; // 복합 CSV 문자
    Database::run('UPDATE tasks SET title=? WHERE task_id=1', [$title]); // 수식·여러 줄 제목
    for ($index = 0; $index < 1001; $index++) // 여러 묶음 자료
    { // 자료 생성
        Database::run("INSERT INTO tasks (project_id,title,status,created_at) VALUES (1,?,'todo','2026-10-20 12:00:00')", ['묶음 ' . $index]); // 500행 경계 초과
    } // 자료 생성 끝
    $export = AnalyticsDashboard::allRows(1, $filters); // 공통 전체 원본
    ImportTest::same($export['rows'] instanceof Generator, true, '전체 행 배열 없는 지연 조회'); // 메모리 경계
    ImportTest::same(iterator_count($export['rows']), 1003, '500행 경계를 넘는 전체 행'); // 누락·중복 없음
    ob_start(); // 다운로드 본문 캡처
    AnalyticsExport::download(1, $filters); // 실제 CSV 생성
    $csv = ob_get_clean(); // 본문 회수
    ImportTest::same(substr($csv, 0, 3), "\xEF\xBB\xBF", '실제 응답 바이트 UTF-8 BOM'); // 문자열 검색 아닌 바이트 검증
    $stream = fopen('php://temp', 'w+'); // CSV 파서 입력
    fwrite($stream, substr($csv, 3)); rewind($stream); // BOM 제외
    $rows = []; // 파싱 결과
    while (($row = fgetcsv($stream, 0, ',', '"', '')) !== false) // 표준 CSV 해석
    { // 결과 저장
        $rows[] = $row; // 여러 줄도 한 행
    } // 해석 끝
    fclose($stream); // 임시 자원 해제
    ImportTest::same(count($rows), 1004, '표 머리와 1003개 업무'); // 전체 수치 대조
    ImportTest::same(end($rows)[1], "'" . $title, '수식 방어와 여러 줄·인용·역슬래시 왕복'); // 안전 인코딩
    ImportTest::same($pdo->inTransaction(), false, 'CSV 스냅샷 종료'); // 잠금 해제
    ImportTest::rejects(static fn () => AnalyticsDashboard::allRows(1, ['page' => '1']), 400, 'CSV 비지원 페이지 조건 거부'); // 필터 검증
}); // 임시 DB 정리
echo '분석 완성 ' . $mode . ' ' . ImportTest::$passed . "개 통과\n"; // 통과 결과
ob_end_flush(); // 검사 로그 출력
