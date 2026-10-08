<?php
// 개발용 CLI: 프로젝트와 기본 보드를 만들고 최초 관리자 초대 코드를 한 번 출력
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
$admin = Invite::issue($projectId, 'admin', 7); // 최초 관리자용 초대 코드(7일 유효)
echo "프로젝트 생성 완료: project_id={$projectId} ({$title})\n"; // 프로젝트 결과 출력
echo "관리자 초대 코드: {$admin['code']}\n"; // 최초 관리자 지정 수단(이후 다시 조회 불가)
echo "이 코드로 입장한 사람이 관리자가 되어 화면에서 편집자·열람자 초대 코드를 발급할 수 있습니다.\n"; // 안내
echo "명령줄로 추가 발급: php bin/create-invite.php {$projectId} editor\n"; // CLI 안내
