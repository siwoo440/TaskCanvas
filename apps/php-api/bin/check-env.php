<?php
// 학교 PC 사전 점검(PHP 쪽): 버전·확장·업로드 한도·설정 파일·DB 연결·스키마·업로드 폴더를 확인한다
// 사용법: php bin/check-env.php   (scripts\check-env.bat 가 실시간 서버 쪽 점검과 함께 실행)
// 구버전 PHP 에서도 이 파일은 읽혀야 버전 안내를 할 수 있으므로 이 파일만 PHP 7.0 문법으로 쓴다
declare(strict_types=1);

if (PHP_SAPI !== 'cli')
{
    exit("CLI 전용 스크립트입니다.\n"); // 웹 실행 차단
}

$counts = array('ok' => 0, 'warn' => 0, 'fail' => 0); // 결과별 항목 수

// 점검 결과 한 줄을 출력하고 개수를 센다
function report($level, $name, $detail)
{
    global $counts; // 결과 집계
    $labels = array('ok' => '통과', 'warn' => '주의', 'fail' => '실패', 'info' => '안내'); // 표시 문구
    if (isset($counts[$level]))
    {
        $counts[$level]++; // 집계(안내는 세지 않음)
    }
    echo '[' . $labels[$level] . '] ' . $name . ' — ' . $detail . "\n"; // 한 줄 출력
}

// php.ini 의 크기 표기(40M, 1G, 8192)를 바이트로 바꾼다. 0 이하는 제한 없음
function iniBytes($value)
{
    $value = trim((string) $value); // 공백 제거
    $number = (float) $value; // 숫자 부분
    $unit = strtolower(substr($value, -1)); // 단위 글자
    $scale = array('k' => 1024, 'm' => 1048576, 'g' => 1073741824); // 단위별 배수
    return (int) ($number * (isset($scale[$unit]) ? $scale[$unit] : 1)); // 바이트 값
}

ob_start(); // 공통 초기화가 응답 헤더를 정리하므로 그 전의 출력은 잠시 모아 둔다
echo "--- PHP·DB 점검 ---\n"; // 구역 제목

// 1) PHP 버전
if (PHP_VERSION_ID < 80000)
{
    report('fail', 'PHP 버전', PHP_VERSION . ' — 8.0 이상이 필요합니다. 최신 XAMPP 를 설치하세요.'); // 앱 코드를 읽을 수 없음
    echo "PHP 쪽: 통과 0, 주의 0, 실패 1\n"; // 요약
    exit(1); // 이후 점검 불가
}
report('ok', 'PHP 버전', PHP_VERSION . ' (' . PHP_BINARY . ')'); // 버전과 실행 파일

// 2) 필요한 확장
$extensions = array('pdo_mysql' => 'DB 연결', 'fileinfo' => '업로드 이미지 형식 검사', 'mbstring' => '글자 수 계산'); // 확장과 쓰임
foreach ($extensions as $extension => $purpose)
{
    if (extension_loaded($extension))
    {
        report('ok', '확장 ' . $extension, $purpose); // 사용 가능
    }
    else
    {
        report('fail', '확장 ' . $extension, $purpose . '에 필요합니다. ' . (php_ini_loaded_file() ?: 'php.ini') . ' 에서 extension=' . $extension . ' 줄의 주석(;)을 지우세요.'); // 켜는 방법 안내
    }
}

// 3) 앱 코드와 설정 파일
$root = dirname(__DIR__); // php-api 폴더
try
{
    require $root . '/src/bootstrap.php'; // 공통 초기화(오토로더·.env)
}
catch (Throwable $e)
{
    report('fail', '앱 코드', '불러오지 못했습니다: ' . $e->getMessage()); // 파일 누락 등
    echo 'PHP 쪽: 통과 ' . $counts['ok'] . ', 주의 ' . $counts['warn'] . ', 실패 ' . $counts['fail'] . "\n"; // 요약
    exit(1); // 이후 점검 불가
}
ob_end_flush(); // 모아 둔 출력 내보내기(이후로는 바로 출력)
if (is_file($root . '/.env'))
{
    report('ok', '설정 파일', 'apps/php-api/.env'); // 설정 파일 있음
}
else
{
    report('warn', '설정 파일', 'apps/php-api/.env 가 없어 기본값(root, 비밀번호 없음)을 씁니다. .env.example 을 .env 로 복사하세요.'); // 기본값으로 동작
}

// 4) 업로드 한도: 이미지 한 장(기본 10MB)이 php.ini 한도 안에 들어가야 함
$maxUpload = Env::int('MAX_UPLOAD_BYTES', 10485760); // 앱이 허용하는 파일 크기
$iniUpload = iniBytes(ini_get('upload_max_filesize')); // 파일 하나의 한도
$iniPost = iniBytes(ini_get('post_max_size')); // 요청 전체의 한도
if (!filter_var(ini_get('file_uploads'), FILTER_VALIDATE_BOOLEAN))
{
    report('fail', '업로드 한도', 'php.ini 의 file_uploads 가 꺼져 있어 이미지를 올릴 수 없습니다.'); // 업로드 자체가 꺼짐
}
elseif ($iniUpload < $maxUpload || ($iniPost > 0 && $iniPost <= $maxUpload))
{
    report('fail', '업로드 한도', 'upload_max_filesize=' . ini_get('upload_max_filesize') . ', post_max_size=' . ini_get('post_max_size') . ' — 둘 다 ' . ceil($maxUpload / 1048576) . 'M 보다 커야 합니다(' . (php_ini_loaded_file() ?: 'php.ini') . ').'); // 큰 이미지가 PHP 에서 먼저 잘림
}
else
{
    report('ok', '업로드 한도', 'upload_max_filesize=' . ini_get('upload_max_filesize') . ', post_max_size=' . ini_get('post_max_size') . ' (앱 한도 ' . round($maxUpload / 1048576) . 'MB)'); // 충분함
}

