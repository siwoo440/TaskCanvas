<?php
// 업로드 저장 폴더 경로 계산과 업로드 파일 이름 규칙
declare(strict_types=1);

final class Storage
{
    public const FILE_PATTERN = '/^[0-9a-f]{32}\.(png|jpg|webp)$/'; // 서버가 만든 저장 파일명 형식

    public static function uploadDir(): string
    {
        $configured = Env::get('UPLOAD_DIR', 'storage/uploads'); // 설정 경로
        $isAbsolute = preg_match('#^([a-zA-Z]:[\\\\/]|/)#', $configured) === 1; // 절대 경로 여부
        return $isAbsolute ? $configured : dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $configured); // php-api 기준 상대 경로 변환
    }

    // 작업실 하나가 올린 이미지 파일만 지우고 지운 개수를 돌려준다. DB 에 기록돼 있던 경로 가운데
    // "<그 작업실 번호>/<서버가 만든 이름>" 형식인 것만 대상이라, 다른 작업실의 폴더나 규칙 밖의 파일은 건드리지 않는다
    public static function removeProjectFiles(int $projectId, array $storedPaths): int
    {
        $root = realpath(self::uploadDir()); // 업로드 폴더의 실제 경로
        if ($root === false || !is_dir($root))
        {
            return 0; // 폴더 없음(올린 이미지가 없었음)
        }
        $dir = $root . DIRECTORY_SEPARATOR . $projectId; // 이 작업실의 폴더
        $removed = 0; // 지운 파일 수
        foreach ($storedPaths as $stored)
        {
            $parts = explode('/', str_replace('\\', '/', (string) $stored)); // "<작업실 번호>/<파일 이름>"
            if (count($parts) !== 2 || $parts[0] !== (string) $projectId || preg_match(self::FILE_PATTERN, $parts[1]) !== 1)
            {
                continue; // 이 작업실의 것이 아니거나 서버가 만든 이름이 아니면 건드리지 않음
            }
            $path = $dir . DIRECTORY_SEPARATOR . $parts[1]; // 지울 파일
            if (is_file($path) && !is_link($path) && unlink($path))
            {
                $removed++; // 삭제 성공
            }
        }
        if (is_dir($dir) && !is_link($dir) && count(scandir($dir) ?: []) === 2)
        {
            rmdir($dir); // 비었으면 폴더도 제거(다른 파일이 남아 있으면 그대로 둠)
        }
        return $removed; // 지운 파일 수
    }

    // 업로드 폴더 안에서 서버가 만든 파일만 나열: <uploadDir>/<숫자 프로젝트 ID>/<32자 16진수>.<확장자>
    public static function listUploadedFiles(): array
    {
        $root = realpath(self::uploadDir()); // 실제 경로
        if ($root === false || !is_dir($root))
        {
            return []; // 폴더 없음
        }
        $files = []; // 결과 목록
        foreach (scandir($root) ?: [] as $sub)
        {
            $subPath = $root . DIRECTORY_SEPARATOR . $sub; // 프로젝트 폴더 경로
            if (!ctype_digit($sub) || !is_dir($subPath) || is_link($subPath))
            {
                continue; // 숫자 이름의 실제 폴더만 대상
            }
            foreach (scandir($subPath) ?: [] as $name)
            {
                $path = $subPath . DIRECTORY_SEPARATOR . $name; // 파일 경로
                if (preg_match(self::FILE_PATTERN, $name) === 1 && is_file($path) && !is_link($path))
                {
                    $files[] = $path; // 규칙에 맞는 업로드 파일
                }
            }
        }
        return $files; // 업로드 파일 목록
    }
}
