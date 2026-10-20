<?php // 값 보관 없는 품질 관찰기
declare(strict_types=1); // 엄격한 자료형
final class ImportQualityScan // 행 단위 품질 집계
{ // 관찰기 시작
    private array $totals = ['received' => 0, 'valid_rows' => 0, 'error_rows' => 0, 'error_count' => 0, 'warning_rows' => 0, 'warning_count' => 0, 'duplicate_rows' => 0, 'file_duplicate_rows' => 0, 'existing_duplicate_rows' => 0]; // 독립 카운터
    private array $columns = []; // 원문 없는 컬럼 통계
    public function __construct(array $config) // 포함 컬럼 기준
    { // 초기화
        foreach ($config['columns'] as $column) // 확정 매핑 순서
        { // 통계 준비
            $this->columns[$column['source_id']] = array_intersect_key($column, array_flip(['source_id', 'id', 'label', 'type', 'required'])) + ['missing_count' => 0, 'missing_rate' => 0.0, 'error_count' => 0, 'invalid_count' => 0]; // 메타데이터만 보관
        } // 통계 준비 끝
    } // 초기화 끝
    public function observe(array $raw, array $normalized, bool $fileDuplicate, bool $existingDuplicate): array // 기존 판정 관찰
    { // 행 집계
        $issues = []; $structural = []; $errors = $normalized['errors']; // 원본 오류 위치
        foreach ($raw['errors'] as $error) // 구조가 바꾼 null 위치
        { // 위치 기록
            $structural[$error['source_id'] ?? '__row__'] = true; // 거짓 결측 방지
        } // 위치 기록 끝
        foreach ($errors as $error) // 값·구조 오류
        { // 오류 분류
            $id = $error['source_id'] ?? '__row__'; $type = strtolower($error['code']); // 고정 오류 코드
            $issues[] = ['error', $type, $id]; // 원문·메시지 복제 없음
            if (isset($this->columns[$id])) // 컬럼 소속 오류
            { // 컬럼 통계
                $this->columns[$id]['error_count']++; $this->columns[$id]['invalid_count'] += $type === 'required_missing' ? 0 : 1; // 결측과 형식 분리
            } // 컬럼 통계 끝
        } // 오류 분류 끝
        foreach ($this->columns as $id => &$column) // 포함 컬럼만
        { // 결측 검사
            $value = $raw['values'][(int) substr($id, 1)] ?? null; // 원본 위치
            if (!isset($raw['invalid_sources'][$id]) && !isset($structural[$id]) && ($value === null || (is_string($value) && trim($value) === ''))) // 실제 존재한 빈 값만
            { // 빈 값 집계
                $column['missing_count']++; // 변환 실패와 구분
                if (!$column['required']) // 선택 값
                { // 경고 추가
                    $issues[] = ['warning', 'optional_missing', $id]; // 저장 허용 경고
                } // 경고 추가 끝
            } // 빈 값 집계 끝
        } // 결측 검사 끝
        unset($column); // 참조 해제
        if ($fileDuplicate) // 정상 키의 파일 중복
        { // 경고 기록
            $issues[] = ['warning', 'duplicate_file', '__row__']; // 키 원문 없음
        } // 경고 기록 끝
        if ($existingDuplicate) // 정상 키의 기존 자료 중복
        { // 경고 기록
            $issues[] = ['warning', 'duplicate_existing', '__row__']; // 정책 처리 안내
        } // 경고 기록 끝
        $warnings = count($issues) - count($errors); // 한 행의 경고 수
        $this->totals['received']++; $this->totals['valid_rows'] += $errors ? 0 : 1; $this->totals['error_rows'] += $errors ? 1 : 0; $this->totals['error_count'] += count($errors); // 오류 수와 행 수
        $this->totals['warning_rows'] += $warnings > 0 ? 1 : 0; $this->totals['warning_count'] += $warnings; // 중복 경고 합산
        $this->totals['duplicate_rows'] += $fileDuplicate || $existingDuplicate ? 1 : 0; $this->totals['file_duplicate_rows'] += $fileDuplicate ? 1 : 0; $this->totals['existing_duplicate_rows'] += $existingDuplicate ? 1 : 0; // 합집합과 개별 집합
        return $issues; // 문제 있는 행만 저장 가능
    } // 행 집계 끝
    public function summary(): array // 불변 요약 반환
    { // 요약 시작
        $columns = array_values($this->columns); // 복사본
        foreach ($columns as &$column) // 결측률 계산
        { // 비율 계산
            $column['missing_rate'] = $this->totals['received'] === 0 ? 0.0 : round($column['missing_count'] * 100 / $this->totals['received'], 1); // 고정 분모
        } // 비율 계산 끝
        unset($column); // 참조 해제
        return $this->totals + ['columns' => $columns]; // 원문 없는 집계
    } // 요약 끝
} // 관찰기 끝
