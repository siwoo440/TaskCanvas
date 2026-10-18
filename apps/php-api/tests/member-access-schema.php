<?php // 회원 접근 연결의 분리 DB 검사
declare(strict_types=1); // 엄격한 자료형
require dirname(__DIR__) . '/src/Env.php'; // 설정 로더
require dirname(__DIR__) . '/src/Database.php'; // DB 접근
require dirname(__DIR__) . '/src/Schema.php'; // 보정 정의
Env::load(dirname(__DIR__) . '/.env'); // 접속 설정
$admin = new PDO(sprintf('mysql:host=%s;port=%d;charset=utf8mb4', Env::get('DB_HOST'), Env::int('DB_PORT', 3306)), Env::get('DB_USER'), Env::get('DB_PASS'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]); // DB 생성 연결
$name = 'taskcanvas_d27_schema_' . bin2hex(random_bytes(6)); // 실행 전용 DB
$created = false; // 생성 상태
$result = 0; // 종료 코드
function verify(bool $condition, string $message): void // 검사 결과
{ // 검사 시작
    if (!$condition) // 실패 조건
    { // 실패 분기
        throw new RuntimeException($message); // 원인 전달
    } // 실패 끝
    echo 'PASS ' . $message . "\n"; // 통과 출력
} // 검사 끝
try // 실제 스키마 검사
{ // 검사 범위
    $admin->exec('CREATE DATABASE `' . $name . '`'); // 임시 DB 생성
    $created = true; // 정리 대상
    putenv('DB_NAME=' . $name); // 임시 DB 선택
    Env::load(dirname(__DIR__) . '/.env'); // 설정 반영
    $sql = file_get_contents(dirname(__DIR__, 3) . '/database/schema.sql'); // 신규 설치 SQL
    $sql = preg_replace('/^(?:CREATE DATABASE IF NOT EXISTS taskcanvas\b.*|USE taskcanvas;.*)$/m', '', $sql); // 개발 DB 선택 제거
    Database::pdo()->exec($sql); // 신규 설치
    $definitions = []; // 신규 정의
    foreach (['guest_sessions' => 'user_session_id', 'realtime_tickets' => 'guest_session_id'] as $table => $column) // 연결 컬럼
    { // 컬럼 검사
        verify(Database::one('SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?', [$name, $table, $column]) !== null, '신규 설치 ' . $table . '.' . $column); // 컬럼 존재
        $definitions[$table] = Database::one('SHOW CREATE TABLE ' . $table)['Create Table']; // 정의 저장
    } // 컬럼 검사 끝
    Database::run("INSERT INTO guests (display_name) VALUES ('보존 게스트')"); // 보존 자료
    Database::run("INSERT INTO guest_sessions (guest_id, token_hash, expires_at) VALUES (1, REPEAT('a',64), DATE_ADD(NOW(), INTERVAL 1 DAY))"); // 독립 세션
    Database::run('ALTER TABLE realtime_tickets DROP FOREIGN KEY fk_ticket_session, DROP COLUMN guest_session_id'); // 이전 티켓 구조
    Database::run('ALTER TABLE guest_sessions DROP FOREIGN KEY fk_guest_session_user_session, DROP COLUMN user_session_id'); // 이전 게스트 구조
    verify(count(Schema::upgrade()) === 2, '기존 DB 연결 컬럼 2개 보정'); // 보정 범위
    foreach ($definitions as $table => $definition) // 신규와 보정 비교
    { // 정의 비교
        $actual = Database::one('SHOW CREATE TABLE ' . $table)['Create Table']; // 보정 정의
        verify(preg_replace('/ AUTO_INCREMENT=\d+/', '', $actual) === preg_replace('/ AUTO_INCREMENT=\d+/', '', $definition), $table . ' 신규·보정 정의 일치'); // 시퀀스 외 동일
    } // 비교 끝
    verify(Database::one('SELECT guest_id, user_session_id FROM guest_sessions')['user_session_id'] === null, '기존 독립 게스트 세션 보존'); // 기존 행 보존
    verify(Schema::upgrade() === [] && Schema::missing() === [], '반복 보정 변경 없음'); // 멱등성
    Database::run("INSERT INTO users (login_id, display_name, password_hash) VALUES ('schema27','테스트','hash')"); // 가상 회원
    Database::run("INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES (1, REPEAT('b',64), DATE_ADD(NOW(), INTERVAL 1 DAY))"); // 회원 세션
    Database::run("INSERT INTO guest_sessions (guest_id, token_hash, expires_at, user_session_id) VALUES (1, REPEAT('c',64), DATE_ADD(NOW(), INTERVAL 1 DAY), 1)"); // 종속 세션
    $boundId = Database::lastId(); // 새 종속 세션 번호
    Database::run("INSERT INTO projects (title, created_by) VALUES ('세션 티켓 검사',1)"); // 티켓 대상 작업실
    Database::run("INSERT INTO boards (project_id, title) VALUES (1,'세션 보드')"); // 티켓 대상 보드
    Database::run("INSERT INTO realtime_tickets (ticket_hash, guest_id, board_id, guest_session_id, expires_at) VALUES (REPEAT('e',64),1,1,?,DATE_ADD(NOW(), INTERVAL 1 MINUTE))", [$boundId]); // 실제 결합 티켓
    Database::run('DELETE FROM user_sessions WHERE session_id = 1'); // 회원 세션 삭제
    verify((int) Database::one('SELECT COUNT(*) AS n FROM guest_sessions')['n'] === 1, '종속 세션만 연쇄 삭제'); // 독립 세션 보존
    verify((int) Database::one('SELECT COUNT(*) AS n FROM realtime_tickets')['n'] === 0, '회원 세션 삭제 시 종속 티켓 연쇄 정리'); // 티켓 잔존 방지
    try // 잘못된 결합 검사
    { // 저장 시도
        Database::run("INSERT INTO guest_sessions (guest_id, token_hash, expires_at, user_session_id) VALUES (1, REPEAT('d',64), NOW(), 999)"); // 없는 세션
        throw new RuntimeException('잘못된 회원 세션 연결 허용'); // 검증 실패
    } // 저장 시도 끝
    catch (PDOException $error) // 외래키 오류
    { // 거부 검사
        verify((int) $error->errorInfo[1] === 1452, '없는 회원 세션 결합 거부'); // 참조 무결성
    } // 오류 검사 끝
    try // 티켓 외래키 검사
    { // 저장 시도
        Database::run("INSERT INTO realtime_tickets (ticket_hash, guest_id, board_id, guest_session_id, expires_at) VALUES (REPEAT('f',64),1,1,999,NOW())"); // 없는 발급 세션
        throw new RuntimeException('잘못된 티켓 세션 결합 허용'); // 검증 실패
    } // 저장 시도 끝
    catch (PDOException $error) // 참조 오류
    { // 거부 확인
        verify((int) $error->errorInfo[1] === 1452, '없는 발급 세션의 티켓 저장 거부'); // 무결성 검사
    } // 거부 확인 끝
} // 검사 끝
catch (Throwable $error) // 검사 오류
{ // 오류 보고
    fwrite(STDERR, 'FAIL ' . $error->getMessage() . "\n"); // 원인 출력
    $result = 1; // 실패 코드
} // 오류 끝
finally // 임시 DB 정리
{ // 정리 범위
    if ($created) // 실제 생성 여부
    { // 생성 DB만 정리
        $admin->exec('DROP DATABASE `' . $name . '`'); // 전용 DB 제거
    } // DB 정리 끝
} // 정리 끝
exit($result); // 결과 반환
