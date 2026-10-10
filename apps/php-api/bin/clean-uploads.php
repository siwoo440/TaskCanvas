<?php
// 업로드 정리 CLI: 어느 보드에서도 쓰지 않는 이미지의 파일과 기록을 지운다
// 사용법: php bin/clean-uploads.php [--apply] [--older-than=24] [--project=ID] [--orphan-files] [--force]
//   (옵션 없음)      지울 대상만 보여 주고 아무것도 바꾸지 않음
//   --apply          실제로 지움(되돌릴 수 없음)
//   --older-than=N   올린 지 N시간이 지난 이미지만 대상(기본 24). 방금 올린 이미지를 건드리지 않기 위함
//   --project=ID     그 프로젝트의 이미지만 대상(생략하면 모든 프로젝트)
//   --orphan-files   DB 에 기록이 없는 업로드 파일도 지움. 업로드 폴더를 이 DB 하나만 쓸 때에만 사용
//   --force          최근 30분 안에 보드에 접속한 사람이 있어도 진행
// 보드에서 이미지를 지워도 파일을 바로 지우지 않는 이유: 지운 사람이 실행 취소(Ctrl+Z)로 되살릴 수 있어야 하기 때문.
// 그래서 정리는 이 스크립트로, 아무도 편집하지 않을 때 따로 한다
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
$apply = in_array('--apply', $args, true); // 실제 삭제 여부
$orphans = in_array('--orphan-files', $args, true); // 기록 없는 파일도 지울지
$force = in_array('--force', $args, true); // 접속 중이어도 진행
$hours = 24; // 대상이 되는 최소 경과 시간
$onlyProject = null; // 한 프로젝트만 정리할 때 그 ID
foreach ($args as $arg)
{
    if (preg_match('/^--older-than=(\d{1,4})$/', $arg, $m) === 1)
    {
        $hours = (int) $m[1]; // 경과 시간 지정
    }
    elseif (preg_match('/^--project=(\d{1,10})$/', $arg, $m) === 1)
    {
        $onlyProject = (int) $m[1]; // 대상 프로젝트 지정
    }
    elseif (!in_array($arg, ['--apply', '--orphan-files', '--force'], true))
    {
        fail("알 수 없는 옵션: {$arg}\n사용법: php bin/clean-uploads.php [--apply] [--older-than=24] [--project=ID] [--orphan-files] [--force]"); // 오타 방지
    }
}
if ($onlyProject !== null && $orphans)
{
    fail('--project 와 --orphan-files 는 함께 쓸 수 없습니다. 기록 없는 파일은 어느 프로젝트의 것인지 알 수 없습니다.'); // 범위가 맞지 않는 조합
}

$root = Storage::uploadDir(); // 업로드 폴더
$unused = Database::all(
    "SELECT a.asset_id, a.project_id, a.stored_path, a.size_bytes, a.created_at
       FROM media_assets a
      WHERE a.created_at <= DATE_SUB(NOW(), INTERVAL ? HOUR)
        AND (? IS NULL OR a.project_id = ?)
        AND NOT EXISTS (
            SELECT 1 FROM board_objects o
             WHERE o.type = 'image' AND CAST(JSON_UNQUOTE(JSON_EXTRACT(o.payload_json, '$.asset_id')) AS UNSIGNED) = a.asset_id
        )
      ORDER BY a.asset_id",
    [$hours, $onlyProject, $onlyProject]
); // 어느 보드의 이미지 객체도 가리키지 않는 업로드 기록

$known = []; // DB 가 아는 파일 경로(구분자를 / 로 통일)
foreach (Database::all('SELECT stored_path FROM media_assets') as $row)
{
    $known[str_replace('\\', '/', (string) $row['stored_path'])] = true; // 기록 있는 파일
}
$strays = []; // 기록 없는 파일
if ($orphans)
{
    $prefix = rtrim(str_replace('\\', '/', (string) realpath($root)), '/') . '/'; // 업로드 폴더의 실제 경로
    foreach (Storage::listUploadedFiles() as $path)
    {
        $relative = substr(str_replace('\\', '/', $path), strlen($prefix)); // <프로젝트 ID>/<파일명>
        if (!isset($known[$relative]) && filemtime($path) <= time() - $hours * 3600)
        {
            $strays[] = $path; // 서버가 만든 이름 규칙에 맞지만 DB 기록이 없는 오래된 파일
        }
    }
}

$bytes = 0; // 지워질 용량
foreach ($unused as $row)
{
    $bytes += (int) $row['size_bytes']; // 기록상의 크기
}
foreach ($strays as $path)
{
    $bytes += (int) filesize($path); // 파일 크기
}

