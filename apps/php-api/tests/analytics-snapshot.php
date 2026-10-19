<?php // 실제 분리 DB의 기준일과 스냅샷 검증
declare(strict_types=1); // 엄격한 자료형
spl_autoload_register(static function (string $class): void // 실제 서비스 로드
{ // 자동 로드 시작
    require dirname(__DIR__) . '/src/' . $class . '.php'; // 제품 클래스
}); // 자동 로드 끝
Env::load(dirname(__DIR__) . '/.env'); // 기존 접속 설정
$name = 'taskcanvas_d29_' . bin2hex(random_bytes(8)); // 고유 테스트 DB
$dsn = 'mysql:host=' . Env::get('DB_HOST') . ';port=' . Env::int('DB_PORT', 3306) . ';charset=utf8mb4'; // 관리자 접속
$options = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]; // 실제 오류와 행 형식
$admin = new PDO($dsn, Env::get('DB_USER'), Env::get('DB_PASS'), $options); // DB 생성 연결
$created = false; // 생성 여부
try // 격리 검증
{ // 검증 시작
    $admin->exec('CREATE DATABASE `' . $name . '`'); // 테스트 전용 DB
    $created = true; // 정리 예약
    putenv('DB_NAME=' . $name); // 서비스 접속 대상
    Env::load(dirname(__DIR__) . '/.env'); // 변경한 환경 재병합
    $a = Database::pdo(); // 실제 공유 PDO
    if ($a->query('SELECT DATABASE()')->fetchColumn() !== $name) // 쓰기 전 실제 DB 확인
    { // 격리 실패 차단
        throw new RuntimeException('분리 DB 연결 불일치'); // 개발 DB 변경 방지
    } // 격리 확인 끝
    $schema = file_get_contents(dirname(__DIR__, 3) . '/database/schema.sql'); // 실제 설치 스키마
    $schema = preg_replace('/^(?:CREATE DATABASE IF NOT EXISTS taskcanvas\b.*|USE taskcanvas;.*)$/m', '', $schema); // 개발 DB 선택 제거
    $a->exec($schema); // 전용 DB 설치
    $a->exec("INSERT INTO projects (title) VALUES ('스냅샷 검증')"); // 고유 작업실
    $id = (int) $a->lastInsertId(); // 작업실 ID
    $a->exec("INSERT INTO tasks (project_id,title,status,created_at,due_at) VALUES ($id,'기준 업무','todo','2024-02-29 12:00:00','2024-02-29 23:59:59')"); // 서울 고정 시각 업무
    $filters = AnalyticsFilters::parse(['created_from' => '2024-02-29', 'created_to' => '2024-02-29']); // 윤일 하루
    $today = new DateTimeImmutable('2024-02-29', new DateTimeZone('Asia/Seoul')); // 요청 기준일
    $summary = TaskAnalytics::aggregate($id, $filters, $today); // 실제 SQL 집계
    assert($summary['as_of_date'] === '2024-02-29' && $summary['due']['today'] === 1 && $summary['due']['overdue'] === 0); // 고정 기준일 적용
    echo "PASS 고정 서울 기준일과 마감 경계\n"; // 기준일 결과
    if (in_array('--clock-only', $argv, true)) // 작업 1 전용 실행
    { // 제한 실행
        return; // 스냅샷 구현 전 종료
    } // 제한 실행 끝
    $b = new PDO($dsn . ';dbname=' . $name, Env::get('DB_USER'), Env::get('DB_PASS'), $options); // 독립 쓰기 연결
    $a->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); // 일관된 격리
    $a->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'); // 읽기 전용 스냅샷
    $b->exec("UPDATE tasks SET status='done' WHERE project_id=$id"); // 동시 상태 변경
    $b->exec("INSERT INTO tasks (project_id,title,status,created_at) VALUES ($id,'새 업무','done','2024-02-29 13:00:00')"); // 동시 생성
    $snapshot = AnalyticsDashboard::read($id, $filters, PHP_INT_MAX, $today); // 고정 스냅샷 조회
    assert($snapshot['summary']['tasks']['total'] === 1 && $snapshot['summary']['tasks']['done'] === 0); // 이전 건수와 상태
    assert($snapshot['daily_created'][0]['count'] === 1 && count($snapshot['rows']) === 1 && $snapshot['rows'][0]['status'] === 'todo'); // 추이와 표 일치
    assert($snapshot['pagination']['page'] === 1); // 큰 페이지 안전 보정
    $a->commit(); // 읽기 종료
    $after = AnalyticsDashboard::get($id, ['created_from' => '2024-02-29', 'created_to' => '2024-02-29']); // 새 요청
    assert($after['summary']['tasks']['total'] === 2 && $after['summary']['tasks']['done'] === 2); // 최신 커밋 반영
    assert(!$a->inTransaction()); // 성공 후 정리
    $b->exec("DELETE FROM tasks WHERE project_id=$id"); // 동시 삭제
    assert(AnalyticsDashboard::get($id, ['created_to' => '2024-02-29'])['pagination']['total'] === 0); // 삭제 반영
    $b->exec('DROP TABLE task_items'); // 조회 중 오류 유발
    try // SQL 오류 정리 검사
    { // 오류 실행
        AnalyticsDashboard::get($id, []); // 실제 집계 실패
        throw new RuntimeException('SQL 오류 누락'); // 실패 누락 방지
    } // 오류 실행 끝
    catch (PDOException $error) // 예상 SQL 오류
    { // 정리 확인
        assert(!$a->inTransaction()); // 예외 후 롤백
    } // 정리 확인 끝
    echo "PASS 동시 변경·스냅샷·페이지·최신 조회·삭제·예외 롤백\n"; // 검증 결과
} // 검증 끝
finally // 전용 DB 정리
{ // 정리 시작
    if (isset($a) && $a->inTransaction()) // 실패한 읽기 트랜잭션
    { // 트랜잭션 해제
        $a->rollBack(); // 잠금과 스냅샷 정리
    } // 트랜잭션 해제 끝
    if ($created) // 이번 실행의 DB
    { // 정확한 임시 DB 정리
        $admin->exec('DROP DATABASE `' . $name . '`'); // 개발 데이터 보존
    } // 임시 DB 정리 끝
} // 정리 끝
