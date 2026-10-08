<?php
// 클라이언트에 전달할 API 오류
declare(strict_types=1);

final class ApiException extends RuntimeException
{
    public string $errorCode; // docs/07-http-api.md 의 오류 코드

    public function __construct(int $status, string $errorCode, string $message)
    {
        parent::__construct($message, $status); // HTTP 상태를 code 로 보관
        $this->errorCode = $errorCode; // 오류 코드 저장
    }
}
