<?php // 한 파일의 원본 필드와 반복 가능한 행
declare(strict_types=1); // 엄격한 자료형
final class ImportSource // CSV·JSON 원본
{ // 원본 시작
    private array $columns = []; // 전체 원본 필드
    private array $paths = []; // 배열 경로 후보
    private array $jsonRows = []; // 선택한 JSON 배열
    private int $rowCount = 0; // 데이터 행 수
    private bool $needsPath = false; // 경로 미선택
    private function __construct(private string $bytes, private string $format) // 파일 소유
    { // 생성 시작
    } // 생성 끝
    public static function open(string $bytes, string $format, string $encoding, ?string $jsonPath): self // 실제 입력 해석
    { // 입력 시작
        if (strlen($bytes) < 1 || strlen($bytes) > 5242880) // 원본 크기
        { // 크기 거부
            throw new ApiException(413, 'FILE_TOO_LARGE', '파일은 최대 5MiB까지 지원합니다.'); // 크기 안내
        } // 크기 거부 끝
        if (!in_array($format, ['csv', 'json'], true) || !in_array($encoding, ['UTF-8', 'CP949'], true) || ($format === 'json' && $encoding !== 'UTF-8')) // 형식과 인코딩
        { // 형식 거부
            throw new ApiException(415, 'INVALID_FILE', 'CSV는 UTF-8·CP949, JSON은 UTF-8만 지원합니다.'); // 지원 안내
        } // 형식 거부 끝
        if ($encoding === 'CP949') // 명시적 국내 인코딩
        { // 무손실 변환
            $converted = mb_convert_encoding($bytes, 'UTF-8', 'CP949'); // UTF-8 변환
            if (mb_convert_encoding($converted, 'CP949', 'UTF-8') !== $bytes) // 치환 또는 손실
            { // 손상 거부
                throw new ApiException(415, 'INVALID_FILE', 'CP949 인코딩을 확인하세요.'); // 재선택 안내
            } // 손상 거부 끝
            $bytes = $converted; // 검증한 UTF-8
        } // 변환 끝
        $bytes = str_starts_with($bytes, "\xEF\xBB\xBF") ? substr($bytes, 3) : $bytes; // BOM 제거
        if (!mb_check_encoding($bytes, 'UTF-8') || preg_match('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', $bytes)) // 손상·제어 문자
        { // 문자 거부
            throw new ApiException(415, 'INVALID_FILE', '파일 인코딩 또는 제어 문자를 확인하세요.'); // 명확한 형식 오류
        } // 문자 거부 끝
        $source = new self($bytes, $format); // 반복 가능한 소유 객체
        if ($format === 'csv') // 헤더 기반 원본
        { // 헤더 수집
            $records = $source->csv(); $records->rewind(); // 첫 레코드
            if (!$records->valid()) // 빈 파일
            { // 빈 입력
                throw new ApiException(415, 'INVALID_FILE', 'CSV 헤더와 데이터가 필요합니다.'); // 헤더 안내
            } // 빈 입력 끝
            foreach ($records->current() as $header) // 모든 헤더
            { // 이름 검증
                $header = trim($header); // 헤더 공백 정리
                if ($header === '' || mb_strlen($header) > 120 || in_array($header, array_column($source->columns, 'label'), true)) // 이름 충돌
                { // 헤더 거부
                    throw new ApiException(415, 'INVALID_FILE', '헤더는 비어 있지 않은 서로 다른 120자 이내 이름이어야 합니다.'); // 수정 안내
                } // 헤더 거부 끝
                $source->addColumn($header, $header); // 전체 열
            } // 헤더 수집 끝
        } // CSV 준비 끝
        else // JSON 경로 원본
        { // JSON 준비
            $root = ImportJsonReader::decode($bytes); // 숫자와 키 보존
            $source->discover($root, ''); // 제한된 후보
            if ($jsonPath === null && $root instanceof stdClass) // 경로 선택 전
            { // 후보 응답
                $source->needsPath = true; return $source; // 행 검증은 선택 이후
            } // 후보 응답 끝
            $selected = $source->select($root, $jsonPath ?? ''); // JSON Pointer 선택
            if (!is_array($selected) || !array_is_list($selected)) // 객체 배열만
            { // 선택 거부
                throw new ApiException(415, 'INVALID_FILE', '객체 배열 경로를 선택하세요.'); // 구조 안내
            } // 선택 거부 끝
            $source->jsonRows = $selected; // 선택 배열
            foreach ($selected as $record) // 전체 필드 합집합
            { // 필드 발견
                if ($record instanceof stdClass) // 객체 행
                { // 중첩 필드
                    foreach ($source->flatten($record) as $path => $value) // 전체 경로
                    { // 경로 추가
                        $source->addColumn($path, $path); // 첫 등장 순서
                    } // 경로 추가 끝
                } // 중첩 필드 끝
            } // 필드 발견 끝
        } // JSON 준비 끝
        $size = 0; // 행 표현 자원
        foreach ($source->rows() as $row) // 전체 구문과 한도
        { // 행 검사
            $source->rowCount++; // 헤더 제외 수
            $size += strlen(json_encode($row['values'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)); // 정규화 전 표현
            if ($source->rowCount > 10000 || $size > 12582912) // 원본 행 제한
            { // 자원 거부
                throw new ApiException(413, 'FILE_TOO_LARGE', '최대 10,000행과 12MiB 행 표현을 지원합니다.'); // 제한 안내
            } // 자원 거부 끝
        } // 행 검사 끝
        if ($source->rowCount === 0 || !$source->columns) // 빈 자료
        { // 빈 자료 거부
            throw new ApiException(415, 'INVALID_FILE', '가져올 필드와 데이터 행이 필요합니다.'); // 빈 입력 안내
        } // 빈 자료 거부 끝
        return $source; // 검증한 원본
    } // 입력 끝
    private function addColumn(string $path, string $label): void // 첫 등장 필드
    { // 열 추가
        if (in_array($path, array_column($this->columns, 'path'), true)) // 이미 발견한 경로
        { // 중복 열 유지
            return; // 한 번만 추가
        } // 중복 열 끝
        if (count($this->columns) >= 50) // 원본 필드 제한
        { // 필드 거부
            throw new ApiException(413, 'FILE_TOO_LARGE', '원본 필드는 최대 50개입니다.'); // 한도 안내
        } // 필드 거부 끝
        if (mb_strlen($label) > 120) // 표시 경로 길이
        { // 길이 거부
            throw new ApiException(415, 'INVALID_FILE', '필드 경로는 120자 이내여야 합니다.'); // 경로 수정 안내
        } // 길이 거부 끝
        $this->columns[] = ['source_id' => 's' . count($this->columns), 'path' => $path, 'label' => $label]; // 내부 식별자
    } // 열 추가 끝
    private function flatten(stdClass $object, string $prefix = '', int $depth = 1): array // 행 객체 펼치기
    { // 펼치기 시작
        if ($depth > 5) // 행 중첩 한도
        { // 깊이 거부
            throw new ApiException(415, 'INVALID_FILE', '행의 중첩 객체는 최대 5단계입니다.'); // 구조 안내
        } // 깊이 거부 끝
        $values = []; // 경로별 셀
        foreach (get_object_vars($object) as $key => $value) // 원본 속성
        { // 경로 구성
            $path = $prefix . '/' . str_replace(['~', '/'], ['~0', '~1'], (string) $key); // 표준 Pointer
            $values += $value instanceof stdClass ? $this->flatten($value, $path, $depth + 1) : [$path => $value]; // 객체만 펼치기
        } // 경로 구성 끝
        return $values; // 경로 셀
    } // 펼치기 끝
    private function discover(mixed $value, string $path): void // 배열 후보 탐색
    { // 탐색 시작
        if (count($this->paths) >= 20) // 응답 크기 제한
        { // 탐색 제한
            return; // 직접 경로 입력은 별도 지원
        } // 탐색 제한 끝
        if (is_array($value)) // 배열 후보
        { // 후보 수집
            $this->paths[] = ['path' => $path, 'row_count' => count($value)]; // 원본 개수
        } // 후보 수집 끝
        elseif ($value instanceof stdClass) // 객체 내부
        { // 하위 후보
            foreach (get_object_vars($value) as $key => $child) // 속성 탐색
            { // 경로 전달
                $this->discover($child, $path . '/' . str_replace(['~', '/'], ['~0', '~1'], (string) $key)); // 안전한 경로
            } // 경로 전달 끝
        } // 하위 후보 끝
    } // 탐색 끝
    private function select(mixed $value, string $path): mixed // Pointer 값 선택
    { // 선택 시작
        if (strlen($path) > 1024 || ($path !== '' && $path[0] !== '/')) // 경로 형식
        { // 경로 거부
            throw new ApiException(415, 'INVALID_FILE', 'JSON 배열 경로를 확인하세요.'); // 형식 안내
        } // 경로 거부 끝
        foreach ($path === '' ? [] : explode('/', substr($path, 1)) as $part) // 각 경로 조각
        { // 경로 이동
            if (preg_match('/~(?![01])/', $part)) // 잘못된 escape
            { // 경로 거부
                throw new ApiException(415, 'INVALID_FILE', 'JSON 경로 이스케이프를 확인하세요.'); // 표준 안내
            } // 경로 거부 끝
            $part = str_replace(['~1', '~0'], ['/', '~'], $part); // 이스케이프 복원
            if ($value instanceof stdClass && property_exists($value, $part)) // 객체 속성
            { // 객체 이동
                $value = $value->{$part}; // 실제 필드
            } // 객체 이동 끝
            elseif (is_array($value) && preg_match('/\A(?:0|[1-9][0-9]*)\z/', $part) && array_key_exists($part, $value)) // 배열 인덱스
            { // 배열 이동
                $value = $value[$part]; // 실제 항목
            } // 배열 이동 끝
            else // 존재하지 않는 경로
            { // 경로 거부
                throw new ApiException(415, 'INVALID_FILE', '선택한 JSON 경로가 없습니다.'); // 재선택 안내
            } // 경로 거부 끝
        } // 경로 이동 끝
        return $value; // 선택 값
    } // 선택 끝
    private function csv(): Generator // 엄격한 쉼표 레코드
    { // CSV 시작
        $field = ''; $fields = []; $state = 0; // 0 일반·1 인용·2 인용 종료
        $length = strlen($this->bytes); // 원본 길이
        for ($i = 0; $i < $length; $i++) // 바이트 순회
        { // 문자 처리
            $char = $this->bytes[$i]; // 현재 바이트
            if ($state === 1) // 인용 내부
            { // 원문 보존
                if ($char === '"' && ($this->bytes[$i + 1] ?? '') === '"') // 두 겹 인용
                { // 문자 인용
                    $field .= '"'; $i++; // 한 부호 보존
                } // 문자 인용 끝
                elseif ($char === '"') // 인용 종료
                { // 상태 전환
                    $state = 2; // 구분자만 허용
                } // 상태 전환 끝
                else // 셀 본문
                { // 원본 추가
                    $field .= $char; // 줄바꿈 포함
                } // 원본 추가 끝
                continue; // 구분자 해석 금지
            } // 인용 내부 끝
            if ($char === '"' && $state === 0 && $field === '') // 여는 인용
            { // 인용 시작
                $state = 1; continue; // 다음 문자
            } // 인용 시작 끝
            if ($char === ',' || $char === "\n" || $char === "\r") // 필드·행 경계
            { // 경계 처리
                $blank = !$fields && $field === '' && $state === 0; // 실제 빈 줄
                $fields[] = $field; $field = ''; $state = 0; // 셀 확정
                if (count($fields) > 50) // 한 레코드 한도
                { // 열 거부
                    throw new ApiException(413, 'FILE_TOO_LARGE', '원본 필드는 최대 50개입니다.'); // 자원 보호
                } // 열 거부 끝
                if ($char !== ',') // 행 끝
                { // 레코드 반환
                    if ($char === "\r" && ($this->bytes[$i + 1] ?? '') === "\n") // Windows 줄 끝
                    { // 한 경계 처리
                        $i++; // CRLF 결합
                    } // 한 경계 끝
                    if (!$blank) // 빈 줄 제외
                    { // 원본 행
                        yield $fields; // 순서 유지
                    } // 원본 행 끝
                    $fields = []; // 다음 행
                } // 레코드 반환 끝
                continue; // 다음 문자
            } // 경계 처리 끝
            if ($state === 2 || $char === '"') // 잘못된 인용 구문
            { // 구문 거부
                throw new ApiException(415, 'INVALID_FILE', 'CSV 따옴표와 구분자를 확인하세요.'); // 임의 보정 금지
            } // 구문 거부 끝
            $field .= $char; // 일반 본문
        } // 문자 처리 끝
        if ($state === 1) // 미완성 인용
        { // 구문 거부
            throw new ApiException(415, 'INVALID_FILE', 'CSV 따옴표가 닫히지 않았습니다.'); // 명확한 오류
        } // 구문 거부 끝
        if ($fields || $field !== '' || $state === 2) // 마지막 레코드
        { // 마지막 셀
            $fields[] = $field; // 마지막 값
            if (count($fields) > 50) // 마지막 레코드도 같은 제한
            { // 열 거부
                throw new ApiException(413, 'FILE_TOO_LARGE', '원본 필드는 최대 50개입니다.'); // 줄 끝 없는 파일 보호
            } // 열 거부 끝
            yield $fields; // 줄 끝 없는 파일
        } // 마지막 셀 끝
    } // CSV 끝
    public function rows(): Generator // 재실행 가능한 데이터 행
    { // 행 반복
        if ($this->format === 'csv') // 헤더 이후 행
        { // CSV 데이터
            $first = true; $number = 0; // 헤더와 데이터 번호
            foreach ($this->csv() as $values) // 레코드 순서
            { // 원본 레코드
                if ($first) // 헤더 제외
                { // 헤더 처리
                    $first = false; continue; // 값으로 저장 금지
                } // 헤더 처리 끝
                $number++; $errors = []; // 데이터 위치
                if (count($values) !== count($this->columns)) // 열 수 불일치
                { // 구조 오류
                    $errors[] = ['source_row' => $number, 'source_id' => null, 'field' => '행 구조', 'code' => 'INVALID_ROW', 'message' => '헤더와 열 수가 다릅니다.']; // 위치 안내
                } // 구조 오류 끝
                yield ['source_row' => $number, 'values' => $values, 'errors' => $errors]; // 원본 전달
            } // 레코드 끝
        } // CSV 데이터 끝
        else // JSON 데이터
        { // JSON 반복
            foreach ($this->jsonRows as $i => $record) // 선택한 배열
            { // 행 펼치기
                $errors = []; $flat = $record instanceof stdClass ? $this->flatten($record) : []; // 객체만 지원
                if (!$record instanceof stdClass) // 비객체 행
                { // 구조 오류
                    $errors[] = ['source_row' => $i + 1, 'source_id' => null, 'field' => '행 구조', 'code' => 'INVALID_ROW', 'message' => '각 행은 객체여야 합니다.']; // 형식 안내
                } // 구조 오류 끝
                $values = []; // 스키마 순서
                foreach ($this->columns as $column) // 전체 필드
                { // 셀 읽기
                    $value = $flat[$column['path']] ?? null; // 없는 필드 null
                    if (is_array($value)) // 배열 셀
                    { // 지원하지 않는 구조
                        $errors[] = ['source_row' => $i + 1, 'source_id' => $column['source_id'], 'field' => $column['label'], 'code' => 'INVALID_ROW', 'message' => '배열 셀은 지원하지 않습니다.']; $value = null; // 구조 안내
                    } // 배열 셀 끝
                    if (is_string($value) && preg_match('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', $value)) // escaped 제어 문자
                    { // 셀 구조 오류
                        $errors[] = ['source_row' => $i + 1, 'source_id' => $column['source_id'], 'field' => $column['label'], 'code' => 'INVALID_ROW', 'message' => '제어 문자를 포함한 셀은 지원하지 않습니다.']; $value = null; // decoded 값 보호
                    } // 셀 구조 오류 끝
                    $values[] = $value; // 순서 보존
                } // 셀 읽기 끝
                yield ['source_row' => $i + 1, 'values' => $values, 'errors' => $errors]; // 원본 행
            } // 행 펼치기 끝
        } // JSON 반복 끝
    } // 행 반복 끝
    public function columns(): array // 공개 필드
    { // 조회 시작
        return $this->columns; // 안전한 메타데이터
    } // 조회 끝
    public function paths(): array // 배열 후보
    { // 조회 시작
        return $this->paths; // 최대20개
    } // 조회 끝
    public function count(): int // 전체 데이터 행
    { // 조회 시작
        return $this->rowCount; // 헤더 제외
    } // 조회 끝
    public function requiresPath(): bool // 경로 선택 여부
    { // 조회 시작
        return $this->needsPath; // 미선택 상태
    } // 조회 끝
    public function preview(int $limit = 20): array // 제한된 원본 미리보기
    { // 미리보기 시작
        $rows = []; // 첫 행만
        foreach ($this->rows() as $row) // 원본 반복
        { // 행 추가
            if (count($rows) >= $limit) // 미리보기 제한
            { // 종료 시작
                break; // 나머지 본문 전송 금지
            } // 종료 끝
            $rows[] = $row; // 원본 위치 포함
        } // 행 추가 끝
        return $rows; // 제한된 자료
    } // 미리보기 끝
} // 원본 끝
