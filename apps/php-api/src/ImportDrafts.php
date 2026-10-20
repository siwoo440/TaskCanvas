<?php // 세션 소유 원본 조각과 만료 초안
declare(strict_types=1); // 엄격한 자료형
final class ImportDrafts // 초안 저장 서비스
{ // 서비스 시작
    public static function upload(Request $request, int $projectId): array // 원본 업로드
    { // 업로드 시작
        return ImportAccess::write($request, $projectId, 'editor', static function (array $guest) use ($request, $projectId): array // 소유와 한도 직렬화
        { // 업로드 본문
            if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 6291456) // PHP 자체 POST 초과
            { // 크기 거부
                throw new ApiException(413, 'FILE_TOO_LARGE', '파일은 최대 5MiB까지 지원합니다.'); // 빈 파일 배열 전 안내
            } // 크기 거부 끝
            $file = $request->file('file'); // 정상 업로드 메타데이터
            if (in_array($file['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || ($file['size'] ?? 0) > 5242880) // 자체 크기 한도
            { // 크기 거부
                throw new ApiException(413, 'FILE_TOO_LARGE', '파일은 최대 5MiB까지 지원합니다.'); // 크기 안내
            } // 크기 거부 끝
            if ($file['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) // 전송 진위
            { // 업로드 거부
                throw new ApiException(415, 'INVALID_FILE', '파일을 다시 선택해 업로드하세요.'); // 업로드 오류
            } // 업로드 거부 끝
            $name = basename(str_replace('\\', '/', (string) $file['name'])); // 파일 이름만 보존
            if (!mb_check_encoding($name, 'UTF-8') || mb_strlen($name) > 255 || preg_match('/[\x00-\x1f]/', $name)) // 이름 자료형
            { // 이름 거부
                throw new ApiException(415, 'INVALID_FILE', '파일 이름을 확인하세요.'); // 안전한 표시
            } // 이름 거부 끝
            $format = strtolower(pathinfo($name, PATHINFO_EXTENSION)); $encoding = $request->field('encoding') ?: 'UTF-8'; // 명시적 형식
            $bytes = file_get_contents($file['tmp_name']); // PHP 임시 파일
            $source = ImportSource::open($bytes, $format, $encoding, null); // 전체 구조 검사
            self::purge(100, $projectId); // 이 작업실의 만료 자료만
            $projectCount = (int) Database::one("SELECT COUNT(*) AS n FROM import_drafts WHERE project_id=? AND status='uploaded' AND expires_at>NOW()", [$projectId])['n']; // 잠긴 작업실 전체 한도
            $sessionCount = (int) Database::one("SELECT COUNT(*) AS n FROM import_drafts WHERE guest_session_id=? AND status='uploaded' AND expires_at>NOW()", [(int) $guest['session_id']])['n']; // 잠긴 세션의 모든 작업실 합계
            if ($projectCount >= 10 || $sessionCount >= 3) // 미소비 초안 제한
            { // 한도 거부
                throw new ApiException(429, 'IMPORT_LIMIT', '진행 중인 초안이 많습니다. 초안 만료 후 파일 업로드를 다시 시도하세요.'); // 현재 가능한 복구 안내
            } // 한도 거부 끝
            $token = bin2hex(random_bytes(24)); $hash = hash('sha256', $token); // 세션 소유 난수
            Database::run('INSERT INTO import_drafts (draft_hash,project_id,guest_session_id,original_name,format,encoding,size_bytes,source_sha256,expires_at) VALUES (?,?,?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 15 MINUTE))', [$hash, $projectId, (int) $guest['session_id'], $name, $format, $encoding, strlen($bytes), hash('sha256', $bytes)]); // 메타데이터
            $statement = Database::pdo()->prepare('INSERT INTO import_draft_chunks (draft_hash,chunk_no,data) VALUES (?,?,?)'); // 작은 패킷 쓰기
            for ($offset = 0, $chunk = 0; $offset < strlen($bytes); $offset += 65536, $chunk++) // 최대80조각
            { // 조각 저장
                $statement->bindValue(1, $hash); $statement->bindValue(2, $chunk, PDO::PARAM_INT); // 조각 ID
                $statement->bindValue(3, substr($bytes, $offset, 65536), PDO::PARAM_LOB); $statement->execute(); // 원본 바이트 유지
            } // 조각 저장 끝
            $draft = Database::one('SELECT * FROM import_drafts WHERE draft_hash=?', [$hash]); // 확정 메타데이터
            return ['draft_token' => $token] + self::metadata($draft, $source); // 공개 응답만
        }); // 업로드 본문 끝
    } // 업로드 끝
    public static function preview(Request $request, int $projectId, array $input): array // 원본 경로 변경
    { // 미리보기 시작
        return ImportAccess::write($request, $projectId, 'editor', static function (array $guest) use ($projectId, $input): array // 소유 초안 변경
        { // 미리보기 본문
            ImportValues::keys($input, ['draft_token', 'encoding', 'json_path']); // 입력 계약
            $draft = self::loadLocked($input['draft_token'] ?? '', $projectId, (int) $guest['session_id']); // 세션과 무결성
            if ($draft['status'] === 'consumed') // 확정된 초안
            { // 재설정 거부
                throw new ApiException(409, 'IMPORT_CONSUMED', '이미 저장된 초안입니다. 새 파일을 선택하세요.'); // 중복 변경 방지
            } // 재설정 거부 끝
            $encoding = $input['encoding'] ?? $draft['encoding']; $path = array_key_exists('json_path', $input) ? $input['json_path'] : $draft['json_path']; // 적용 경로
            if (!is_string($encoding) || ($path !== null && !is_string($path))) // 형식 검사
            { // 값 거부
                ImportValues::bad('인코딩과 JSON 경로는 문자열이어야 합니다.'); // 잘못된 배열 방지
            } // 값 거부 끝
            $source = ImportSource::open($draft['bytes'], $draft['format'], $encoding, $path); // 실제 원본 재해석
            if ($encoding !== $draft['encoding'] || $path !== $draft['json_path']) // 검증 조건 변경
            { // 기존 보고서 무효화
                Database::run('UPDATE import_drafts SET encoding=?,json_path=?,config_json=NULL,report_json=NULL,validation_revision=validation_revision+1 WHERE draft_hash=?', [$encoding, $path, $draft['draft_hash']]); // 저장 전 새 검증 필요
                $draft['validation_revision']++; // 실제 응답 세대
            } // 무효화 끝
            $draft['encoding'] = $encoding; $draft['json_path'] = $path; // 확정한 해석 상태
            return self::metadata($draft, $source); // 제한된 미리보기
        }); // 미리보기 본문 끝
    } // 미리보기 끝
    public static function loadLocked(mixed $token, int $projectId, int $sessionId): array // 트랜잭션 내부 초안
    { // 초안 읽기
        if (!is_string($token) || preg_match('/\A[0-9a-f]{48}\z/D', $token) !== 1) // 난수 형식
        { // 입력 거부
            ImportValues::bad('초안 토큰을 확인하세요.'); // 재선택 안내
        } // 입력 거부 끝
        $draft = Database::one('SELECT *,expires_at>NOW() AS valid FROM import_drafts WHERE draft_hash=? AND project_id=? AND guest_session_id=? FOR UPDATE', [hash('sha256', $token), $projectId, $sessionId]); // 타 세션 정보 숨김
        if ($draft === null) // 없는 자료 또는 다른 소유
        { // 접근 거부
            throw new ApiException(404, 'DRAFT_NOT_FOUND', '초안이 없거나 현재 세션의 초안이 아닙니다. 파일을 다시 선택하세요.'); // 범위 보호
        } // 접근 거부 끝
        if (!(int) $draft['valid']) // 만료 메타데이터
        { // 만료 거부
            throw new ApiException(410, 'DRAFT_EXPIRED', '초안이 만료되었습니다. 파일을 다시 선택하세요.'); // TTL 안내
        } // 만료 거부 끝
        if ($draft['status'] === 'consumed') // 멱등 결과
        { // 결과 전용
            return $draft; // 삭제된 원본 복원 금지
        } // 결과 전용 끝
        $chunks = Database::all('SELECT chunk_no,data FROM import_draft_chunks WHERE draft_hash=? ORDER BY chunk_no LIMIT 81', [$draft['draft_hash']]); // 최대 원본 조각
        $bytes = ''; // PHP에서만 복원
        foreach ($chunks as $i => $row) // 순서 확인
        { // 무결성 검사
            if ((int) $row['chunk_no'] !== $i || strlen($row['data']) > 65536 || $i >= 80) // 누락·자원 보호
            { // 손상 거부
                throw new ApiException(409, 'DRAFT_CORRUPT', '초안 원본이 손상되었습니다. 파일을 다시 선택하세요.'); // 부분 저장 금지
            } // 손상 거부 끝
            $bytes .= $row['data']; // 원래 바이트 순서
        } // 무결성 검사 끝
        if (strlen($bytes) !== (int) $draft['size_bytes'] || strlen($bytes) > 5242880 || !hash_equals($draft['source_sha256'], hash('sha256', $bytes))) // 크기와 해시
        { // 원본 거부
            throw new ApiException(409, 'DRAFT_CORRUPT', '초안 원본을 확인할 수 없습니다. 파일을 다시 선택하세요.'); // 명확한 복구
        } // 원본 거부 끝
        $draft['bytes'] = $bytes; return $draft; // 내부 서비스만 사용
    } // 초안 읽기 끝
    public static function metadata(array $draft, ImportSource $source): array // 공개 필드만 선택
    { // 응답 시작
        return ['file_name' => $draft['original_name'], 'format' => $draft['format'], 'encoding' => $draft['encoding'], 'json_path' => $draft['json_path'], 'expires_at' => $draft['expires_at'], 'requires_path' => $source->requiresPath(), 'paths' => $source->paths(), 'row_count' => $source->requiresPath() ? null : $source->count(), 'columns' => $source->columns(), 'rows' => $source->preview(), 'validation_revision' => (int) $draft['validation_revision']]; // 세션과 원문 전체 제외
    } // 응답 끝
    public static function purge(int $limit = 100, ?int $projectId = null): int // 제한된 만료 정리
    { // 정리 시작
        $limit = max(1, min(1000, $limit)); // 관리 호출 한도
        $sql = 'DELETE FROM import_drafts WHERE expires_at<=NOW()'; $params = []; // 만료만
        if ($projectId !== null) // 웹 요청의 범위
        { // 작업실 제한
            $sql .= ' AND project_id=?'; $params[] = $projectId; // 교차 잠금 방지
        } // 작업실 제한 끝
        return Database::run($sql . ' ORDER BY expires_at LIMIT ' . $limit, $params)->rowCount(); // 조각 FK 정리
    } // 정리 끝
} // 서비스 끝
