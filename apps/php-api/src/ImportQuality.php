<?php // 불변 품질 보고서 보관과 조회
declare(strict_types=1); // 엄격한 자료형
final class ImportQuality // 검사 이력에 결합한 보고서
{ // 서비스 시작
    public const TYPES = ['required_missing', 'invalid_number', 'invalid_date', 'invalid_cell', 'invalid_row', 'optional_missing', 'duplicate_file', 'duplicate_existing']; // 허용 문제 유형
    private const MESSAGES = ['required_missing' => '필수 값이 비어 있습니다.', 'invalid_number' => '정수부12자리·소수6자리 이내 숫자를 확인하세요.', 'invalid_date' => '실제 존재하는 YYYY-MM-DD 날짜를 확인하세요.', 'invalid_cell' => '셀 자료형 또는 4,000자 제한을 확인하세요.', 'invalid_row' => '행 구조·열 수·배열 셀·제어 문자를 확인하세요.', 'optional_missing' => '선택 컬럼이 비어 있습니다. null로 저장됩니다.', 'duplicate_file' => '파일 안에서 앞서 나온 정상 키와 중복됩니다.', 'duplicate_existing' => '기존 데이터의 정상 키와 중복됩니다.']; // 원문 없는 설명
    private static function json(array $value): string // 작은 JSON 직렬화
    { // 변환 시작
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR); // 정확한 값 유지
    } // 변환 끝
    public static function begin(int $projectId, int $actorId, array $draft, array $config, int $revision): int // 현재 트랜잭션의 검사 준비
    { // 보고서 준비
        Database::run('INSERT INTO import_runs (project_id,dataset_id,actor_id,draft_hash,validation_revision,file_name,source_sha256,status) VALUES (?,?,?,?,?,?,?,?)', [$projectId, $config['target_dataset_id'], $actorId, $draft['draft_hash'], $revision, $draft['original_name'], $draft['source_sha256'], 'validating']); // 아직 외부 미공개
        $runId = Database::lastId(); $before = $config['target_dataset_id'] === null ? 0 : (int) Database::one('SELECT row_count FROM import_datasets WHERE dataset_id=? AND project_id=?', [$config['target_dataset_id'], $projectId])['row_count']; // 잠긴 대상의 이전 행 수
        $metadata = ['file_name' => $draft['original_name'], 'format' => $draft['format'], 'encoding' => $draft['encoding'], 'json_path' => $draft['json_path'], 'schema' => $config['columns'], 'key_column' => $config['key_column'], 'duplicate_policy' => $config['duplicate_policy'], 'target_dataset_id' => $config['target_dataset_id'], 'target_version' => $config['target_version']]; // 검사 당시 조건
        Database::run('INSERT INTO import_quality_reports (run_id,metadata_json,summary_json,expected_json) VALUES (?,?,?,?)', [$runId, self::json($metadata), '{}', self::json(['before_rows' => $before])]); // 원문 없는 작은 헤더
        return $runId; // 행별 기록 식별자
    } // 보고서 준비 끝
    public static function append(int $runId, int $sourceRow, array $issues): void // 작은 문제 행 기록
    { // 문제 행 저장
        if ($issues) // 정상 행은 저장 생략
        { // 문제 행 추가
            Database::run('INSERT INTO import_quality_rows (run_id,source_row,issues_json) VALUES (?,?,?)', [$runId, $sourceRow, self::json($issues)]); // 단일 패킷 한도 안
        } // 문제 행 추가 끝
    } // 문제 행 저장 끝
    public static function finish(int $runId, array $summary, array $report): void // 검사 결과 확정
    { // 검증 마무리
        $stored = Database::one('SELECT expected_json FROM import_quality_reports WHERE run_id=?', [$runId]); $expected = json_decode($stored['expected_json'], true, 32, JSON_THROW_ON_ERROR); // 이전 행 수 유지
        $expected += array_intersect_key($report, array_flip(['inserted', 'updated', 'skipped'])); // 기존 엔진 예상치
        Database::run('UPDATE import_quality_reports SET summary_json=?,expected_json=? WHERE run_id=?', [self::json($summary), self::json($expected), $runId]); // 집계 원자적 저장
        Database::run('UPDATE import_runs SET status=?,received=?,inserted=?,updated=?,skipped=?,error_count=?,report_json=? WHERE run_id=?', [$report['can_commit'] ? 'validated' : 'invalid', $report['received'], $report['inserted'], $report['updated'], $report['skipped'], $report['error_count'], self::json($report), $runId]); // 기존 이력 계약
    } // 검증 마무리 끝
    public static function confirm(int $runId, array $result, int $beforeRows): void // 성공 트랜잭션의 실제 건수
    { // 확정 기록
        $stored = Database::one('SELECT expected_json FROM import_quality_reports WHERE run_id=?', [$runId]); // 과거 검증 호환
        if ($stored === null) // 기존31일차의 살아 있는 초안
        { // 과거 보고서 생성 생략
            return; // 없는 수치를 추정하지 않음
        } // 과거 보고서 생략 끝
        $expected = json_decode($stored['expected_json'], true, 32, JSON_THROW_ON_ERROR); // 검사 예상치
        if ($expected['before_rows'] !== $beforeRows || $result['row_count'] !== $beforeRows + $result['inserted'] || $expected['inserted'] !== $result['inserted'] || $expected['updated'] !== $result['updated'] || $expected['skipped'] !== $result['skipped']) // 정합성 검증
        { // 부분 성공 차단
            throw new ApiException(409, 'IMPORT_CONFLICT', '검사와 저장 건수가 다릅니다. 다시 검사하세요.'); // 전체 롤백
        } // 정합성 검사 끝
        $actual = array_intersect_key($result, array_flip(['inserted', 'updated', 'skipped', 'version'])) + ['after_rows' => $result['row_count'], 'committed_at' => date('Y-m-d H:i:s')]; // 실제 성공 정보
        Database::run('UPDATE import_quality_reports SET actual_json=? WHERE run_id=?', [self::json($actual), $runId]); // 데이터와 같은 트랜잭션
    } // 확정 기록 끝
    private static function read(callable $operation): array // 동일 읽기 스냅샷
    { // 읽기 시작
        $pdo = Database::pdo(); $pdo->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); $pdo->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'); // 상태와 actual 동시 조회
        try // 조회 보호
        { // 실행 시작
            $result = $operation(); $pdo->commit(); return $result; // 일관된 결과
        } // 실행 끝
        catch (Throwable $error) // 조회 실패
        { // 읽기 정리
            if ($pdo->inTransaction()) // 열린 스냅샷
            { // 롤백
                $pdo->rollBack(); // 연결 복구
            } // 롤백 끝
            throw $error; // 실제 오류 전달
        } // 읽기 정리 끝
    } // 읽기 끝
    private static function fetch(int $projectId, int $runId): array // 작업실 범위 보고서
    { // 상세 조회
        $row = Database::one('SELECT q.*,r.status FROM import_quality_reports q JOIN import_runs r ON r.run_id=q.run_id WHERE r.project_id=? AND q.run_id=?', [$projectId, $runId]); // 권한 범위 제한
        if ($row === null) // 과거 보고서 없음 또는 다른 작업실
        { // 동일 오류
            throw new ApiException(404, 'QUALITY_REPORT_NOT_FOUND', '상세 품질 보고서가 없습니다. 이전 이력은 보고서 없이 보관될 수 있습니다.'); // 추정 생성 금지
        } // 오류 끝
        $metadata = json_decode($row['metadata_json'], true, 64, JSON_THROW_ON_ERROR); $summary = json_decode($row['summary_json'], true, 64, JSON_THROW_ON_ERROR); $expected = json_decode($row['expected_json'], true, 32, JSON_THROW_ON_ERROR); $actual = $row['actual_json'] === null ? null : json_decode($row['actual_json'], true, 32, JSON_THROW_ON_ERROR); // 작은 스냅샷
        $comparison = $actual === null ? null : ['counts_match' => $expected['inserted'] === $actual['inserted'] && $expected['updated'] === $actual['updated'] && $expected['skipped'] === $actual['skipped'] && $summary['received'] === $actual['inserted'] + $actual['updated'] + $actual['skipped'], 'row_count_match' => $actual['after_rows'] === $expected['before_rows'] + $actual['inserted']]; // 예상과 확정 구분
        return $metadata + ['run_id' => $runId, 'format_version' => (int) $row['format_version'], 'checked_at' => $row['created_at'], 'status' => $row['status'], 'summary' => $summary, 'expected' => $expected, 'actual' => $actual, 'comparison' => $comparison]; // 원문·토큰 없는 응답
    } // 상세 조회 끝
    public static function detail(int $projectId, int $runId): array // 공개 상세
    { // 읽기 경계
        return self::read(static fn (): array => self::fetch($projectId, $runId)); // 하나의 스냅샷
    } // 상세 끝
    public static function rows(int $projectId, int $runId, array $query): array // 문제 행 필터·페이지
    { // 조회 시작
        ImportValues::keys($query, ['page', 'severity', 'type', 'column']); // 불명 조건 거부
        foreach ($query as $value) // 문자열만 허용
        { // 형식 검사
            if (!is_string($value) || $value === '') // 배열과 빈 조건
            { // 입력 거부
                ImportValues::bad('품질 조회 조건은 비어 있지 않은 문자열이어야 합니다.'); // 명확한 형식
            } // 입력 거부 끝
        } // 형식 검사 끝
        return self::read(static function () use ($projectId, $runId, $query): array // 한 보고서 스냅샷
        { // 읽기 본문
            $report = self::fetch($projectId, $runId); $columns = array_column($report['schema'], 'label', 'source_id') + ['__row__' => '행 구조/중복']; // 당시 표시 이름
            $page = $query['page'] ?? '1'; // 기본 페이지
            if (preg_match('/\A[1-9][0-9]{0,8}\z/D', $page) !== 1 || (isset($query['severity']) && !in_array($query['severity'], ['error', 'warning'], true)) || (isset($query['type']) && !in_array($query['type'], self::TYPES, true)) || (isset($query['column']) && !isset($columns[$query['column']]))) // 조건 허용 목록
            { // 잘못된 조건
                ImportValues::bad('품질 페이지·심각도·유형·컬럼을 확인하세요.'); // 입력400
            } // 조건 거부 끝
            $requested = (int) $page; $total = 0; $selected = []; $tail = []; $cursor = 0; // 최대 두 페이지 메모리
            do // 작은 DB 배치
            { // 배치 조회
                $batch = Database::all('SELECT source_row,issues_json FROM import_quality_rows WHERE run_id=? AND source_row>? ORDER BY source_row LIMIT 200', [$runId, $cursor]); // 전체 배열 누적 금지
                foreach ($batch as $row) // 원본 행 순서
                { // 필터 적용
                    $cursor = (int) $row['source_row']; $issues = []; // 현재 행
                    foreach (json_decode($row['issues_json'], true, 32, JSON_THROW_ON_ERROR) as [$severity, $type, $column]) // 압축 항목 복원
                    { // 항목 조건
                        if ((isset($query['severity']) && $query['severity'] !== $severity) || (isset($query['type']) && $query['type'] !== $type) || (isset($query['column']) && $query['column'] !== $column)) // 교집합
                        { // 불일치 생략
                            continue; // 해당 항목만 제외
                        } // 불일치 끝
                        $issues[] = ['severity' => $severity, 'type' => $type, 'source_id' => $column, 'field' => $columns[$column] ?? '행 구조', 'message' => self::MESSAGES[$type] ?? '행 구조를 확인하세요.']; // 원문 없는 설명
                    } // 항목 조건 끝
                    if (!$issues) // 조건에 맞는 항목 없음
                    { // 행 제외
                        continue; // 페이지 집계 제외
                    } // 행 제외 끝
                    $entry = ['source_row' => $cursor, 'issues' => $issues]; // 문제 행 한 개
                    if ($total % 20 === 0) // 새 페이지 시작
                    { // 마지막 페이지 보관
                        $tail = []; // 최대20행
                    } // 보관 초기화 끝
                    $tail[] = $entry; // 마지막 페이지 후보
                    if (intdiv($total, 20) + 1 === $requested) // 요청한 페이지
                    { // 요청 결과 추가
                        $selected[] = $entry; // 최대20행
                    } // 요청 결과 끝
                    $total++; // 서로 다른 문제 행
                } // 필터 적용 끝
            } while (count($batch) === 200); // 다음 원본 배치
            $pages = max(1, (int) ceil($total / 20)); // 빈 결과1페이지
            return ['rows' => $requested > $pages ? $tail : $selected, 'pagination' => ['page' => min($requested, $pages), 'page_size' => 20, 'total' => $total, 'total_pages' => $pages]]; // 안정된 행 페이지
        }); // 읽기 본문 끝
    } // 문제 행 조회 끝
} // 서비스 끝
