<?php // 회원 개인 설정 스키마 검증
declare(strict_types=1); // 엄격한 자료형
require __DIR__ . '/import-test-support.php'; // 고유 검사 DB
ImportTest::database(static function (PDO $pdo): void // 분리 환경
{ // 검사 시작
    $tables = ['dashboard_views', 'user_board_favorites', 'user_board_visits']; // 신규 세 표
    $definitions = []; // 신규 설치 구조
    foreach ($tables as $table) // 실제 표 검사
    { // 구조 조회
        $definitions[$table] = Database::one('SHOW CREATE TABLE ' . $table)['Create Table']; // 설치 정의
    } // 조회 끝
    Database::run("INSERT INTO users (login_id,display_name,password_hash) VALUES ('settings-a','A','test'),('settings-b','B','test')"); // 두 회원
    Database::run("INSERT INTO projects (title) VALUES ('설정 작업실')"); // 작업실
    Database::run("INSERT INTO boards (project_id,title) VALUES (1,'설정 보드')"); // 보드
    Database::run("INSERT INTO dashboard_views (user_id,project_id,name,filters_json) VALUES (1,1,'내 보기','{}'),(2,1,'내 보기','{}')"); // 회원별 같은 이름
    ImportTest::same((int) Database::one('SELECT COUNT(*) AS n FROM dashboard_views')['n'], 2, '회원별 설정 이름 격리'); // 소유 제약
    Database::run('INSERT INTO user_board_favorites (user_id,board_id) VALUES (1,1)'); // 즐겨찾기
    Database::run('INSERT INTO user_board_visits (user_id,board_id) VALUES (1,1)'); // 최근 접근
    Database::run('DELETE FROM boards WHERE board_id=1'); // 보드 삭제
    ImportTest::same((int) Database::one('SELECT COUNT(*) AS n FROM user_board_favorites')['n'], 0, '삭제된 즐겨찾기 FK 정리'); // 고아 자료 방지
    ImportTest::same((int) Database::one('SELECT COUNT(*) AS n FROM user_board_visits')['n'], 0, '삭제된 최근 보드 FK 정리'); // 최근 보존 경계
    foreach (array_reverse($tables) as $table) // 이전 설치 재현
    { // 표 제거
        $pdo->exec('DROP TABLE ' . $table); // 이번 임시 DB만
    } // 표 제거 끝
    ImportTest::same(count(Schema::upgrade()), 3, '기존 DB 세 표 보정'); // 정확한 추가 범위
    foreach ($tables as $table) // 보정 구조
    { // 정의 비교
        ImportTest::same(Database::one('SHOW CREATE TABLE ' . $table)['Create Table'], $definitions[$table], $table . ' 신규·보정 일치'); // 설치 경로 일치
    } // 정의 비교 끝
    ImportTest::same(Schema::upgrade(), [], '반복 보정 변경 없음'); // 멱등 적용
    foreach (array_reverse($tables) as $table) // 회원 도입 전 DB 재현
    { // 신규 설정 제거
        $pdo->exec('DROP TABLE ' . $table); // 임시 DB 설정 표만
    } // 제거 끝
    $pdo->exec('SET FOREIGN_KEY_CHECKS=0'); $pdo->exec('DROP TABLE users'); $pdo->exec('SET FOREIGN_KEY_CHECKS=1'); // 기존 회원 표 없는 설치
    $legacy = Schema::upgrade(); // 의존 순서 보정
    ImportTest::same(count($legacy), 4, '회원 표 없는 기존 DB의 의존 순서 보정'); // 회원 먼저 설정 나중
}); // 고유 자료 정리
echo '회원 설정 스키마 ' . ImportTest::$passed . "개 통과\n"; // 결과
