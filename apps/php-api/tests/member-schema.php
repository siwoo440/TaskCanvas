<?php // 회원 데이터 스키마의 실제 DB 검증
declare(strict_types=1); // 엄격한 자료형 검사

require dirname(__DIR__) . '/src/Env.php'; // 설정 로더
require dirname(__DIR__) . '/src/Database.php'; // 실제 DB 연결
require dirname(__DIR__) . '/src/Schema.php'; // 운영 마이그레이션

function check(bool $condition, string $message): void // 검증 결과 출력
{ // 검증 시작
    if (!$condition) // 실패 조건 확인
    { // 실패 처리 시작
        throw new RuntimeException($message); // 실패 원인 전달
    } // 실패 처리 끝
    echo 'PASS ' . $message . "\n"; // 통과 결과
} // 검증 끝

function rejects(callable $operation, int $driverCode, string $message): void // DB 제약 거부 검사
{ // 제약 검사 시작
    try // 금지된 저장 시도
    { // 저장 시도 시작
        $operation(); // 검사 대상 실행
    } // 저장 시도 끝
    catch (PDOException $error) // 실제 DB 오류 확인
    { // 오류 검사 시작
        check((int) ($error->errorInfo[1] ?? 0) === $driverCode, $message); // 예상 제약 오류 확인
        return; // 정상 거부 결과
    } // 오류 검사 끝
    throw new RuntimeException($message . ' — DB가 금지된 요청을 허용했습니다.'); // 제약 누락 오류
} // 제약 검사 끝

function snapshot(array $tables): array // 기존 행과 테이블 구조 기록
{ // 기록 시작
    $result = []; // 테이블별 기록
    foreach ($tables as $table) // 서버에서 얻은 테이블 순회
    { // 테이블 기록 시작
        $definition = Database::one('SHOW CREATE TABLE `' . $table . '`'); // 테이블 생성문
        $rows = Database::all('SELECT * FROM `' . $table . '`'); // 저장된 모든 행
        $rows = array_map(static fn(array $row): string => json_encode($row, JSON_THROW_ON_ERROR), $rows); // 행별 비교 문자열
        sort($rows); // 조회 순서 차이 제거
        $result[$table] = ['definition' => $definition['Create Table'], 'rows' => $rows]; // 구조와 행 보관
    } // 테이블 기록 끝
    return $result; // 비교용 기록 반환
} // 기록 끝

$apiRoot = dirname(__DIR__); // API 프로젝트 경로
Env::load($apiRoot . '/.env'); // 개발 DB 접속 설정
$dsn = sprintf('mysql:host=%s;port=%d;charset=utf8mb4', Env::get('DB_HOST'), Env::int('DB_PORT', 3306)); // DB 이름 없는 서버 접속
$admin = new PDO($dsn, Env::get('DB_USER'), Env::get('DB_PASS'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]); // 테스트 DB 생성 연결
$testName = 'taskcanvas_d25_' . bin2hex(random_bytes(8)); // 이번 실행 전용 DB 이름
$created = false; // 전용 DB 생성 여부
$exitCode = 0; // 최종 실행 결과

