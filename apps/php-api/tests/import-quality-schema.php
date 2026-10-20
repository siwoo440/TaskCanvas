<?php // 품질 보고서의 보정·보존·수명 검증
declare(strict_types=1); // 엄격한 자료형
require __DIR__ . '/import-test-support.php'; // 실제 분리 DB
ImportTest::database(static function (PDO $pdo): void // 고유 DB 검사
{ // 검사 시작
    $names = ['import_quality_reports', 'import_quality_rows']; $definitions = []; // 품질 표 정의
    foreach ($names as $name) // 신규 설치 기준
    { // 정의 읽기
        $definitions[$name] = Database::one('SHOW CREATE TABLE ' . $name)['Create Table']; // 누락 시 실패
    } // 정의 읽기 끝
    Database::run("INSERT INTO guests (display_name) VALUES ('품질 보존 게스트')"); // 보존 자료
    Database::run("INSERT INTO projects (title,created_by) VALUES ('품질 보존 작업실',1)"); // 부모 자료
    Database::run("INSERT INTO import_runs (project_id,draft_hash,validation_revision,status,file_name,source_sha256) VALUES (1,REPEAT('a',64),1,'invalid','quality.csv',REPEAT('b',64))"); // 기존 이력
    $before = []; // 모든 기존 자료
    foreach (Database::all('SHOW TABLES') as $entry) // 보존 기준 수집
    { // 표 읽기
        $name = array_values($entry)[0]; // DB 표 이름
        if (!in_array($name, $names, true)) // 기존 표만
        { // 전체 행 저장
            $before[$name] = Database::all('SELECT * FROM `' . $name . '`'); // 정확한 값 비교
        } // 전체 행 저장 끝
    } // 보존 기준 끝
    $pdo->exec('DROP TABLE import_quality_rows'); $pdo->exec('DROP TABLE import_quality_reports'); // 이전 DB 상태
    ImportTest::same(count(Schema::upgrade()), 2, '품질 표2개 보정'); // 정확한 추가 범위
    foreach ($before as $name => $rows) // 기존 데이터 보존
    { // 전체 값 비교
        ImportTest::same(Database::all('SELECT * FROM `' . $name . '`'), $rows, $name . ' 모든 행 보존'); // 누락 방지
    } // 보존 검사 끝
    foreach ($definitions as $name => $definition) // 설치 정의 비교
    { // 구조 확인
        ImportTest::same(Database::one('SHOW CREATE TABLE ' . $name)['Create Table'], $definition, $name . ' 신규·보정 동일'); // 제약 포함
    } // 구조 확인 끝
    ImportTest::same(Schema::upgrade(), [], '품질 보정 반복 변경 없음'); // 멱등 보정
    Database::run("INSERT INTO import_quality_reports (run_id,metadata_json,summary_json,expected_json) VALUES (1,'{}','{}','{}')"); // 원문 없는 보고서
    Database::run("INSERT INTO import_quality_rows (run_id,source_row,issues_json) VALUES (1,1,'[[\"error\",\"invalid_number\",\"s0\"]]')"); // 압축 문제 항목
    Database::run('DELETE FROM import_drafts'); // 초안 수명 종료
    ImportTest::same((int) Database::one('SELECT COUNT(*) AS n FROM import_quality_reports')['n'], 1, '초안과 독립된 보고서 수명'); // 과거 검사 유지
    Database::run('DELETE FROM import_runs WHERE run_id=1'); // 부모 이력 정리
    ImportTest::same((int) Database::one('SELECT COUNT(*) AS n FROM import_quality_rows')['n'], 0, '이력 삭제의 문제 행 FK 정리'); // 연관 자료만 제거
    ImportTest::same((int) Database::one('SELECT COUNT(*) AS n FROM import_quality_reports')['n'], 0, '이력 삭제의 보고서 FK 정리'); // 고아 보고서 방지
}); // 고유 DB 정리
echo '품질 스키마 ' . ImportTest::$passed . "개 통과\n"; // 검증 결과
