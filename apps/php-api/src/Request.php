<?php
// HTTP 요청 정보 접근자
declare(strict_types=1);

final class Request
{
    public string $method; // HTTP 메서드
    public string $path; // 쿼리 문자열을 뺀 경로
    public array $params = []; // 라우트 경로 변수
    private ?array $json = null; // 파싱된 JSON 본문

    public static function fromGlobals(): self
    {
        $req = new self(); // 요청 객체 생성
        $req->method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'); // 메서드 저장
        $req->path = rtrim(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/', '/') ?: '/'; // 경로 정규화
        return $req; // 요청 반환
    }

    public function json(): array
    {
        if ($this->json === null)
        {
            $raw = file_get_contents('php://input') ?: ''; // 원문 본문 읽기
            $decoded = $raw === '' ? [] : json_decode($raw, true); // JSON 디코딩
            if (!is_array($decoded))
            {
                throw new ApiException(400, 'BAD_REQUEST', '요청 본문이 올바른 JSON이 아닙니다.'); // 형식 오류
            }
            $this->json = $decoded; // 결과 캐시
        }
        return $this->json; // 본문 반환
    }

    public function string(string $key, int $maxLength = 255): string
    {
        $value = $this->json()[$key] ?? ''; // 본문 값 조회
        if (!is_string($value))
        {
            throw new ApiException(400, 'BAD_REQUEST', "{$key} 값은 문자열이어야 합니다."); // 타입 오류
        }
        $value = trim($value); // 앞뒤 공백 제거
        if (mb_strlen($value) > $maxLength)
        {
            throw new ApiException(400, 'BAD_REQUEST', "{$key} 값이 너무 깁니다."); // 길이 초과
        }
        return $value; // 정리된 문자열 반환
    }

    public function int(string $key): int
    {
        $value = $this->json()[$key] ?? null; // 본문 값 조회
        if (!is_int($value) && !(is_string($value) && ctype_digit($value)))
        {
            throw new ApiException(400, 'BAD_REQUEST', "{$key} 값은 정수여야 합니다."); // 타입 오류
        }
        return (int) $value; // 정수 반환
    }

    public function cookie(string $name): ?string
    {
        $value = $_COOKIE[$name] ?? null; // 쿠키 값 조회
        return is_string($value) && $value !== '' ? $value : null; // 비어 있으면 null
    }

    public function header(string $name): ?string
    {
        $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name)); // 서버 변수 키 변환
        return $_SERVER[$key] ?? null; // 헤더 값 반환
    }

    public function clientIp(): string
    {
        return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'; // 접속 IP(프록시 헤더는 신뢰하지 않음)
    }
}
