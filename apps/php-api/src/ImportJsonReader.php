<?php // 숫자 원문과 중복 키를 보존하는 JSON reader
declare(strict_types=1); // 엄격한 자료형
final class ImportJsonReader // 제한된 재귀 파서
{ // reader 시작
    private int $position = 0; // 현재 바이트
    private int $nodes = 0; // 메모리 자원 제한
    private function __construct(private string $text) // 한 원본 소유
    { // 생성 시작
    } // 생성 끝
    public static function decode(string $bytes): mixed // 정확한 JSON 값
    { // 파싱 시작
        $reader = new self($bytes); // 실행별 상태
        $value = $reader->value(0); // 루트 값
        $reader->space(); // 뒤 공백
        if ($reader->position !== strlen($bytes)) // 남은 구문
        { // 구문 거부
            $reader->bad(); // 여러 루트 금지
        } // 구문 거부 끝
        return $value; // 숫자는 문자열
    } // 파싱 끝
    private function bad(): never // 구문 오류
    { // 오류 시작
        throw new ApiException(415, 'INVALID_FILE', 'JSON 구문 또는 중복 객체 키를 확인하세요.'); // 원문 노출 없는 안내
    } // 오류 끝
    private function space(): void // JSON 공백만 허용
    { // 공백 시작
        $this->position += strspn($this->text, " \r\n\t", $this->position); // 현재 위치 이동
    } // 공백 끝
    private function character(): string // 경계 안전 문자
    { // 조회 시작
        return $this->text[$this->position] ?? ''; // 끝은 빈 값
    } // 조회 끝
    private function string(): string // 이스케이프와 UTF-16 해석
    { // 문자열 시작
        $start = $this->position++; // 여는 인용부호
        while ($this->position < strlen($this->text)) // 닫는 부호 탐색
        { // 문자 검사
            $char = $this->text[$this->position++]; // 다음 바이트
            if ($char === '\\') // 이스케이프
            { // escaped 문자 건너뛰기
                $this->position++; // 의미 검증은 JSON 디코더
            } // escaped 처리 끝
            elseif ($char === '"') // 닫는 인용부호
            { // 문자열 해석
                try // 표준 문자열 규칙
                { // 안전한 한 문자열
                    $value = json_decode(substr($this->text, $start, $this->position - $start), false, 16, JSON_THROW_ON_ERROR); // 숫자 해석 없음
                } // 해석 끝
                catch (JsonException $error) // 손상된 escape
                { // 오류 전달
                    $this->bad(); // 구문 안내
                } // 오류 전달 끝
                return $value; // decoded 문자열
            } // 문자열 해석 끝
        } // 문자 검사 끝
        $this->bad(); // 미완성 문자열
    } // 문자열 끝
    private function value(int $depth): mixed // 값과 컨테이너
    { // 값 시작
        if (++$this->nodes > 600000) // 최대 정상 표본보다 큰 구조
        { // 자원 거부
            throw new ApiException(413, 'FILE_TOO_LARGE', 'JSON 요소 수가 너무 많습니다. 가져올 배열만 파일로 분리하세요.'); // 메모리 보호
        } // 자원 거부 끝
        $this->space(); $char = $this->character(); // 값 시작 문자
        if ($char === '"') // 문자열
        { // 문자 값
            return $this->string(); // 원문 내용 보존
        } // 문자 값 끝
        if ($char === '{' || $char === '[') // 컨테이너
        { // 컨테이너 시작
            if ($depth >= 16) // 중첩 한도
            { // 깊이 거부
                throw new ApiException(415, 'INVALID_FILE', 'JSON 중첩 깊이는 최대 16단계입니다.'); // 한도 안내
            } // 깊이 거부 끝
            $object = $char === '{'; $end = $object ? '}' : ']'; // 컨테이너 형식
            $result = $object ? new stdClass() : []; $seen = []; // 키 중복 검사
            $this->position++; $this->space(); // 여는 괄호 이후
            if ($this->character() === $end) // 빈 컨테이너
            { // 빈 값
                $this->position++; return $result; // 정상 종료
            } // 빈 값 끝
            while (true) // 항목 읽기
            { // 항목 시작
                $this->space(); // 구분 공백
                if ($object) // 객체 키
                { // 키 검사
                    if ($this->character() !== '"') // 문자열 키만
                    { // 키 거부
                        $this->bad(); // 잘못된 키
                    } // 키 거부 끝
                    $key = $this->string(); $this->space(); // decoded 키
                    if (isset($seen[$key]) || preg_match('/[\x00-\x1f]/', $key) || $this->character() !== ':') // 중복·제어·콜론 검사
                    { // 키 오류
                        $this->bad(); // 값 유실 방지
                    } // 키 오류 끝
                    $seen[$key] = true; $this->position++; // 키 확정
                    $result->{$key} = $this->value($depth + 1); // 객체 값
                } // 객체 키 끝
                else // 배열 값
                { // 배열 항목
                    $result[] = $this->value($depth + 1); // 원래 순서
                } // 배열 항목 끝
                $this->space(); $next = $this->character(); $this->position++; // 다음 구분
                if ($next === $end) // 컨테이너 종료
                { // 반환 시작
                    return $result; // 완성 값
                } // 반환 끝
                if ($next !== ',') // 구분자 오류
                { // 구문 거부
                    $this->bad(); // 뒤 쉼표도 다음 값에서 거부
                } // 구문 거부 끝
            } // 항목 끝
        } // 컨테이너 끝
        foreach (['true' => true, 'false' => false, 'null' => null] as $word => $literal) // JSON 리터럴
        { // 리터럴 비교
            if (substr_compare($this->text, $word, $this->position, strlen($word)) === 0) // 정확한 시작
            { // 리터럴 값
                $this->position += strlen($word); return $literal; // 원래 형식
            } // 리터럴 값 끝
        } // 리터럴 비교 끝
        if (preg_match('/\G-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/', $this->text, $match, 0, $this->position) === 1) // 원문 숫자 토큰
        { // 숫자 값
            $this->position += strlen($match[0]); return $match[0]; // float 변환 금지
        } // 숫자 값 끝
        $this->bad(); // 알 수 없는 값
    } // 값 끝
} // reader 끝