try // 전용 DB 검증
{ // 검증 실행 시작
    $admin->exec('CREATE DATABASE `' . $testName . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); // 비어 있는 전용 DB 생성
    $created = true; // 정리 대상 표시
    putenv('DB_NAME=' . $testName); // 이 프로세스만 전용 DB 사용
    Env::load($apiRoot . '/.env'); // 전용 DB 설정 반영
    $schema = file_get_contents(dirname($apiRoot, 2) . '/database/schema.sql'); // 신규 설치 SQL
    $schema = preg_replace('/^(?:CREATE DATABASE IF NOT EXISTS taskcanvas\b.*|USE taskcanvas;.*)$/m', '', $schema); // 운영 DB 선택문 제외
    Database::pdo()->exec($schema); // 전용 DB에 신규 설치
    $memberTables = ['users', 'user_sessions', 'guest_user_links']; // 25일차 필수 테이블
    $existing = array_column(Database::all('SHOW TABLES'), 'Tables_in_' . $testName); // 실제 설치 테이블
    foreach ($memberTables as $table) // 신규 테이블 확인
    { // 신규 테이블 검사 시작
        check(in_array($table, $existing, true), '신규 설치: ' . $table . ' 테이블 존재'); // 누락 테이블 검출
    } // 신규 테이블 검사 끝
    $freshDefinitions = snapshot($memberTables); // 신규 설치 구조 기록
    Database::run('DROP TABLE guest_user_links, user_sessions, users'); // 전용 DB만 24일차 구조로 복원
    $legacyTables = array_values(array_diff($existing, $memberTables)); // 기존 테이블 목록
    $fixtures = [ // 기존 참조 관계를 갖춘 가상 데이터
        "INSERT INTO guests (guest_id, display_name) VALUES (1, '기존 관리자'), (2, '기존 편집자'), (3, '동명이인')", // 기존 게스트
        "INSERT INTO guest_sessions (guest_id, token_hash, expires_at) VALUES (1, REPEAT('a', 64), DATE_ADD(NOW(), INTERVAL 1 DAY))", // 기존 세션
        "INSERT INTO projects (project_id, title, created_by) VALUES (1, '보존할 작업실', 1)", // 기존 작업실
        "INSERT INTO project_members (project_id, guest_id, role) VALUES (1, 1, 'admin'), (1, 2, 'editor')", // 기존 권한
        "INSERT INTO project_invites (project_id, code_hash, expires_at) VALUES (1, REPEAT('b', 64), DATE_ADD(NOW(), INTERVAL 1 DAY))", // 기존 초대
        "INSERT INTO boards (board_id, project_id, title) VALUES (1, 1, '보존할 보드')", // 기존 보드
        "INSERT INTO tasks (task_id, project_id, title, assignee_id) VALUES (1, 1, '보존할 업무', 2)", // 기존 담당 업무
        "INSERT INTO task_items (task_id, title, is_done) VALUES (1, '보존할 항목', 1)", // 기존 체크리스트
        "INSERT INTO board_objects (object_id, board_id, task_id, type, payload_json) VALUES (1, 1, 1, 'task', '{}'), (2, 1, NULL, 'note', '{\"text\":\"기존 메모\"}')", // 기존 보드 객체
        "INSERT INTO board_links (board_id, from_object_id, to_object_id, label) VALUES (1, 1, 2, '보존할 연결')", // 기존 연결선
        "INSERT INTO media_assets (project_id, uploaded_by, original_name, stored_path, mime_type, size_bytes) VALUES (1, 1, 'fixture.png', 'fixture.png', 'image/png', 10)", // 파일 없는 가상 메타데이터
        "INSERT INTO realtime_tickets (ticket_hash, guest_id, board_id, expires_at) VALUES (REPEAT('c', 64), 1, 1, DATE_ADD(NOW(), INTERVAL 1 MINUTE))", // 기존 접속 티켓
        "INSERT INTO join_attempts (client_ip, succeeded) VALUES ('127.0.0.1', 1)", // 기존 요청 기록
    ]; // 가상 데이터 목록 끝
    foreach ($fixtures as $sql) // 기존 데이터 생성
    { // 가상 데이터 저장 시작
        Database::run($sql); // 전용 DB에만 저장
    } // 가상 데이터 저장 끝
    $before = snapshot($legacyTables); // 마이그레이션 전 전체 기존 데이터
    foreach ($memberTables as $table) // 마이그레이션 진단 확인
    { // 진단 검사 시작
        check(in_array($table . '(표)', Schema::missing(), true), '기존 설치 진단: ' . $table . ' 누락 표시'); // 보정 필요 감지
    } // 진단 검사 끝
    $applied = Schema::upgrade(); // 실제 운영 보정 실행
    check(count($applied) === 3, '기존 설치: 회원 테이블 3개 추가'); // 마이그레이션 변경 범위
    check(snapshot($legacyTables) === $before, '마이그레이션 전후 기존 테이블 구조·모든 행 일치'); // 기존 데이터 보존
    check(snapshot($memberTables) === $freshDefinitions, '신규 설치와 마이그레이션의 회원 스키마 일치'); // 설치 경로 일치
    check(Schema::missing() === [], '마이그레이션 후 누락 없음'); // 사전 점검 호환
    check((int) Database::one('SELECT COUNT(*) AS n FROM guest_user_links')['n'] === 0, '기존 게스트 자동 연결 없음'); // 권한 자동 이전 방지
    $passwordHash = password_hash('test-only-password-25', PASSWORD_DEFAULT); // 가상 비밀번호 해시
    Database::run('INSERT INTO users (user_id, login_id, display_name, password_hash) VALUES (?, ?, ?, ?)', [1, 'member25', '회원', $passwordHash]); // 첫 회원 저장
    Database::run('INSERT INTO users (user_id, login_id, display_name, password_hash) VALUES (?, ?, ?, ?)', [2, 'other25', '회원', $passwordHash]); // 같은 표시 이름의 다른 회원
    $stored = Database::one('SELECT password_hash FROM users WHERE user_id = 1'); // 저장된 해시 조회
    check(password_verify('test-only-password-25', $stored['password_hash']), '비밀번호 해시 저장·복원'); // 해시 손실 검사
    rejects(static fn() => Database::run('INSERT INTO users (login_id, display_name, password_hash) VALUES (?, ?, ?)', ['MEMBER25', '다른 회원', $passwordHash]), 1062, '대소문자만 다른 로그인 ID 중복 거부'); // 로그인 식별자 유일성
    Database::run('INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES (1, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))', [hash('sha256', 'session-one')]); // 회원 세션 해시 저장
    rejects(static fn() => Database::run('INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES (2, ?, NOW())', [hash('sha256', 'session-one')]), 1062, '회원 세션 토큰 해시 중복 거부'); // 토큰 유일성
    rejects(static fn() => Database::run('INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES (999, ?, NOW())', [hash('sha256', 'unknown')]), 1452, '없는 회원의 세션 거부'); // 세션 외래키
    Database::run('UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = 1'); // 폐기 시각 저장
    check(Database::one('SELECT revoked_at FROM user_sessions WHERE user_id = 1')['revoked_at'] !== null, '회원 세션 폐기 시각 저장'); // 폐기 상태 보관
    Database::run('INSERT INTO guest_user_links (guest_id, user_id) VALUES (1, 1), (2, 1)'); // 한 회원의 여러 게스트 연결
    check((int) Database::one('SELECT COUNT(*) AS n FROM guest_user_links WHERE user_id = 1')['n'] === 2, '한 회원에 여러 기존 게스트 연결'); // 다중 게스트 모델
    rejects(static fn() => Database::run('INSERT INTO guest_user_links (guest_id, user_id) VALUES (1, 2)'), 1062, '같은 게스트의 다른 회원 연결 거부'); // 소유권 중복 차단
    rejects(static fn() => Database::run('INSERT INTO guest_user_links (guest_id, user_id) VALUES (999, 1)'), 1452, '없는 게스트 연결 거부'); // 게스트 외래키
    rejects(static fn() => Database::run('INSERT INTO guest_user_links (guest_id, user_id) VALUES (3, 999)'), 1452, '없는 회원 연결 거부'); // 회원 외래키
    rejects(static fn() => Database::run('DELETE FROM users WHERE user_id = 1'), 1451, '연결된 회원의 무단 연쇄 삭제 차단'); // 명시적 연결 해제 요구
    Database::run('INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES (2, ?, NOW())', [hash('sha256', 'session-two')]); // 연결 없는 회원 세션
    Database::run('DELETE FROM users WHERE user_id = 2'); // 연결 없는 가상 회원 삭제
    check((int) Database::one('SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = 2')['n'] === 0, '회원 삭제 시 해당 회원 세션만 정리'); // 세션 연쇄 정리
    check(snapshot($legacyTables) === $before, '회원·연결 저장 후에도 기존 데이터 보존'); // 기존 업무와 소유권 참조 유지
    $allTables = array_column(Database::all('SHOW TABLES'), 'Tables_in_' . $testName); // 회원 포함 전체 테이블
    $after = snapshot($allTables); // 재실행 전 데이터
    check(Schema::upgrade() === [], '마이그레이션 재실행 변경 없음'); // 멱등성
    check(snapshot($allTables) === $after, '마이그레이션 재실행 후 전체 데이터 보존'); // 회원 데이터 포함 보존
    echo "회원 스키마 검증 완료\n"; // 최종 검증 결과
} // 검증 실행 끝
catch (Throwable $error) // 검증 실패 처리
{ // 실패 보고 시작
    fwrite(STDERR, 'FAIL ' . $error->getMessage() . "\n"); // 실패 원인
    $exitCode = 1; // 실패 종료 코드
} // 실패 보고 끝
finally // 이번 실행 전용 DB 정리
{ // 정리 시작
    if ($created) // 실제 생성된 전용 DB만 선택
    { // 전용 DB 정리 시작
        $admin->exec('DROP DATABASE `' . $testName . '`'); // 이번 테스트가 생성한 DB만 삭제
        echo "임시 테스트 DB 정리 완료\n"; // 정리 결과
    } // 전용 DB 정리 끝
} // 정리 끝
exit($exitCode); // 검증 결과 코드
