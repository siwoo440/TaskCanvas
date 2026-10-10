<?php
// 개발용 CLI: 초대 코드 발급 (원문은 이 화면에만 출력되고 DB에는 해시만 저장)
// 사용법: php bin/create-invite.php <project_id> [admin|editor|viewer] [유효일수] [인원 제한]
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php'; // 공통 초기화

if (PHP_SAPI !== 'cli')
{
    exit("CLI 전용 스크립트입니다.\n"); // 웹 실행 차단
}
$projectId = (int) ($argv[1] ?? 0); // 대상 프로젝트
$role = $argv[2] ?? 'editor'; // 부여 역할
$days = (int) ($argv[3] ?? 7); // 유효 일수(기본 7일)
$maxUses = isset($argv[4]) ? (int) $argv[4] : null; // 인원 제한(생략하면 제한 없음)
if ($projectId <= 0 || !in_array($role, Auth::ROLES, true) || $days < 1 || $days > Invite::MAX_DAYS || ($maxUses !== null && ($maxUses < 1 || $maxUses > Invite::MAX_USES)))
{
    exit("사용법: php bin/create-invite.php <project_id> [admin|editor|viewer] [유효일수 1~" . Invite::MAX_DAYS . "] [인원 제한 1~" . Invite::MAX_USES . "]\n"); // 사용법 안내
}
if (Database::one('SELECT project_id FROM projects WHERE project_id = ?', [$projectId]) === null)
{
    exit("project_id={$projectId} 프로젝트가 없습니다.\n"); // 프로젝트 확인
}

$issued = Invite::issue($projectId, $role, $days, $maxUses); // 초대 발급(해시만 저장)
echo "초대 코드 발급 완료 (project_id={$projectId}, role={$role}, {$days}일 유효, " . ($maxUses === null ? '인원 제한 없음' : "{$maxUses}명까지") . ")\n"; // 발급 결과
echo "초대 코드: {$issued['code']}\n"; // 코드 원문(이후 다시 조회 불가)
echo "주의: 이 코드는 팀원에게 직접 전달하고 Git·문서에 기록하지 않습니다.\n"; // 보안 안내
