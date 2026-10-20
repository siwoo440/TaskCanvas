<?php // 데이터셋 스키마의 신규·보정·보존 검사
declare(strict_types=1); // 엄격한 자료형
require __DIR__ . '/import-test-support.php'; // 테스트 환경
ImportTest::database(static function (PDO $pdo): void // 실제 분리 DB
{ // 검사 시작
    $tables = ['import_datasets', 'import_rows', 'import_drafts', 'import_draft_chunks', 'import_runs', 'import_quality_reports', 'import_quality_rows']; // 승인된 표와 품질 종속 표
    $definitions = []; // 신규 정의
    foreach ($tables as $table) // 실제 설치 확인
    { // 표 검사
        $definitions[$table] = Database::one('SHOW CREATE TABLE `' . $table . '`')['Create Table']; // 없으면 실패
    } // 표 검사 끝
    Database::run("INSERT INTO guests (display_name) VALUES ('보존 게스트')"); // 기존 데이터
    Database::run("INSERT INTO projects (title,created_by) VALUES ('보존 작업실',1)"); // 기존 작업실
    $before = Database::all('SELECT * FROM guests'); // 보존 기준
    $oldRows = []; // 기존 표 전체 비교
    foreach (Database::all('SHOW TABLES') as $entry) // 설치된 표
    { // 이전 자료 수집
        $table = (string) array_values($entry)[0]; // 표 이름
        if (!in_array($table, $tables, true)) // 기존 표만
        { // 보존 기준
            $oldRows[$table] = Database::all('SELECT * FROM `' . $table . '`'); // 전체 행
        } // 보존 기준 끝
    } // 수집 끝
    foreach (array_reverse($tables) as $table) // 이전 DB 재현
    { // 신규 표 제거
        $pdo->exec('DROP TABLE `' . $table . '`'); // 이번 테스트 DB만
    } // 제거 끝
    ImportTest::same(count(Schema::upgrade()), 7, '기존 DB 일곱 표 보정'); // 적용 수
    ImportTest::same(Database::all('SELECT * FROM guests'), $before, '기존 게스트 전체 행 보존'); // 정확 비교
    foreach ($oldRows as $table => $rows) // 기존 자료 검증
    { // 표별 비교
        ImportTest::same(Database::all('SELECT * FROM `' . $table . '`'), $rows, $table . ' 기존 전체 행 보존'); // 무손실 보정
    } // 비교 끝
    foreach ($definitions as $table => $definition) // 정의 동일성
    { // 정의 검사
        ImportTest::same(Database::one('SHOW CREATE TABLE `' . $table . '`')['Create Table'], $definition, $table . ' 신규·보정 동일'); // FK와 인덱스 포함
    } // 정의 검사 끝
    ImportTest::same(Schema::upgrade(), [], '반복 보정 변경 없음'); // 멱등성
    Database::run("INSERT INTO guest_sessions (guest_id,token_hash,expires_at) VALUES (1,REPEAT('a',64),DATE_ADD(NOW(),INTERVAL 1 DAY))"); // 세션 소유
    Database::run("INSERT INTO import_datasets (project_id,name,schema_json) VALUES (1,'가져오기','[]')"); // 데이터셋
    Database::run("INSERT INTO import_rows (dataset_id,source_row,values_json) VALUES (1,1,'[]')"); // 데이터 행
    Database::run("INSERT INTO import_drafts (draft_hash,project_id,guest_session_id,original_name,format,size_bytes,source_sha256,expires_at) VALUES (REPEAT('b',64),1,1,'test.csv','csv',1,REPEAT('c',64),DATE_ADD(NOW(),INTERVAL 15 MINUTE))"); // 세션 초안
    Database::run("INSERT INTO import_draft_chunks (draft_hash,chunk_no,data) VALUES (REPEAT('b',64),0,'x')"); // 원본 조각
    Database::run("INSERT INTO import_runs (project_id,dataset_id,draft_hash,validation_revision,status,file_name,source_sha256) VALUES (1,1,REPEAT('b',64),1,'validated','test.csv',REPEAT('c',64))"); // 검증 이력
    $command = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(dirname(__DIR__) . '/bin/reset-demo.php') . ' --dry-run'; // 분리 DB 미리보기
    putenv('UPLOAD_DIR=' . dirname(__DIR__, 3) . '/tmp/' . Env::get('DB_NAME') . '-uploads'); // 개발 업로드 정리 차단
    exec($command, $output, $exit); // 실제 CLI
    ImportTest::same($exit, 0, '초기화 미리보기 실행'); // 정상 종료
    ImportTest::same(str_contains(implode("\n", $output), 'import_draft_chunks'), true, '초기화 목록에 원본 조각 포함'); // 누락 방지
    ImportTest::same((int) Database::one('SELECT COUNT(*) AS n FROM import_rows')['n'], 1, '미리보기 데이터 보존'); // dry-run 부작용 방지
    Database::run('DELETE FROM guest_sessions WHERE session_id=1'); // 세션 해제
    ImportTest::same((int) Database::one('SELECT COUNT(*) AS n FROM import_draft_chunks')['n'], 0, '세션 삭제 시 초안과 조각 정리'); // FK 확인
    ImportTest::same((int) Database::one('SELECT COUNT(*) AS n FROM import_rows')['n'], 1, '세션 삭제 후 확정 행 보존'); // 소유 수명 구분
    Database::run('DELETE FROM projects WHERE project_id=1'); // 프로젝트 해제
    foreach ($tables as $table) // 프로젝트 종속 자료
    { // 정리 검사
        ImportTest::same((int) Database::one('SELECT COUNT(*) AS n FROM `' . $table . '`')['n'], 0, $table . ' 작업실 삭제 정리'); // 다른 표 영향 없음
    } // 정리 검사 끝
    exec(str_replace(' --dry-run', ' --yes', $command), $resetOutput, $resetExit); // 전용 DB 실제 초기화
    ImportTest::same($resetExit, 0, '전용 DB 실제 초기화 성공'); // 실제 CLI 호환
    foreach ($tables as $table) // 초기화 대상 확인
    { // 신규 표 검사
        ImportTest::same((int) Database::one('SELECT COUNT(*) AS n FROM `' . $table . '`')['n'], 0, $table . ' 초기화 정리'); // 재사용 데이터 누락 방지
    } // 신규 표 검사 끝
}); // DB 검사 끝
echo '스키마 ' . ImportTest::$passed . "개 통과\n"; // 결과
