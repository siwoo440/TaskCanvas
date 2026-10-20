<?php // 저장 데이터 조회와 집계
declare(strict_types=1); // 엄격한 자료형
final class ImportDatasets // 작업실별 자료 관리
{ // 클래스 시작
    private static function query(array $query, array $allowed): void // 엄격한 조회 조건
    { // 검사 시작
        ImportValues::keys($query, $allowed); // 불명 키 차단
        foreach ($query as $value) // 스칼라 조건
        { // 값 검사
            if (!is_string($value) || $value === '') // 배열과 빈 값
            { // 입력 거부
                ImportValues::bad('조회 조건은 비어 있지 않은 문자열이어야 합니다.'); // 형식 안내
            } // 입력 거부 끝
        } // 값 검사 끝
    } // 검사 끝
    private static function pagination(array $query, int $total): array // 고정20건 페이지
    { // 페이지 검사
        $raw = $query['page'] ?? '1'; // 기본 페이지
        $page = filter_var($raw, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]); // 정수 검증
        if ($page === false || (string) $page !== $raw) // 비정규 정수
        { // 페이지 거부
            ImportValues::bad('페이지는 양의 정수여야 합니다.'); // 입력 안내
        } // 페이지 거부 끝
        $pages = max(1, (int) ceil($total / 20)); // 빈 결과 포함
        return ['page' => min($page, $pages), 'page_size' => 20, 'total' => $total, 'total_pages' => $pages]; // 범위 보정
    } // 페이지 끝
    private static function publicDataset(array $row): array // 공개 자료 정보
    { // 변환 시작
        foreach (['dataset_id', 'project_id', 'version', 'row_count'] as $key) // 정수 필드
        { // 정수 변환
            $row[$key] = (int) $row[$key]; // JSON 자료형
        } // 정수 변환 끝
        $row['schema'] = json_decode($row['schema_json'], true, 32, JSON_THROW_ON_ERROR); // 고정 컬럼
        unset($row['schema_json']); // 내부 저장 형식 제거
        return $row; // 공개 결과
    } // 변환 끝
    public static function detail(int $projectId, int $datasetId): array // 범위 내 상세
    { // 상세 시작
        $row = Database::one('SELECT dataset_id,project_id,name,schema_json,key_column,version,row_count,created_at,updated_at FROM import_datasets WHERE project_id=? AND dataset_id=?', [$projectId, $datasetId]); // 작업실 제한
        if ($row === null) // 삭제 또는 다른 자료
        { // 조회 거부
            throw new ApiException(404, 'DATASET_NOT_FOUND', '데이터셋이 없습니다. 목록을 새로고침하세요.'); // 범위 보호
        } // 조회 거부 끝
        return self::publicDataset($row); // 공개 상세
    } // 상세 끝
    private static function snapshot(callable $operation): array // 같은 읽기 시점
    { // 스냅샷 시작
        $pdo = Database::pdo(); // 동일 연결
        $pdo->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); // 일관된 읽기
        $pdo->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'); // 읽기 트랜잭션
        try // 조회 보호
        { // 조회 시작
            $result = $operation(); $pdo->commit(); // 조회 종료
            return $result; // 일관된 결과
        } // 조회 끝
        catch (Throwable $error) // 조회 실패
        { // 읽기 정리
            if ($pdo->inTransaction()) // 열린 연결
            { // 잠금 해제
                $pdo->rollBack(); // 읽기 취소
            } // 잠금 해제 끝
            throw $error; // 원래 오류
        } // 읽기 정리 끝
    } // 스냅샷 끝
    public static function list(int $projectId, array $query): array // 검색 목록
    { // 목록 시작
        self::query($query, ['page', 'q']); // 허용 조건
        $q = $query['q'] ?? ''; // 검색어
        if (mb_strlen($q) > 120) // 검색 길이
        { // 검색 거부
            ImportValues::bad('검색어는 120자 이하여야 합니다.'); // 길이 안내
        } // 검색 거부 끝
        return self::snapshot(static function () use ($projectId, $query, $q): array // 목록과 건수 일치
        { // 목록 읽기
            $where = "project_id=? AND name LIKE ? ESCAPE '!'"; // 리터럴 검색
            $params = [$projectId, '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $q) . '%']; // 와일드카드 이스케이프
            $total = (int) Database::one('SELECT COUNT(*) AS n FROM import_datasets WHERE ' . $where, $params)['n']; // 실제 건수
            $pagination = self::pagination($query, $total); $offset = ($pagination['page'] - 1) * 20; // 보정한 위치
            $rows = Database::all('SELECT dataset_id,project_id,name,schema_json,key_column,version,row_count,created_at,updated_at FROM import_datasets WHERE ' . $where . ' ORDER BY dataset_id DESC LIMIT 20 OFFSET ' . $offset, $params); // 제한 목록
            return ['datasets' => array_map([self::class, 'publicDataset'], $rows), 'pagination' => $pagination]; // 공개 목록
        }); // 목록 읽기 끝
    } // 목록 끝
    public static function rows(int $projectId, int $datasetId, array $query): array // 저장 표
    { // 행 조회 시작
        self::query($query, ['page']); // 페이지 전용
        return self::snapshot(static function () use ($projectId, $datasetId, $query): array // 버전과 행 일치
        { // 행 읽기
            $dataset = self::detail($projectId, $datasetId); // 같은 작업실
            $pagination = self::pagination($query, $dataset['row_count']); $offset = ($pagination['page'] - 1) * 20; // 페이지 위치
            $rows = Database::all('SELECT r.row_id,r.source_row,r.values_json FROM import_rows r JOIN import_datasets d ON d.dataset_id=r.dataset_id WHERE d.project_id=? AND r.dataset_id=? ORDER BY r.row_id LIMIT 20 OFFSET ' . $offset, [$projectId, $datasetId]); // 저장 순서
            foreach ($rows as &$row) // 공개 행 변환
            { // 변환 시작
                $row['row_id'] = (int) $row['row_id']; $row['source_row'] = (int) $row['source_row']; // 정수 위치
                $row['values'] = json_decode($row['values_json'], true, 32, JSON_THROW_ON_ERROR); unset($row['values_json']); // 정확한 문자열
            } // 변환 끝
            unset($row); // 참조 해제
            return ['dataset' => $dataset, 'rows' => $rows, 'pagination' => $pagination]; // 표 결과
        }); // 행 읽기 끝
    } // 행 조회 끝
    public static function runs(int $projectId, ?int $datasetId, array $query): array // 가져오기 이력
    { // 이력 시작
        self::query($query, ['page']); // 페이지 조건
        return self::snapshot(static function () use ($projectId, $datasetId, $query): array // 목록과 총계 일치
        { // 이력 읽기
            if ($datasetId !== null) // 대상 이력
            { // 대상 보호
                self::detail($projectId, $datasetId); // 자료 범위
            } // 대상 보호 끝
            $where = 'project_id=?' . ($datasetId === null ? '' : ' AND dataset_id=?'); $params = $datasetId === null ? [$projectId] : [$projectId, $datasetId]; // 범위 조건
            $total = (int) Database::one('SELECT COUNT(*) AS n FROM import_runs WHERE ' . $where, $params)['n']; // 이력 총계
            $pagination = self::pagination($query, $total); $offset = ($pagination['page'] - 1) * 20; // 페이지 위치
            $rows = Database::all('SELECT run_id,dataset_id,validation_revision,file_name,status,received,inserted,updated,skipped,error_count,created_at,finished_at FROM import_runs WHERE ' . $where . ' ORDER BY run_id DESC LIMIT 20 OFFSET ' . $offset, $params); // 토큰과 원문 비공개
            foreach ($rows as &$row) // 정수 응답
            { // 필드 변환
                foreach (['run_id', 'dataset_id', 'validation_revision', 'received', 'inserted', 'updated', 'skipped', 'error_count'] as $key) // 숫자 항목
                { // 정수화
                    $row[$key] = $row[$key] === null ? null : (int) $row[$key]; // 미확정 대상 보존
                } // 정수화 끝
            } // 필드 변환 끝
            unset($row); // 참조 해제
            return ['runs' => $rows, 'pagination' => $pagination]; // 이력 결과
        }); // 이력 읽기 끝
    } // 이력 끝
    private static function decimal(string $number): string // 집계 수치 정리
    { // 수치 시작
        $number = str_contains($number, '.') ? rtrim(rtrim($number, '0'), '.') : $number; // 불필요한 소수0 제거
        return $number === '-0' || $number === '' ? '0' : $number; // 영 정규화
    } // 수치 끝
    public static function chart(int $projectId, int $datasetId, array $query): array // SQL 정확 집계
    { // 차트 시작
        self::query($query, ['category', 'metric', 'value']); // 허용 필드
        return self::snapshot(static function () use ($projectId, $datasetId, $query): array // 집계 시점 고정
        { // 집계 읽기
            $dataset = self::detail($projectId, $datasetId); $fields = array_column($dataset['schema'], null, 'id'); // 허용 스키마
            $category = $query['category'] ?? ''; $metric = $query['metric'] ?? 'count'; $value = $query['value'] ?? ''; // 요청 선택
            if (!isset($fields[$category]) || !in_array($fields[$category]['type'], ['text', 'date'], true) || !in_array($metric, ['count', 'sum'], true) || ($metric === 'sum' && (!isset($fields[$value]) || $fields[$value]['type'] !== 'number')) || ($metric === 'count' && $value !== '')) // 신뢰 필드 전용
            { // 집계 거부
                ImportValues::bad('범주는 문자·날짜, 합계 값은 숫자 컬럼을 선택하세요.'); // 필드 안내
            } // 집계 거부 끝
            $ids = array_column($dataset['schema'], 'id'); $index = array_search($category, $ids, true); // 서버 정수 인덱스
            $cat = "JSON_EXTRACT(r.values_json,'$[" . $index . "]')"; // 검증한 JSON 경로
            $catValue = "CONVERT(CASE WHEN JSON_TYPE($cat)='NULL' THEN NULL ELSE JSON_UNQUOTE($cat) END USING utf8mb4)"; // JSON 반환 문자셋과 null 구분
            $valueIndex = array_search($value, $ids, true); // 선택 숫자 위치
            $num = $metric === 'sum' ? "CASE WHEN JSON_TYPE(JSON_EXTRACT(r.values_json,'$[" . $valueIndex . "]'))='NULL' THEN NULL ELSE CAST(JSON_UNQUOTE(JSON_EXTRACT(r.values_json,'$[" . $valueIndex . "]')) AS DECIMAL(30,6)) END" : '1'; // 정확한 DECIMAL
            $base = ' FROM import_rows r JOIN import_datasets d ON d.dataset_id=r.dataset_id WHERE d.project_id=? AND r.dataset_id=?'; $params = [$projectId, $datasetId]; // 작업실 범위
            $summary = Database::one('SELECT COALESCE(SUM(' . $num . '),0) AS total,COUNT(*)-COUNT(' . $num . ') AS excluded,COUNT(*) AS n' . $base, $params); // 전체 합과 빈 값
            $sql = 'WITH raw_rows AS (SELECT ' . $catValue . ' AS label,' . $num . ' AS number_value' . $base . '),grouped AS (SELECT MAX(label) AS label,COALESCE(SUM(number_value),0) AS amount,COUNT(*) AS n FROM raw_rows GROUP BY BINARY label),ranked AS (SELECT label,amount,n,ROW_NUMBER() OVER (ORDER BY amount DESC,label IS NOT NULL,BINARY label) AS rn FROM grouped) SELECT label,amount,n,CASE WHEN label IS NULL THEN \'null\' ELSE \'value\' END AS kind,rn FROM ranked WHERE rn<=19 UNION ALL SELECT NULL,SUM(amount),SUM(n),\'other\',20 FROM ranked WHERE rn>19 HAVING COUNT(*)>0 ORDER BY rn'; // 끝 공백까지 구분한 상위19와 기타
            $groups = Database::all($sql, $params); // 최대20개 그룹
            foreach ($groups as &$group) // 공개 수치
            { // 그룹 정리
                $group['amount'] = self::decimal((string) $group['amount']); $group['count'] = (int) $group['n']; // 문자열 합계
                $group['label'] = $group['kind'] === 'other' ? '기타(묶음)' : ($group['kind'] === 'null' ? '미지정' : $group['label']); // 종류는 별도 유지
                unset($group['n'], $group['rn']); // 내부 순위 제거
            } // 그룹 정리 끝
            unset($group); // 참조 해제
            return ['dataset_id' => $datasetId, 'version' => $dataset['version'], 'category' => $category, 'metric' => $metric, 'value' => $metric === 'sum' ? $value : null, 'total' => self::decimal((string) $summary['total']), 'excluded' => (int) $summary['excluded'], 'row_count' => (int) $summary['n'], 'groups' => $groups]; // 정확한 집계 결과
        }); // 집계 읽기 끝
    } // 차트 끝
    public static function delete(Request $request, int $projectId, int $datasetId, array $input): array // 관리자 삭제
    { // 삭제 시작
        ImportValues::keys($input, ['confirm_name', 'expected_version']); // 명시 계약
        return ImportAccess::write($request, $projectId, 'admin', static function () use ($projectId, $datasetId, $input): array // 삭제 직전 권한
        { // 잠긴 삭제
            $row = Database::one('SELECT name,version FROM import_datasets WHERE project_id=? AND dataset_id=? FOR UPDATE', [$projectId, $datasetId]); // 대상 잠금
            if ($row === null) // 사라진 자료
            { // 대상 거부
                throw new ApiException(404, 'DATASET_NOT_FOUND', '데이터셋이 없습니다.'); // 범위 보호
            } // 대상 거부 끝
            if (($input['confirm_name'] ?? null) !== $row['name']) // 이름 일치
            { // 삭제 거부
                ImportValues::bad('삭제할 데이터셋 이름을 정확히 입력하세요.'); // 확인 안내
            } // 삭제 거부 끝
            if (ImportService::positive($input['expected_version'] ?? null, '버전') !== (int) $row['version']) // 최신 자료 보호
            { // 충돌 거부
                throw new ApiException(409, 'IMPORT_CONFLICT', '자료가 변경됐습니다. 다시 조회하세요.'); // 새로고침 안내
            } // 충돌 거부 끝
            Database::run('DELETE FROM import_datasets WHERE project_id=? AND dataset_id=?', [$projectId, $datasetId]); // FK 연관 자료 정리
            return ['deleted' => true, 'dataset_id' => $datasetId]; // 삭제 결과
        }); // 잠긴 삭제 끝
    } // 삭제 끝
} // 클래스 끝