// 5) DB 연결과 스키마
$dbName = Env::get('DB_NAME'); // 대상 DB
$connected = false; // 연결 성공 여부
try
{
    $version = Database::one('SELECT VERSION() AS v'); // 연결 확인
    $connected = true; // 연결됨
    report('ok', 'DB 연결', Env::get('DB_HOST') . ':' . Env::get('DB_PORT') . ' / ' . $dbName . ' (' . $version['v'] . ')'); // 접속 정보
}
catch (Throwable $e)
{
    $message = $e->getMessage(); // 오류 원문
    if (strpos($message, '[2002]') !== false)
    {
        $hint = 'MariaDB 가 꺼져 있습니다. XAMPP Control Panel 에서 MySQL 을 Start 하세요.'; // 서버 꺼짐
    }
    elseif (strpos($message, '[1049]') !== false)
    {
        $hint = "DB '" . $dbName . "' 가 없습니다. database/schema.sql 을 적용하세요."; // DB 없음
    }
    elseif (strpos($message, '[1045]') !== false)
    {
        $hint = '.env 의 DB_USER·DB_PASS 가 맞지 않습니다.'; // 인증 실패
    }
    else
    {
        $hint = $message; // 그 외에는 원문 표시
    }
    report('fail', 'DB 연결', $hint); // 연결 실패
}
if ($connected)
{
    $required = array('projects', 'boards', 'guests', 'guest_sessions', 'project_members', 'project_invites', 'board_objects', 'board_links', 'tasks', 'media_assets', 'realtime_tickets', 'join_attempts'); // 앱이 쓰는 테이블
    $existing = array(); // 실제 테이블
    foreach (Database::all('SHOW TABLES') as $row)
    {
        $existing[] = (string) array_values($row)[0]; // 테이블 이름
    }
    $missing = array_diff($required, $existing); // 없는 테이블
    if ($missing === array())
    {
        $columns = Schema::missing(); // 나중에 바뀐 컬럼 가운데 반영되지 않은 것
        if ($columns === array())
        {
            report('ok', 'DB 스키마', '테이블 ' . count($required) . '개 확인'); // 스키마 적용됨
        }
        else
        {
            report('fail', 'DB 스키마', '예전 스키마입니다(반영되지 않은 변경: ' . implode(', ', $columns) . '). C:\\xampp\\php\\php.exe apps\\php-api\\bin\\migrate.php 를 실행하세요.'); // 보정 필요
        }
        $projects = (int) Database::one('SELECT COUNT(*) AS n FROM projects')['n']; // 프로젝트 수
        $invites = (int) Database::one('SELECT COUNT(*) AS n FROM project_invites WHERE revoked_at IS NULL AND expires_at > NOW()')['n']; // 쓸 수 있는 초대 코드 수
        if ($projects === 0)
        {
            report('warn', '시연 데이터', '프로젝트가 없습니다. scripts\\reset-demo.bat --seed 로 시연 프로젝트를 만드세요.'); // 입장할 곳이 없음
        }
        else
        {
            report('info', '시연 데이터', '프로젝트 ' . $projects . '개, 사용할 수 있는 초대 코드 ' . $invites . '개'); // 현재 상태
        }
    }
    else
    {
        report('fail', 'DB 스키마', '테이블이 없습니다: ' . implode(', ', $missing) . ' — database/schema.sql 을 적용하세요.'); // 스키마 미적용
    }
}

// 6) 업로드 폴더: 없으면 만들고, 파일을 써 보고 지운다
$uploadDir = Storage::uploadDir(); // 업로드 폴더
try
{
    if (!is_dir($uploadDir))
    {
        mkdir($uploadDir, 0775, true); // 첫 업로드 때와 같은 방식으로 폴더 생성
    }
    $probe = $uploadDir . DIRECTORY_SEPARATOR . 'check-' . bin2hex(random_bytes(6)) . '.tmp'; // 임시 파일(업로드 파일 이름 규칙과 다름)
    file_put_contents($probe, 'ok'); // 쓰기 확인
    unlink($probe); // 바로 삭제
    report('ok', '업로드 폴더', $uploadDir . ' 에 쓸 수 있음'); // 쓰기 가능
}
catch (Throwable $e)
{
    report('fail', '업로드 폴더', $uploadDir . ' 에 쓸 수 없습니다: ' . $e->getMessage()); // 권한·경로 문제
}

echo 'PHP 쪽: 통과 ' . $counts['ok'] . ', 주의 ' . $counts['warn'] . ', 실패 ' . $counts['fail'] . "\n"; // 요약
exit($counts['fail'] > 0 ? 1 : 0); // 실패가 있으면 종료 코드 1
