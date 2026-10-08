<?php
// 이미지 업로드·조회 (서버 전용 저장 폴더 + media_assets 메타데이터)
declare(strict_types=1);

final class ImageController
{
    private const ALLOWED = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp']; // 허용 MIME → 저장 확장자

    public function upload(Request $request): void
    {
        Auth::requireMutationHeader($request); // CSRF 헤더 검사
        $guest = Auth::requireGuest($request); // 현재 게스트
        $projectId = (int) $request->field('project_id'); // 대상 프로젝트
        if ($projectId <= 0)
        {
            throw new ApiException(400, 'BAD_REQUEST', 'project_id 가 필요합니다.'); // 필수값 검사
        }
        Auth::requireRole((int) $guest['guest_id'], $projectId, 'editor'); // 편집자 이상 확인

        $file = $request->file('file'); // 업로드 파일 정보
        $maxBytes = Env::int('MAX_UPLOAD_BYTES', 10485760); // 파일당 최대 크기
        if ($file['error'] === UPLOAD_ERR_INI_SIZE || $file['error'] === UPLOAD_ERR_FORM_SIZE)
        {
            throw new ApiException(413, 'FILE_TOO_LARGE', '파일당 최대 10MB 까지 업로드할 수 있습니다.'); // PHP 설정 한도 초과
        }
        if ($file['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name']))
        {
            throw new ApiException(400, 'INVALID_FILE', '파일 업로드에 실패했습니다.'); // 전송 오류
        }
        if ($file['size'] <= 0 || $file['size'] > $maxBytes)
        {
            throw new ApiException(413, 'FILE_TOO_LARGE', '파일당 최대 10MB 까지 업로드할 수 있습니다.'); // 크기 검사
        }

        $finfo = new finfo(FILEINFO_MIME_TYPE); // 내용 기반 MIME 판별기
        $mime = $finfo->file($file['tmp_name']) ?: ''; // 실제 MIME (브라우저 값은 신뢰하지 않음)
        $info = @getimagesize($file['tmp_name']); // 이미지 헤더 해석
        if (!isset(self::ALLOWED[$mime]) || $info === false || ($info['mime'] ?? '') !== $mime)
        {
            throw new ApiException(415, 'INVALID_FILE', 'PNG, JPG, WEBP 이미지만 업로드할 수 있습니다.'); // 형식 검사
        }

        $dir = self::uploadDir() . DIRECTORY_SEPARATOR . $projectId; // 프로젝트별 저장 폴더
        if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir))
        {
            throw new ApiException(500, 'SAVE_FAILED', '저장 폴더를 만들 수 없습니다.'); // 폴더 생성 실패
        }
        $storedName = bin2hex(random_bytes(16)) . '.' . self::ALLOWED[$mime]; // 랜덤 저장 파일명
        $storedPath = $projectId . '/' . $storedName; // DB 에 기록할 상대 경로
        if (!move_uploaded_file($file['tmp_name'], $dir . DIRECTORY_SEPARATOR . $storedName))
        {
            throw new ApiException(500, 'SAVE_FAILED', '파일을 저장하지 못했습니다.'); // 이동 실패
        }

        Database::run(
            'INSERT INTO media_assets (project_id, uploaded_by, original_name, stored_path, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?)',
            [$projectId, (int) $guest['guest_id'], mb_substr((string) $file['name'], 0, 255), $storedPath, $mime, (int) $file['size']]
        ); // 메타데이터 저장
        $assetId = Database::lastId(); // 이미지 ID
        Response::ok([
            'asset' => [
                'asset_id' => $assetId,
                'url' => '/api/images/' . $assetId,
                'mime_type' => $mime,
                'size_bytes' => (int) $file['size'],
                'width' => (int) $info[0],
                'height' => (int) $info[1],
            ],
        ], 201); // 업로드 결과(파일 경로는 노출하지 않음)
    }

    public function show(Request $request): void
    {
        $guest = Auth::requireGuest($request); // 현재 게스트
        $assetId = $request->params['id']; // 이미지 ID
        $asset = Database::one('SELECT project_id, stored_path, mime_type, size_bytes FROM media_assets WHERE asset_id = ?', [$assetId]); // 메타데이터 조회
        if ($asset === null)
        {
            throw new ApiException(404, 'NOT_FOUND', '이미지를 찾을 수 없습니다.'); // 없음
        }
        Auth::requireRole((int) $guest['guest_id'], (int) $asset['project_id'], 'viewer'); // 프로젝트 참여자 확인
        $path = self::uploadDir() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $asset['stored_path']); // 실제 파일 경로
        if (!is_file($path))
        {
            throw new ApiException(404, 'NOT_FOUND', '이미지 파일이 없습니다.'); // 파일 유실
        }
        $etag = '"' . $assetId . '-' . $asset['size_bytes'] . '"'; // 변경 감지용 태그
        if (($request->header('If-None-Match') ?? '') === $etag)
        {
            http_response_code(304); // 캐시 유효
            return;
        }
        http_response_code(200); // 정상 응답
        header('Content-Type: ' . $asset['mime_type']); // 서버가 확인한 MIME
        header('Content-Length: ' . $asset['size_bytes']); // 파일 크기
        header('Content-Disposition: inline'); // 브라우저 표시
        header('X-Content-Type-Options: nosniff'); // MIME 추측 금지
        header('Cache-Control: private, max-age=86400'); // 참여자 브라우저 캐시
        header('ETag: ' . $etag); // 변경 감지 태그
        readfile($path); // 파일 전송
    }

    private static function uploadDir(): string
    {
        $configured = Env::get('UPLOAD_DIR', 'storage/uploads'); // 설정 경로
        $isAbsolute = preg_match('#^([a-zA-Z]:[\\\\/]|/)#', $configured) === 1; // 절대 경로 여부
        return $isAbsolute ? $configured : dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $configured); // php-api 기준 상대 경로 변환
    }
}
