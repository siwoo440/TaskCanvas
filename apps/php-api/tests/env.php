<?php // 설정 파일 유무와 환경 변수 우선순위 검증
declare(strict_types=1); // 엄격한 자료형 검사
require dirname(__DIR__) . '/src/Env.php'; // 설정 로더
$previous = getenv('DB_NAME'); // 기존 프로세스 설정 보관
$result = 0; // 종료 코드
try // 환경 변수 병합 검사
{ // 검사 시작
    putenv('DB_NAME=taskcanvas_env_test_only'); // DB 접속 없는 가상 설정
    Env::load(__DIR__ . '/missing-' . bin2hex(random_bytes(8)) . '.env'); // 존재하지 않는 설정 파일
    if (Env::get('DB_NAME') !== 'taskcanvas_env_test_only') // 실행 환경 우선순위 확인
    { // 실패 처리 시작
        throw new RuntimeException('.env 없음: 프로세스 DB_NAME 미적용'); // 실제 DB 선택 위험 검출
    } // 실패 처리 끝
    echo "PASS .env 없음: 프로세스 DB_NAME 우선 적용\n"; // 첫 검사 결과
    Env::load(dirname(__DIR__) . '/.env.example'); // 저장소의 예시 설정 파일
    if (Env::get('DB_NAME') !== 'taskcanvas_env_test_only') // 파일보다 높은 환경 우선순위
    { // 실패 처리 시작
        throw new RuntimeException('.env 있음: 프로세스 DB_NAME 미적용'); // 우선순위 오류 검출
    } // 실패 처리 끝
    echo "PASS .env 있음: 프로세스 DB_NAME 우선 적용\n"; // 두 번째 검사 결과
} // 검사 끝
catch (Throwable $error) // 검증 실패 보고
{ // 오류 보고 시작
    fwrite(STDERR, 'FAIL ' . $error->getMessage() . "\n"); // 실패 원인
    $result = 1; // 실패 종료 코드
} // 오류 보고 끝
finally // 프로세스 설정 원상 복구
{ // 복구 시작
    putenv($previous === false ? 'DB_NAME' : 'DB_NAME=' . $previous); // 기존 값 복구
} // 복구 끝
exit($result); // 검증 종료
