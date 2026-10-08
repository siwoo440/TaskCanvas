<?php
// 개발용 CLI: 초대 코드 발급 (원문은 이 화면에만 출력되고 DB에는 해시만 저장)
// 사용법: php bin/create-invite.php <project_id> [admin|editor|viewer] [유효일수]
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php'; // 공통 초기화

if (PHP_SAPI !== 'cli')
{
    exit("CLI 전용 스크립트입니다.\n"); // 웹 실행 차단
}
$projectId = (int) ($argv[1] ?? 0); // 대상 프로젝트
$role = $argv[2] ?? 'editor'; // 부여 역할
$days = max(1, (int) ($argv[3] ?? 30)); // 유효 일수
if ($projectId <= 0 || !in_array($role, Auth::ROLES, true))
{
    exit("사용법: php bin/create-invite.php <project_id> [admin|editor|viewer] [유효일수]\n"); // 사용법 안내
}
if (Database::one('SELECT project_id FROM projects WHERE project_id = ?', [$projectId]) === null)
{
    exit("project_id={$projectId} 프로젝트가 없습니다.\n"); // 프로젝트 확인
}

$alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 혼동 문자를 뺀 코드 문자 집합
$code = ''; // 초대 코드 원문
for ($i = 0; $i < 12; $i++)
{
    $code .= $alphabet[random_int(0, strlen($alphabet) - 1)]; // 랜덤 문자 추가
    if ($i === 3 || $i === 7)
    {
        $code .= '-'; // 4자 단위 구분
    }
}
Database::run(
    'INSERT INTO project_invites (project_id, code_hash, role, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))',
    [$projectId, Auth::hash($code), $role, $days]
); // 초대 해시 저장
echo "초대 코드 발급 완료 (project_id={$projectId}, role={$role}, {$days}일 유효)\n"; // 발급 결과
echo "초대 코드: {$code}\n"; // 코드 원문(이후 다시 조회 불가)
echo "주의: 이 코드는 팀원에게 직접 전달하고 Git·문서에 기록하지 않습니다.\n"; // 보안 안내
