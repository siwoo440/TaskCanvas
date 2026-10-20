<?php // 만료된 초안 조각의 명시적 정리
declare(strict_types=1); // 엄격한 자료형
require dirname(__DIR__) . '/src/bootstrap.php'; // 기존 환경
if (PHP_SAPI !== 'cli') // 관리 명령만
{ // 웹 차단
    exit('CLI 전용 명령입니다.'); // 외부 실행 금지
} // 웹 차단 끝
if (array_diff(array_slice($argv, 1), ['--apply'])) // 불명 옵션
{ // 옵션 오류
    fwrite(STDERR, "사용법: php bin/cleanup-imports.php [--apply]\n"); exit(1); // 명확한 명령
} // 옵션 오류 끝
try // 운영 오류의 종료 상태
{ // 정리 실행
    $count = (int) Database::one('SELECT COUNT(*) AS n FROM import_drafts WHERE expires_at<=NOW()')['n']; // 만료 개수
    if (!in_array('--apply', $argv, true)) // 기본 미리보기
    { // 읽기 전용
        echo '만료 초안 ' . $count . "개, 변경 없음. --apply로 최대 100개 정리\n"; exit(0); // 원본 삭제 없음
    } // 읽기 전용 끝
    echo '만료 초안 ' . ImportDrafts::purge(100) . "개 정리\n"; // 제한된 FK 정리
} // 정리 실행 끝
catch (Throwable $error) // 접속 또는 SQL 실패
{ // 실패 전달
    fwrite(STDERR, "초안 정리 실패: DB 연결과 스키마를 확인하세요.\n"); exit(1); // 비밀정보 없는 실패 종료
} // 실패 전달 끝
