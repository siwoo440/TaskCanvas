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
