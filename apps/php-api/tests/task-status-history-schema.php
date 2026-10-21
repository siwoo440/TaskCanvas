<?php // 상태 이력 스키마와 기록 검증
declare(strict_types=1); // 엄격한 자료형
require __DIR__ . '/import-test-support.php'; // 분리 DB 도우미
ImportTest::database(static function (PDO $pdo): void // 고유 DB 검사
{ // 검사 시작
    $definition = Database::one('SHOW CREATE TABLE task_status_history')['Create Table']; // 신규 설치 정의
    Database::run("INSERT INTO guests (display_name) VALUES ('이력 사용자')"); // 행위자 게스트
    Database::run("INSERT INTO projects (title,created_by) VALUES ('이력 작업실',1)"); // 대상 작업실
    Database::run("INSERT INTO tasks (project_id,title,status) VALUES (1,'이력 업무','todo')"); // 대상 업무
    $changedAt = new DateTimeImmutable('2026-10-21 09:15:00', new DateTimeZone('Asia/Seoul')); // 고정 변경 시각
    TaskStatusHistory::record(1, 'todo', 'doing', ['guest_id' => 1, 'user_id' => null], 'history-request-1', $changedAt); // 최초 기록
    TaskStatusHistory::record(1, 'todo', 'doing', ['guest_id' => 1, 'user_id' => null], 'history-request-1', $changedAt); // 같은 요청 재시도
    $row = Database::one('SELECT project_id,task_id,from_status,to_status,actor_guest_id,actor_user_id,request_id,changed_at FROM task_status_history'); // 저장 결과
    ImportTest::same((int) Database::one('SELECT COUNT(*) AS n FROM task_status_history')['n'], 1, '같은 요청 이력 한 건'); // 멱등 기록
    ImportTest::same([(int) $row['project_id'], (int) $row['task_id'], $row['from_status'], $row['to_status']], [1, 1, 'todo', 'doing'], '작업실·업무·상태 보존'); // 핵심 필드
    ImportTest::same([(int) $row['actor_guest_id'], $row['actor_user_id']], [1, null], '행위자 보존'); // 행위자 필드
    ImportTest::same($row['request_id'], 'history-request-1', '요청 식별자 보존'); // 멱등 키
    ImportTest::same($row['changed_at'], '2026-10-21 09:15:00', '실제 변경 시각 보존'); // 시간 필드
    Database::run("INSERT INTO tasks (project_id,title,status) VALUES (1,'충돌 업무','todo')"); // 같은 작업실의 다른 업무
    try // 요청 키 충돌 검사
    { // 충돌 시작
        TaskStatusHistory::record(2, 'todo', 'done', ['guest_id' => 1, 'user_id' => null], 'history-request-1', $changedAt); // 다른 변경에 키 재사용
        throw new RuntimeException('요청 키 충돌이 거부되지 않았습니다.'); // 잘못된 통과
    } // 충돌 끝
    catch (LogicException $error) // 기대 충돌
    { // 충돌 확인
        ImportTest::same($error->getMessage(), '상태 이력 요청 ID가 다른 변경에 사용됐습니다.', '요청 키 충돌 명시적 거부'); // 조용한 누락 방지
    } // 충돌 확인 끝
    Database::run("INSERT INTO projects (title,created_by) VALUES ('다른 작업실',1)"); // 다른 범위
    Database::run("INSERT INTO tasks (project_id,title,status) VALUES (2,'다른 업무','todo')"); // 다른 업무
    TaskStatusHistory::record(3, 'todo', 'done', ['guest_id' => 1, 'user_id' => null], 'history-request-1', $changedAt); // 같은 키 다른 작업실
    ImportTest::same((int) Database::one('SELECT COUNT(*) AS n FROM task_status_history')['n'], 2, '작업실별 요청 키 격리'); // 범위 검사
    $pdo->exec('DROP TABLE task_status_history'); // 이전 DB 상태
    ImportTest::same(Schema::upgrade(), ['task_status_history(표)'], '기존 DB 이력 표 보정'); // 보정 범위
    ImportTest::same(Database::one('SHOW CREATE TABLE task_status_history')['Create Table'], $definition, '신규·보정 정의 일치'); // 구조 일치
    ImportTest::same(Schema::upgrade(), [], '이력 보정 반복 변경 없음'); // 보정 멱등성
}); // 고유 DB 정리
echo '상태 이력 스키마 ' . ImportTest::$passed . "개 통과\n"; // 검증 결과
