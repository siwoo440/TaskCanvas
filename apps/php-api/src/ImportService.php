<?php // 전체 검증과 멱등 데이터셋 저장
declare(strict_types=1); // 엄격한 자료형
final class ImportService // 가져오기 원자적 적용
{ // 서비스 시작
    public static function positive(mixed $value, string $label): int // JSON 정수 필드
    { // 정수 검사
        if (!is_int($value) || $value < 1) // 실제 양의 정수
        { // 입력 거부
            ImportValues::bad($label . '는 양의 정수여야 합니다.'); // 형식 안내
        } // 입력 거부 끝
        return $value; // 검증한 ID
    } // 정수 검사 끝
    private static function source(array $draft): ImportSource // 서버 원본 재해석
    { // 원본 시작
        $source = ImportSource::open($draft['bytes'], $draft['format'], $draft['encoding'], $draft['json_path']); // 조작 불가능한 보관본
        if ($source->requiresPath()) // 배열 미선택
        { // 순서 안내
            ImportValues::bad('JSON 배열 경로를 먼저 선택하세요.'); // 미리보기 필요
        } // 순서 안내 끝
        return $source; // 반복 가능한 행
    } // 원본 끝
    private static function dataset(int $projectId, int $datasetId): array // 같은 작업실의 잠긴 자료
    { // 대상 읽기
        $dataset = Database::one('SELECT * FROM import_datasets WHERE project_id=? AND dataset_id=? FOR UPDATE', [$projectId, $datasetId]); // 조회와 변경 직렬화
        if ($dataset === null) // 대상 삭제 또는 타 작업실
        { // 대상 거부
            throw new ApiException(404, 'DATASET_NOT_FOUND', '데이터셋이 없습니다. 목록을 새로고침하세요.'); // 자료 범위 보호
        } // 대상 거부 끝
        return $dataset; // 고정된 버전
    } // 대상 읽기 끝
    private static function plan(ImportSource $source, array $config, ?array $dataset, int $projectId): array // 전체 행과 중복 계획
    { // 계획 시작
        $existing = []; // 기존 키만 보관
        if ($dataset !== null) // 재가져오기 대상
        { // 기존 키 조회
            foreach (Database::all('SELECT row_id,key_hash,key_value FROM import_rows WHERE dataset_id=?', [(int) $dataset['dataset_id']]) as $row) // 제한된 저장 행
            { // 키 색인
                if ($row['key_hash'] !== null) // 식별 가능한 행
                { // 실제 키 보관
                    $existing[$row['key_hash']] = $row; // 값과 해시 함께 확인
                } // 실제 키 보관 끝
            } // 키 색인 끝
        } // 기존 키 조회 끝
        $report = ['received' => 0, 'valid_rows' => 0, 'error_rows' => 0, 'error_count' => 0, 'errors' => [], 'duplicate_count' => 0, 'inserted' => 0, 'updated' => 0, 'skipped' => 0, 'can_commit' => false]; // 전체 보고서
        $selected = []; $seen = []; $preview = []; // 행 번호와 첫20개만
        foreach ($source->rows() as $raw) // 모든 원본 행
        { // 실제 값 검증
            $row = ImportValues::row($raw, $config); $report['received']++; // 구조·값 오류
            if (count($preview) < 20) // 정규화 미리보기
            { // 제한된 행 표시
                $preview[] = ['source_row' => $row['source_row'], 'values' => $row['values'], 'errors' => $row['errors']]; // 실제 변환
            } // 제한된 행 표시 끝
            if ($row['errors']) // 저장하면 안 되는 행
            { // 전체 오류 집계
                $report['error_rows']++; $report['error_count'] += count($row['errors']); // 행과 오류 구분
                foreach ($row['errors'] as $error) // 제한된 오류 응답
                { // 오류 추가
                    if (count($report['errors']) < 100) // 응답 한도
                    { // 첫100건
                        $report['errors'][] = $error; // 원문 없는 위치
                    } // 첫100건 끝
                } // 오류 추가 끝
                continue; // 중복 처리로 오류 숨기기 금지
            } // 전체 오류 집계 끝
            $report['valid_rows']++; $hash = $row['key_hash']; // 정상 행
            $key = $hash ?? 'row:' . $row['source_row']; // 키 없으면 매 행 독립
            if ($hash !== null) // 실제 식별자
            { // 해시 충돌 검사
                if ((isset($existing[$hash]) && $existing[$hash]['key_value'] !== $row['key_value']) || (isset($seen[$hash]) && $seen[$hash] !== $row['key_value'])) // 손상된 키 또는 충돌
                { // 전체 저장 차단
                    throw new ApiException(409, 'IMPORT_KEY_CONFLICT', '키를 일치시킬 수 없습니다. 기존 데이터셋을 확인하세요.'); // 잘못된 갱신 방지
                } // 전체 저장 차단 끝
                $duplicate = isset($seen[$hash]) || isset($existing[$hash]); // 파일·기존 자료 중복
                $report['duplicate_count'] += $duplicate ? 1 : 0; // 실제 중복 행
                $seen[$hash] = $row['key_value']; // 원문 키 보관
                if ($config['duplicate_policy'] === 'skip' && $duplicate) // 첫 행·기존 행 유지
                { // 중복 생략
                    $report['skipped']++; continue; // 해당 행만 생략
                } // 중복 생략 끝
                if (isset($selected[$key])) // update의 앞 행 대체
                { // 앞 행 미적용
                    $report['skipped']++; // 마지막 행만 반영
                } // 앞 행 미적용 끝
            } // 해시 충돌 검사 끝
            $selected[$key] = $row['source_row']; // 값 배열 대신 위치만
        } // 실제 값 검증 끝
        foreach ($selected as $key => $number) // 최종 적용 고유 행
        { // 적용 분류
            $report[isset($existing[$key]) ? 'updated' : 'inserted']++; // 예상 건수
        } // 적용 분류 끝
        $quota = Database::one('SELECT COUNT(*) AS datasets,COALESCE(SUM(row_count),0) AS rows_total FROM import_datasets WHERE project_id=?', [$projectId]); // 잠긴 작업실 한도
        if (($dataset === null && (int) $quota['datasets'] >= 100) || (int) ($dataset['row_count'] ?? 0) + $report['inserted'] > 10000 || (int) $quota['rows_total'] + $report['inserted'] > 100000) // 확정 시 용량
        { // 한도 거부
            throw new ApiException(413, 'IMPORT_LIMIT', '데이터셋 10,000행·작업실 100개 데이터셋/100,000행 한도를 확인하세요.'); // 자동 삭제 금지
        } // 한도 거부 끝
        $report['can_commit'] = $report['error_count'] === 0 && $report['received'] > 0; // 전체 통과만 저장
        return ['report' => $report, 'selected' => $selected, 'existing' => $existing, 'rows' => $preview]; // 내부 계획
    } // 계획 끝
    public static function validate(Request $request, int $projectId, array $input): array // 전체 원본 검증
    { // 검증 시작
        return ImportAccess::write($request, $projectId, 'editor', static function (array $guest) use ($projectId, $input): array // 변경 소유
        { // 검증 본문
            $draft = ImportDrafts::loadLocked($input['draft_token'] ?? '', $projectId, (int) $guest['session_id']); // 잠긴 원본
            if ($draft['status'] === 'consumed') // 이미 확정
            { // 재검증 거부
                throw new ApiException(409, 'IMPORT_CONSUMED', '이미 저장된 초안입니다. 새 파일을 선택하세요.'); // 중복 변경 차단
            } // 재검증 거부 끝
            unset($input['draft_token']); $dataset = null; // 설정만 분리
            if (($input['mode'] ?? 'create') === 'merge') // 기존 대상
            { // 버전 검사
                $dataset = self::dataset($projectId, self::positive($input['target_dataset_id'] ?? null, '대상 ID')); // 대상 범위
                if (self::positive($input['expected_version'] ?? null, '대상 버전') !== (int) $dataset['version']) // 이미 변경됨
                { // 재조회 안내
                    throw new ApiException(409, 'IMPORT_CONFLICT', '데이터셋이 변경되었습니다. 다시 선택하고 검증하세요.'); // 덮어쓰기 방지
                } // 재조회 안내 끝
            } // 버전 검사 끝
            elseif (isset($input['target_dataset_id']) || isset($input['expected_version'])) // 신규에 대상 위조
            { // 설정 거부
                ImportValues::bad('신규 저장에는 기존 대상 ID를 지정할 수 없습니다.'); // 명확한 모드
            } // 설정 거부 끝
            $source = self::source($draft); $config = ImportValues::config($input, $source->columns(), $dataset); // 서버 정규 설정
            $plan = self::plan($source, $config, $dataset, $projectId); $report = $plan['report']; // 모든 행 검사
            $revision = (int) $draft['validation_revision'] + 1; // 이전 검증 무효화
            $configJson = json_encode($config, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR); $reportJson = json_encode($report, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR); // 제한된 JSON
            Database::run('UPDATE import_drafts SET config_json=?,report_json=?,target_version=?,validation_revision=? WHERE draft_hash=?', [$configJson, $reportJson, $config['target_version'], $revision, $draft['draft_hash']]); // 서버 검증 저장
            Database::run('INSERT INTO import_runs (project_id,dataset_id,actor_id,draft_hash,validation_revision,file_name,source_sha256,status,received,inserted,updated,skipped,error_count,report_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [$projectId, $config['target_dataset_id'], (int) $guest['guest_id'], $draft['draft_hash'], $revision, $draft['original_name'], $draft['source_sha256'], $report['can_commit'] ? 'validated' : 'invalid', $report['received'], $report['inserted'], $report['updated'], $report['skipped'], $report['error_count'], $reportJson]); // 저장 전 상태와 구분
            return ['validation_revision' => $revision, 'target_dataset_id' => $config['target_dataset_id'], 'target_version' => $config['target_version'], 'schema' => self::schema($config), 'report' => $report, 'rows' => $plan['rows']]; // 검증 결과
        }); // 검증 본문 끝
    } // 검증 끝
    private static function schema(array $config): array // 원본 매핑 없는 저장 스키마
    { // 스키마 시작
        return array_map(static function (array $column): array // 공개 필드
        { // 필드 정리
            unset($column['source_id']); return $column; // 원본 열 변경과 독립
        }, $config['columns']); // 같은 순서
    } // 스키마 끝
    public static function commit(Request $request, int $projectId, array $input): array // 전체 원자적 저장
    { // 저장 시작
        try // 실패 이력과 원래 오류 구분
        { // 적용 실행
            return ImportAccess::write($request, $projectId, 'editor', static function (array $guest, PDO $pdo) use ($projectId, $input): array // 작업실·세션 잠금
            { // 저장 본문
                ImportValues::keys($input, ['draft_token', 'validation_revision']); // 행 본문 위조 차단
                $revision = self::positive($input['validation_revision'] ?? null, '검증 버전'); // 실제 세대
                $draft = ImportDrafts::loadLocked($input['draft_token'] ?? '', $projectId, (int) $guest['session_id']); // 원본과 소유
                if ($revision !== (int) $draft['validation_revision']) // 오래된 검증
                { // 재검증 안내
                    throw new ApiException(409, 'IMPORT_CONFLICT', '가져오기 조건이 변경되었습니다. 다시 검증하세요.'); // 과거 설정 차단
                } // 재검증 안내 끝
                if ($draft['status'] === 'consumed') // 확정 요청 재시도
                { // 같은 결과 반환
                    return json_decode($draft['result_json'], true, 32, JSON_THROW_ON_ERROR); // 두 번째 쓰기 없음
                } // 같은 결과 반환 끝
                if ($draft['config_json'] === null || $draft['report_json'] === null) // 미검증 초안
                { // 저장 차단
                    throw new ApiException(409, 'IMPORT_CONFLICT', '파일과 컬럼을 먼저 검증하세요.'); // 단계 안내
                } // 저장 차단 끝
                $config = json_decode($draft['config_json'], true, 32, JSON_THROW_ON_ERROR); $storedReport = json_decode($draft['report_json'], true, 32, JSON_THROW_ON_ERROR); // 서버 보관 설정
                if (!$storedReport['can_commit']) // 전체 오류가 남음
                { // 부분 저장 금지
                    throw new ApiException(422, 'IMPORT_INVALID', '오류가 있는 파일은 저장할 수 없습니다. 수정한 뒤 다시 검증하세요.'); // 오류 안내
                } // 부분 저장 금지 끝
                $dataset = $config['target_dataset_id'] === null ? null : self::dataset($projectId, $config['target_dataset_id']); // 잠긴 대상
                if ($dataset !== null && (int) $dataset['version'] !== $config['target_version']) // 다른 편집자의 저장
                { // 충돌 차단
                    throw new ApiException(409, 'IMPORT_CONFLICT', '데이터셋이 변경되었습니다. 다시 검증하세요.'); // 이전 데이터 보존
                } // 충돌 차단 끝
                $source = self::source($draft); $plan = self::plan($source, $config, $dataset, $projectId); $report = $plan['report']; // 원본 재검증
                if (!$report['can_commit']) // 실제 원본 오류
                { // 저장 차단
                    throw new ApiException(422, 'IMPORT_INVALID', '원본 검증을 통과하지 못했습니다.'); // 부분 반영 금지
                } // 저장 차단 끝
                if ($dataset === null) // 새로운 자료
                { // 메타데이터 생성
                    Database::run('INSERT INTO import_datasets (project_id,name,schema_json,key_column,created_by) VALUES (?,?,?,?,?)', [$projectId, $config['name'], json_encode(self::schema($config), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $config['key_column'], (int) $guest['guest_id']]); // 초기 버전1
                    $datasetId = Database::lastId(); $version = 1; // 확정 ID
                } // 메타데이터 생성 끝
                else // 기존 자료
                { // 버전 증가 준비
                    $datasetId = (int) $dataset['dataset_id']; $version = (int) $dataset['version'] + 1; // 성공 시 한 번 증가
                } // 버전 증가 준비 끝
                $insert = $pdo->prepare('INSERT INTO import_rows (dataset_id,source_row,key_hash,key_value,values_json) VALUES (?,?,?,?,?)'); // 반복 삽입
                $update = $pdo->prepare('UPDATE import_rows SET source_row=?,values_json=?,updated_at=NOW() WHERE dataset_id=? AND row_id=?'); // 기존 row_id 보존
                $packet = (int) Database::one('SELECT @@max_allowed_packet AS n')['n']; // 실제 패킷 제한
                foreach ($source->rows() as $raw) // 행 단위 실제 저장
                { // 선택 행만 적용
                    $row = ImportValues::row($raw, $config); $key = $row['key_hash'] ?? 'row:' . $row['source_row']; // 정규 식별
                    if (($plan['selected'][$key] ?? null) !== $row['source_row']) // 중복 생략 또는 앞 행
                    { // 적용 생략
                        continue; // 고유 최종 행만
                    } // 적용 생략 끝
                    $json = json_encode($row['values'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR); // 정확한 값 배열
                    if (strlen($json) + strlen($row['key_value'] ?? '') + 4096 >= $packet) // 단일 행 전송 한도
                    { // 전체 롤백
                        throw new ApiException(413, 'IMPORT_LIMIT', '한 행의 크기가 DB 전송 한도를 넘습니다. 필드나 값을 줄이세요.'); // 설정 자동 변경 금지
                    } // 전체 롤백 끝
                    if (isset($plan['existing'][$key])) // 갱신 정책의 기존 행
                    { // 값 교체
                        $update->execute([$row['source_row'], $json, $datasetId, (int) $plan['existing'][$key]['row_id']]); // 원본 키 유지
                    } // 값 교체 끝
                    else // 새 고유 키 또는 키 없음
                    { // 신규 행
                        $insert->execute([$datasetId, $row['source_row'], $row['key_hash'], $row['key_value'], $json]); // 같은 트랜잭션
                    } // 신규 행 끝
                } // 선택 행 적용 끝
                $total = (int) Database::one('SELECT COUNT(*) AS n FROM import_rows WHERE dataset_id=?', [$datasetId])['n']; // 실제 확정 건수
                Database::run('UPDATE import_datasets SET row_count=?,version=?,updated_at=NOW() WHERE dataset_id=?', [$total, $version, $datasetId]); // 메타데이터 일치
                Database::run("UPDATE import_runs SET dataset_id=?,status='success',received=?,inserted=?,updated=?,skipped=?,error_count=0,finished_at=NOW() WHERE draft_hash=? AND validation_revision=?", [$datasetId, $report['received'], $report['inserted'], $report['updated'], $report['skipped'], $draft['draft_hash'], $revision]); // 실제 성공 이력
                $run = Database::one('SELECT run_id FROM import_runs WHERE draft_hash=? AND validation_revision=?', [$draft['draft_hash'], $revision]); // 성공 식별자
                $result = ['dataset_id' => $datasetId, 'version' => $version, 'row_count' => $total, 'inserted' => $report['inserted'], 'updated' => $report['updated'], 'skipped' => $report['skipped'], 'run_id' => (int) $run['run_id']]; // 확정 결과
                Database::run("UPDATE import_drafts SET status='consumed',result_json=?,expires_at=DATE_ADD(NOW(),INTERVAL 24 HOUR) WHERE draft_hash=?", [json_encode($result, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $draft['draft_hash']]); // 멱등 결과 보관
                Database::run('DELETE FROM import_draft_chunks WHERE draft_hash=?', [$draft['draft_hash']]); // 원본 즉시 제거
                return $result; // 외부 write가 최종 commit
            }); // 저장 본문 끝
        } // 적용 실행 끝
        catch (Throwable $error) // 롤백된 실패
        { // 실패 기록 시도
            if ($error instanceof PDOException || ($error instanceof ApiException && in_array($error->getCode(), [409, 422], true))) // 기록 가능한 처리 실패
            { // 별도 안전 트랜잭션
                try // 원래 오류 보존
                { // 현재 소유만 기록
                    ImportAccess::write($request, $projectId, 'editor', static function (array $guest) use ($projectId, $input): void // 권한 재확인
                    { // 실패 이력
                        $draft = ImportDrafts::loadLocked($input['draft_token'] ?? '', $projectId, (int) $guest['session_id']); // 실제 소유
                        if ($draft['status'] !== 'consumed') // 다른 성공 결과 보호
                        { // 검증 완료 이력만
                            Database::run("UPDATE import_runs SET status='failed',finished_at=NOW() WHERE draft_hash=? AND validation_revision=? AND status='validated'", [$draft['draft_hash'], $input['validation_revision'] ?? 0]); // 원문 오류 저장 없음
                        } // 검증 완료 이력 끝
                    }); // 실패 이력 끝
                } // 기록 시도 끝
                catch (Throwable $recordError) // DB 장애 또는 접근 상실
                { // 성공 주장 금지
                    error_log('가져오기 실패 이력 저장 불가'); // 비밀 없는 운영 기록
                } // 기록 실패 끝
            } // 별도 트랜잭션 끝
            throw $error; // 최초 실패 전달
        } // 실패 기록 끝
    } // 저장 끝
} // 서비스 끝
