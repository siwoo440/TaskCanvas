<?php
// 시연용 초기화 CLI: DB 의 모든 TaskCanvas 데이터와 업로드 이미지를 지우고 시연 프로젝트·초대 코드를 새로 만든다
// 사용법: php bin/reset-demo.php [--dry-run] [--yes] [--seed] ["프로젝트 이름"]
//   --dry-run  지울 대상만 보여 주고 아무것도 바꾸지 않음
//   --yes      확인 질문을 건너뜀(스크립트 자동화용). 기본은 DB 이름을 직접 입력해야 진행
//   --seed     새로 만든 보드에 시연용 예시 내용(메모·연결선·공유 업무)을 채움
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php'; // 공통 초기화

if (PHP_SAPI !== 'cli')
{
    exit("CLI 전용 스크립트입니다.\n"); // 웹 실행 차단
}

$args = array_slice($argv, 1); // 실행 인자
$dryRun = in_array('--dry-run', $args, true); // 미리보기 모드
$assumeYes = in_array('--yes', $args, true); // 확인 생략
$seed = in_array('--seed', $args, true); // 예시 내용 채우기
$names = array_values(array_filter($args, static fn(string $a) => !str_starts_with($a, '--'))); // 옵션이 아닌 인자
$projectTitle = $names[0] ?? '시연 프로젝트'; // 새로 만들 프로젝트 이름

const RESET_TABLES = [
    'board_links', 'board_objects', 'media_assets', 'tasks', 'realtime_tickets', 'join_attempts',
    'guest_sessions', 'project_invites', 'project_members', 'boards', 'projects', 'guests',
]; // 비울 테이블(이 목록 밖의 테이블은 건드리지 않음)

$dbName = Env::get('DB_NAME'); // 대상 DB 이름
$existing = array_map(static fn(array $r) => (string) array_values($r)[0], Database::all('SHOW TABLES')); // 실제 테이블 목록
$missing = array_diff(RESET_TABLES, $existing); // 없는 테이블
if ($missing !== [])
{
    exit("DB '{$dbName}' 에 테이블이 없습니다: " . implode(', ', $missing) . "\n먼저 database/schema.sql 을 적용하세요.\n"); // 스키마 미적용
}

$files = Storage::listUploadedFiles(); // 지울 업로드 파일(서버가 만든 이름 규칙에 맞는 것만)

echo "=== TaskCanvas 시연 초기화 ===\n"; // 제목
echo "대상 DB     : " . Env::get('DB_HOST') . ':' . Env::get('DB_PORT') . " / {$dbName}\n"; // DB 정보
echo "업로드 폴더 : " . Storage::uploadDir() . "\n"; // 업로드 폴더
echo "지워질 데이터:\n"; // 요약 머리
$total = 0; // 전체 행 수
foreach (RESET_TABLES as $table)
{
    $count = (int) Database::one("SELECT COUNT(*) AS n FROM `{$table}`")['n']; // 테이블 행 수
    $total += $count; // 합계
    echo sprintf("  %-18s %d 행\n", $table, $count); // 테이블별 출력
}
echo "  업로드 이미지      " . count($files) . " 개\n"; // 파일 수
echo "초기화 후 '{$projectTitle}' 프로젝트(보드 2개)와 관리자·편집자·열람자 초대 코드를 새로 만듭니다." . ($seed ? ' 보드에는 예시 내용을 채웁니다.' : '') . "\n"; // 이후 작업

if ($dryRun)
{
    exit("--dry-run: 아무것도 바꾸지 않았습니다.\n"); // 미리보기 종료
}

if (!$assumeYes)
{
    echo "\n이 작업은 되돌릴 수 없습니다. 계속하려면 DB 이름({$dbName})을 그대로 입력하세요: "; // 확인 질문
    $answer = trim((string) fgets(STDIN)); // 입력 읽기
    if ($answer !== $dbName)
    {
        exit("입력이 일치하지 않아 취소했습니다. 아무것도 바꾸지 않았습니다.\n"); // 취소
    }
}

$pdo = Database::pdo(); // PDO 연결
$pdo->exec('SET FOREIGN_KEY_CHECKS = 0'); // 외래키 검사 잠시 해제(TRUNCATE 용)
try
{
    foreach (RESET_TABLES as $table)
    {
        $pdo->exec("TRUNCATE TABLE `{$table}`"); // 테이블 비우기(AUTO_INCREMENT 초기화)
    }
}
finally
{
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 1'); // 외래키 검사 복원
}
echo "DB 테이블 " . count(RESET_TABLES) . "개를 비웠습니다 ({$total} 행).\n"; // DB 결과

$deleted = 0; // 삭제한 파일 수
$dirs = []; // 비워진 프로젝트 폴더 후보
foreach ($files as $path)
{
    if (unlink($path))
    {
        $deleted++; // 삭제 성공
        $dirs[dirname($path)] = true; // 폴더 기록
    }
}
foreach (array_keys($dirs) as $dir)
{
    if (count(scandir($dir) ?: []) === 2)
    {
        rmdir($dir); // 빈 프로젝트 폴더 제거(다른 파일이 남아 있으면 그대로 둠)
    }
}
echo "업로드 이미지 {$deleted}개를 지웠습니다.\n"; // 파일 결과

Database::run('INSERT INTO projects (title) VALUES (?)', [$projectTitle]); // 시연 프로젝트 생성
$projectId = Database::lastId(); // 프로젝트 ID
foreach (['기획 보드', '개발 보드'] as $boardTitle)
{
    Database::run('INSERT INTO boards (project_id, title) VALUES (?, ?)', [$projectId, $boardTitle]); // 기본 보드 생성
}
echo "\n새 프로젝트: project_id={$projectId} ({$projectTitle}), 보드: 기획 보드·개발 보드\n"; // 생성 결과
if ($seed)
{
    $filled = DemoSeed::fill($projectId); // 시연용 예시 내용
    echo "예시 내용: 기획 보드에 객체 {$filled['objects']}개·연결선 {$filled['links']}개·공유 업무 {$filled['tasks']}개를 채웠습니다.\n"; // 채운 결과
}
foreach (['admin' => '관리자', 'editor' => '편집자', 'viewer' => '열람자'] as $role => $label)
{
    $issued = Invite::issue($projectId, $role, 7); // 역할별 초대 코드(7일)
    echo sprintf("%s 초대 코드: %s\n", $label, $issued['code']); // 코드 원문(이후 다시 조회 불가)
}
echo "초대 링크 형식: http://<서버 IP>:8080/#code=<초대 코드>\n"; // 링크 안내
echo "주의: 위 코드는 지금만 표시됩니다. Git·문서에 기록하지 마세요.\n"; // 보안 안내
