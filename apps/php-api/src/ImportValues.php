<?php // 서버 소유 매핑과 정확한 값 검증
declare(strict_types=1); // 엄격한 자료형
final class ImportValues // 순수 정규화
{ // 검증 시작
    public static function bad(string $message): never // 공통 입력 오류
    { // 거부 시작
        throw new ApiException(400, 'INVALID_IMPORT', $message); // 한글 안내
    } // 거부 끝
    public static function keys(array $input, array $allowed): void // 불명 필드 차단
    { // 키 검사
        if (array_diff(array_keys($input), $allowed)) // 지원하지 않는 입력
        { // 입력 거부
            self::bad('지원하지 않는 입력 필드가 있습니다.'); // 명확한 계약
        } // 입력 거부 끝
    } // 키 검사 끝
    public static function config(array $input, array $sourceColumns, ?array $dataset): array // 서버 검증 설정
    { // 설정 시작
        self::keys($input, ['mode', 'name', 'target_dataset_id', 'expected_version', 'columns', 'key_column', 'duplicate_policy']); // 허용 필드
        $mode = $input['mode'] ?? 'create'; $policy = $input['duplicate_policy'] ?? 'skip'; // 기본 정책
        $name = $input['name'] ?? ''; $columns = $input['columns'] ?? null; // 사용자 설정
        if (!in_array($mode, ['create', 'merge'], true) || !in_array($policy, ['skip', 'update'], true) || !is_array($columns) || !array_is_list($columns) || count($columns) > 50) // 자료형 검증
        { // 설정 거부
            self::bad('가져오기 방식·컬럼·중복 정책을 확인하세요.'); // 조작 안내
        } // 설정 거부 끝
        if (($mode === 'merge') !== ($dataset !== null)) // 대상 일치
        { // 대상 거부
            self::bad('재가져오기 대상이 올바르지 않습니다.'); // 범위 보호
        } // 대상 거부 끝
        if ($dataset === null && (!is_string($name) || trim($name) === '' || mb_strlen(trim($name)) > 120)) // 신규 이름
        { // 이름 거부
            self::bad('데이터셋 이름은 1~120자로 입력하세요.'); // 이름 안내
        } // 이름 거부 끝
        $sourceIds = array_column($sourceColumns, 'source_id'); $seen = []; $labels = []; $mapped = []; // 실제 열 기준
        $fixed = $dataset === null ? [] : json_decode($dataset['schema_json'], true, 32, JSON_THROW_ON_ERROR); // 기존 스키마
        foreach ($columns as $column) // 포함할 열
        { // 매핑 검사
            if (!is_array($column)) // 객체 형식
            { // 매핑 거부
                self::bad('컬럼 설정은 객체여야 합니다.'); // 형식 안내
            } // 매핑 거부 끝
            self::keys($column, ['id', 'source_id', 'label', 'type', 'required']); // 열 계약
            if (($column['type'] ?? '') === 'exclude' && $dataset === null) // 명시적 제외
            { // 제외 처리
                continue; // 저장 스키마에서 생략
            } // 제외 처리 끝
            $sourceId = $column['source_id'] ?? null; // 원본 내부 ID
            if (!is_string($sourceId) || !in_array($sourceId, $sourceIds, true) || isset($seen[$sourceId])) // 실제 열과 일대일 매핑
            { // 원본 거부
                self::bad('원본 컬럼을 한 번씩만 연결하세요.'); // 중복 안내
            } // 원본 거부 끝
            $seen[$sourceId] = true; $i = count($mapped); // 확정 순서
            if ($dataset !== null) // 고정 스키마
            { // 기존 필드 연결
                $target = $fixed[$i] ?? null; // 순서 기준
                if ($target === null || ($column['id'] ?? null) !== $target['id'] || array_diff(array_keys($column), ['id', 'source_id'])) // 형식 변경 금지
                { // 변경 거부
                    self::bad('기존 필드 순서·형식·키는 변경할 수 없습니다.'); // 재가져오기 규칙
                } // 변경 거부 끝
                $mapped[] = $target + ['source_id' => $sourceId]; // 고정 필드
            } // 기존 필드 연결 끝
            else // 신규 필드
            { // 새 스키마
                $label = $column['label'] ?? ''; $type = $column['type'] ?? ''; $required = $column['required'] ?? false; // 명시 설정
                if (!is_string($label) || trim($label) === '' || mb_strlen(trim($label)) > 120 || in_array(trim($label), $labels, true) || !in_array($type, ['text', 'number', 'date'], true) || !is_bool($required) || isset($column['id'])) // 신규 필드 검증
                { // 필드 거부
                    self::bad('서로 다른 필드 이름·자료형·필수 여부를 확인하세요.'); // 값 안내
                } // 필드 거부 끝
                $labels[] = trim($label); // 이름 중복 방지
                $mapped[] = ['id' => 'c' . $i, 'source_id' => $sourceId, 'label' => trim($label), 'type' => $type, 'required' => $required]; // 서버 ID 부여
            } // 새 스키마 끝
        } // 매핑 검사 끝
        if (!$mapped || ($dataset !== null && count($mapped) !== count($fixed))) // 최소 필드와 전체 연결
        { // 매핑 거부
            self::bad('가져올 필드를 모두 연결하세요.'); // 연결 안내
        } // 매핑 거부 끝
        $key = $dataset === null ? ($input['key_column'] ?? null) : $dataset['key_column']; // 고정 또는 신규 키
        if ($key !== null && (!is_string($key) || !in_array($key, array_column($mapped, 'id'), true))) // 유효한 포함 키
        { // 키 거부
            self::bad('키는 포함한 필드 하나여야 합니다.'); // 키 안내
        } // 키 거부 끝
        if ($dataset !== null && ($key === null || (array_key_exists('key_column', $input) && $input['key_column'] !== $key))) // 재가져오기 식별
        { // 키 없는 자료
            self::bad('키 없는 자료는 새 데이터셋으로 저장하세요. 기존 키는 변경할 수 없습니다.'); // 보존 안내
        } // 키 없는 자료 끝
        foreach ($mapped as &$column) // 키 필수 지정
        { // 필수 강화
            if ($column['id'] === $key) // 식별 필드
            { // 비어 있는 키 금지
                $column['required'] = true; // 저장 일관성
            } // 키 검사 끝
        } // 필수 강화 끝
        unset($column); // 참조 해제
        return ['mode' => $mode, 'name' => $dataset['name'] ?? trim($name), 'target_dataset_id' => $dataset === null ? null : (int) $dataset['dataset_id'], 'target_version' => $dataset === null ? null : (int) $dataset['version'], 'columns' => $mapped, 'key_column' => $key, 'duplicate_policy' => $policy]; // 검증한 설정
    } // 설정 끝
    public static function number(string $value): ?string // 정확한 10진 표현
    { // 숫자 시작
        if (!preg_match('/\A[+-]?[0-9]+(?:\.[0-9]{1,6})?\z/D', $value)) // 지수·통화·쉼표 제외
        { // 숫자 거부
            return null; // 값 오류
        } // 숫자 거부 끝
        $negative = $value[0] === '-'; $value = ltrim($value, '+-'); // 부호 분리
        $parts = explode('.', $value, 2); $integer = ltrim($parts[0], '0'); $integer = $integer === '' ? '0' : $integer; // 정수 정규화
        $fraction = rtrim($parts[1] ?? '', '0'); // 의미 없는 소수0
        if (strlen($integer) > 12) // 정수부 한도
        { // 범위 거부
            return null; // DECIMAL 정확성
        } // 범위 거부 끝
        return ($negative && ($integer !== '0' || $fraction !== '') ? '-' : '') . $integer . ($fraction !== '' ? '.' . $fraction : ''); // 음수0 통일
    } // 숫자 끝
    public static function row(array $sourceRow, array $config): array // 행별 값 검사
    { // 행 시작
        $values = []; $errors = $sourceRow['errors']; $keyValue = null; // 구조 오류 유지
        foreach ($config['columns'] as $column) // 포함 필드 순서
        { // 셀 검증
            $index = (int) substr($column['source_id'], 1); $value = $sourceRow['values'][$index] ?? null; // 실제 원본 위치
            if (isset($sourceRow['invalid_sources'][$column['source_id']])) // 구조 오류가 만든 값
            { // 기존 구조 오류만 유지
                $values[] = null; continue; // 거짓 필수·형식 오류 추가 금지
            } // 구조 오류 유지 끝
            $message = null; // 값 오류
            if ($value === null || (is_string($value) && trim($value) === '')) // 빈 값
            { // 필수 검사
                $value = null; $message = $column['required'] ? '필수 값이 비어 있습니다.' : null; // 선택 빈 값 null
            } // 필수 검사 끝
            elseif ((!is_string($value) && !is_bool($value)) || (is_string($value) && mb_strlen($value) > 4000)) // 셀 한도
            { // 셀 거부
                $message = '지원하지 않는 값이거나 4,000자를 초과합니다.'; // 제한 안내
            } // 셀 거부 끝
            elseif ($column['type'] === 'text') // 문자 원문
            { // 문자 정규화
                $value = is_bool($value) ? ($value ? 'true' : 'false') : $value; // JSON boolean 문자만
            } // 문자 정규화 끝
            elseif (is_bool($value)) // 숫자·날짜 boolean
            { // 자료형 거부
                $message = '참·거짓 값은 문자 필드로 지정하세요.'; // 명확한 형식
            } // 자료형 거부 끝
            elseif ($column['type'] === 'number') // 정확한 수치
            { // 수치 정규화
                $value = self::number(trim($value)); $message = $value === null ? '숫자는 정수부 12자리·소수 6자리 이내로 입력하세요.' : null; // 잘못된 변환 금지
            } // 수치 정규화 끝
            else // 날짜 필드
            { // 달력 검사
                $value = trim($value); // 날짜 공백만 정리
                if (!preg_match('/\A[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}\z/D', $value) || !checkdate((int) substr($value, 5, 2), (int) substr($value, 8, 2), (int) substr($value, 0, 4))) // 형식과 실제 날짜
                { // 날짜 거부
                    $message = '날짜는 실제 존재하는 1000~9999년 YYYY-MM-DD여야 합니다.'; // 날짜 안내
                } // 날짜 거부 끝
            } // 달력 검사 끝
            if ($message !== null) // 값 오류 위치
            { // 오류 추가
                $original = $sourceRow['values'][$index] ?? null; // 변환 전 자료형
                $missing = $original === null || (is_string($original) && trim($original) === ''); // 실제 결측 판정
                $invalidCell = !is_string($original) || mb_strlen($original) > 4000; // 범용 셀 제한
                $code = $missing ? 'REQUIRED_MISSING' : ($invalidCell ? 'INVALID_CELL' : ($column['type'] === 'number' ? 'INVALID_NUMBER' : 'INVALID_DATE')); // 기존 오류의 세분 코드
                $errors[] = ['source_row' => $sourceRow['source_row'], 'source_id' => $column['source_id'], 'field' => $column['label'], 'code' => $code, 'message' => $message]; // 원문 없는 보고
                $value = null; // 잘못된 값 저장 금지
            } // 오류 추가 끝
            $values[] = $value; // 필드 순서
            if ($column['id'] === $config['key_column']) // 단일 키
            { // 키 선택
                $keyValue = $value; // 정규화한 키
            } // 키 선택 끝
        } // 셀 검증 끝
        return ['source_row' => $sourceRow['source_row'], 'values' => $values, 'key_value' => $keyValue, 'key_hash' => $keyValue === null ? null : hash('sha256', $keyValue), 'errors' => $errors]; // 저장 가능 행
    } // 행 끝
} // 검증 끝