echo "=== TaskCanvas 업로드 정리 ===\n"; // 제목
echo '대상 DB     : ' . Env::get('DB_HOST') . ':' . Env::get('DB_PORT') . ' / ' . Env::get('DB_NAME') . "\n"; // DB 정보
echo "업로드 폴더 : {$root}\n"; // 업로드 폴더
echo "기준        : 올린 지 {$hours}시간이 지났고 어느 보드에서도 쓰지 않는 이미지" . ($onlyProject !== null ? " (프로젝트 {$onlyProject} 만)" : '') . "\n"; // 대상 기준
echo '쓰지 않는 이미지 ' . count($unused) . "개" . ($orphans ? ', 기록 없는 파일 ' . count($strays) . '개' : '') . ', 합계 ' . number_format($bytes / 1024, 1) . " KB\n"; // 요약
foreach (array_slice($unused, 0, 10) as $row)
{
    echo "  asset_id={$row['asset_id']} (프로젝트 {$row['project_id']}, {$row['created_at']}, " . number_format((int) $row['size_bytes'] / 1024, 1) . " KB)\n"; // 앞의 몇 개만 표시
}
if (count($unused) > 10)
{
    echo '  … 외 ' . (count($unused) - 10) . "개\n"; // 나머지 수
}

if (!$apply)
{
    exit("미리보기입니다. 아무것도 바꾸지 않았습니다. 실제로 지우려면 --apply 를 붙이세요.\n"); // 기본은 미리보기
}
if (count($unused) + count($strays) === 0)
{
    exit("지울 것이 없습니다.\n"); // 정리할 대상 없음
}

$recent = (int) Database::one(
    'SELECT COUNT(*) AS n FROM realtime_tickets t JOIN boards b ON b.board_id = t.board_id
      WHERE t.created_at >= DATE_SUB(NOW(), INTERVAL 30 MINUTE) AND (? IS NULL OR b.project_id = ?)',
    [$onlyProject, $onlyProject]
)['n']; // 최근 보드 접속 수(대상 프로젝트 기준)
if ($recent > 0 && !$force)
{
    fail("최근 30분 안에 보드에 접속한 기록이 {$recent}건 있습니다. 편집 중인 사람이 방금 지운 이미지를 실행 취소로 되살리지 못하게 될 수 있어 멈춥니다.\n아무도 쓰지 않을 때 다시 실행하거나, 괜찮다면 --force 를 붙이세요."); // 편집 중 보호
}

$deleted = 0; // 지운 이미지 수
$dirs = []; // 비었을 수 있는 프로젝트 폴더
foreach ($unused as $row)
{
    $path = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, (string) $row['stored_path']); // 파일 위치
    $removed = Database::run(
        "DELETE FROM media_assets
          WHERE asset_id = ?
            AND NOT EXISTS (
                SELECT 1 FROM board_objects o
                 WHERE o.type = 'image' AND CAST(JSON_UNQUOTE(JSON_EXTRACT(o.payload_json, '$.asset_id')) AS UNSIGNED) = ?
            )",
        [(int) $row['asset_id'], (int) $row['asset_id']]
    )->rowCount(); // 기록 삭제(목록을 만든 뒤 누가 다시 쓰기 시작했으면 지우지 않음)
    if ($removed === 0)
    {
        continue; // 그 사이 다시 쓰이기 시작한 이미지
    }
    if (preg_match(Storage::FILE_PATTERN, basename($path)) === 1 && is_file($path) && !is_link($path))
    {
        unlink($path); // 파일 삭제(서버가 만든 이름 규칙에 맞는 것만)
        $dirs[dirname($path)] = true; // 폴더 기록
    }
    $deleted++; // 지운 수
}
$strayDeleted = 0; // 지운 기록 없는 파일 수
foreach ($strays as $path)
{
    if (unlink($path))
    {
        $strayDeleted++; // 삭제 성공
        $dirs[dirname($path)] = true; // 폴더 기록
    }
}
foreach (array_keys($dirs) as $dir)
{
    if (is_dir($dir) && count(scandir($dir) ?: []) === 2)
    {
        rmdir($dir); // 빈 프로젝트 폴더 제거(다른 파일이 남아 있으면 그대로 둠)
    }
}
echo "쓰지 않는 이미지 {$deleted}개" . ($orphans ? ", 기록 없는 파일 {$strayDeleted}개" : '') . "를 지웠습니다.\n"; // 결과
