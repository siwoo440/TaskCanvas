<?php // 파일 가져오기 분리 DB 검증 도우미
declare(strict_types=1); // 엄격한 자료형
spl_autoload_register(static function (string $class): void // 실제 제품 클래스 로드
{ // 자동 로드 시작
    require dirname(__DIR__) . '/src/' . $class . '.php'; // 원본 서비스
}); // 자동 로드 끝
final class ImportTest // 테스트 전용 환경
{ // 도우미 시작
    public static int $passed = 0; // 통과 수
    public static function same(mixed $actual, mixed $expected, string $label): void // 명확한 기대값
    { // 비교 시작
        if ($actual !== $expected) // 실제 값 비교
        { // 실패 보고
            throw new RuntimeException($label . ': ' . json_encode([$actual, $expected], JSON_UNESCAPED_UNICODE)); // 한정된 테스트 값
        } // 실패 끝
        self::$passed++; // 검사 수
        echo 'PASS ' . $label . "\n"; // 통과 출력
    } // 비교 끝
    public static function rejects(callable $action, int $status, string $label): void // 제품 입력 거부
    { // 거부 검사
        try // 실행
        { // 제품 호출
            $action(); // 실제 동작
        } // 제품 호출 끝
        catch (ApiException $error) // 예상 입력 오류
        { // 상태 비교
            self::same($error->getCode(), $status, $label); // 정확한 상태
            return; // 거부 완료
        } // 상태 비교 끝
        throw new RuntimeException($label . ': 거부 누락'); // 잘못된 성공
    } // 거부 검사 끝
    public static function database(callable $test): void // 임시 DB 수명
    { // 환경 시작
        Env::load(dirname(__DIR__) . '/.env'); // 접속 설정
        $name = 'taskcanvas_d30_' . bin2hex(random_bytes(8)); // 이번 실행만의 DB
        $admin = new PDO('mysql:host=' . Env::get('DB_HOST') . ';port=' . Env::int('DB_PORT', 3306) . ';charset=utf8mb4', Env::get('DB_USER'), Env::get('DB_PASS'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]); // 생성 전용 연결
        $created = false; // 정리 여부
        try // 분리 검사
        { // DB 준비
            $admin->exec('CREATE DATABASE `' . $name . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); // 고유 DB
            $created = true; putenv('DB_NAME=' . $name); Env::load(dirname(__DIR__) . '/.env'); // 설정 재병합
            $pdo = Database::pdo(); // 실제 서비스 연결
            self::same($pdo->query('SELECT DATABASE()')->fetchColumn(), $name, '쓰기 전 분리 DB 확인'); // 개발 DB 보호
            $sql = file_get_contents(dirname(__DIR__, 3) . '/database/schema.sql'); // 설치 원본
            $sql = preg_replace('/^(?:CREATE DATABASE IF NOT EXISTS taskcanvas\b.*|USE taskcanvas;.*)$/m', '', $sql); // 개발 DB 선택 차단
            $pdo->exec($sql); // 분리 설치
            $test($pdo, $name, $admin); // 실제 검사
        } // 분리 검사 끝
        finally // 테스트 자원 해제
        { // 정리 시작
            if (isset($pdo) && $pdo->inTransaction()) // 실패한 트랜잭션
            { // 잠금 해제
                $pdo->rollBack(); // 테스트 롤백
            } // 잠금 해제 끝
            if ($created) // 이번 DB만
            { // 정확한 이름 정리
                $admin->exec('DROP DATABASE `' . $name . '`'); // 개발 데이터 보존
            } // DB 정리 끝
        } // 자원 해제 끝
    } // 환경 끝
} // 도우미 끝
