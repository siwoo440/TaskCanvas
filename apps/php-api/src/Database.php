<?php
// PDO 연결 공유 객체
declare(strict_types=1);

final class Database
{
    private static ?PDO $pdo = null; // 단일 PDO 인스턴스

    public static function pdo(): PDO
    {
        if (self::$pdo === null)
        {
            $dsn = sprintf(
                'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
                Env::get('DB_HOST'),
                Env::int('DB_PORT', 3306),
                Env::get('DB_NAME')
            ); // 접속 문자열 구성
            self::$pdo = new PDO($dsn, Env::get('DB_USER'), Env::get('DB_PASS'), [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, // 오류를 예외로 처리
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, // 연관 배열 반환
                PDO::ATTR_EMULATE_PREPARES => false, // 서버 측 프리페어드 스테이트먼트 사용
            ]); // PDO 연결 생성
        }
        return self::$pdo; // 연결 반환
    }

    public static function run(string $sql, array $params = []): PDOStatement
    {
        $stmt = self::pdo()->prepare($sql); // 바인딩 준비
        $stmt->execute($params); // 파라미터 바인딩 실행
        return $stmt; // 결과 스테이트먼트 반환
    }

    public static function one(string $sql, array $params = []): ?array
    {
        $row = self::run($sql, $params)->fetch(); // 첫 행 조회
        return $row === false ? null : $row; // 없으면 null
    }

    public static function all(string $sql, array $params = []): array
    {
        return self::run($sql, $params)->fetchAll(); // 전체 행 조회
    }

    public static function lastId(): int
    {
        return (int) self::pdo()->lastInsertId(); // 마지막 삽입 ID
    }
}
