<?php
// 개발용 CLI: 프로젝트와 기본 보드 생성
// 사용법: php bin/create-project.php "프로젝트 이름" ["보드 이름" ...]
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php'; // 공통 초기화

if (PHP_SAPI !== 'cli')
{
    exit("CLI 전용 스크립트입니다.\n"); // 웹 실행 차단
}
$title = $argv[1] ?? ''; // 프로젝트 이름
if ($title === '')
{
    exit("사용법: php bin/create-project.php \"프로젝트 이름\" [\"보드 이름\" ...]\n"); // 사용법 안내
}
$boardTitles = array_slice($argv, 2) ?: ['기본 보드']; // 보드 이름 목록(없으면 기본 보드)

Database::run('INSERT INTO projects (title) VALUES (?)', [$title]); // 프로젝트 생성
$projectId = Database::lastId(); // 프로젝트 ID
foreach ($boardTitles as $boardTitle)
{
    Database::run('INSERT INTO boards (project_id, title) VALUES (?, ?)', [$projectId, $boardTitle]); // 보드 생성
    echo "보드 생성: board_id=" . Database::lastId() . " ({$boardTitle})\n"; // 보드 결과 출력
}
echo "프로젝트 생성 완료: project_id={$projectId} ({$title})\n"; // 프로젝트 결과 출력
echo "다음 단계: php bin/create-invite.php {$projectId} admin\n"; // 초대 코드 안내
