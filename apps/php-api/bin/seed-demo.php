<?php
// 시연용 CLI: 프로젝트의 첫 번째 보드에 예시 내용(메모·도형·연결선·공유 업무 블럭)을 채운다
// 사용법: php bin/seed-demo.php <project_id> [--force]
//   이미 객체가 있는 보드에는 넣지 않는다. --force 를 주면 기존 내용 위에 추가한다(기존 객체는 지우지 않음)
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php'; // 공통 초기화

if (PHP_SAPI !== 'cli')
{
    exit("CLI 전용 스크립트입니다.\n"); // 웹 실행 차단
}

// 안내를 출력하고 실패(종료 코드 1)로 끝낸다
function fail(string $message): void
{
    fwrite(STDERR, $message . "\n"); // 오류 출력
    exit(1); // 다른 스크립트가 실패를 알 수 있게 함
}

$args = array_slice($argv, 1); // 실행 인자
$force = in_array('--force', $args, true); // 기존 내용이 있어도 추가
$ids = array_values(array_filter($args, static fn(string $a) => !str_starts_with($a, '--'))); // 옵션이 아닌 인자
$projectId = (int) ($ids[0] ?? 0); // 대상 프로젝트
if ($projectId <= 0)
{
    fail('사용법: php bin/seed-demo.php <project_id> [--force]'); // 사용법 안내
}
if (Database::one('SELECT project_id FROM projects WHERE project_id = ?', [$projectId]) === null)
{
    fail("project_id={$projectId} 프로젝트가 없습니다."); // 프로젝트 확인
}

try
{
    $result = DemoSeed::fill($projectId, $force); // 예시 내용 채우기
}
catch (RuntimeException $e)
{
    fail($e->getMessage()); // 보드 없음·이미 내용 있음
}
echo "예시 내용을 채웠습니다: 보드 '{$result['board_title']}'(board_id={$result['board_id']}) 에 객체 {$result['objects']}개, 연결선 {$result['links']}개, 공유 업무 {$result['tasks']}개\n"; // 결과
if ($result['second_board_id'] !== null)
{
    echo "두 번째 보드(board_id={$result['second_board_id']})에도 같은 업무를 참조하는 블럭을 놓았습니다.\n"; // 공유 업무 시연용
}
