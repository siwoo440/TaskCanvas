<?php // 실제 원본과 값 파서 검증
declare(strict_types=1); // 엄격한 자료형
require __DIR__ . '/import-test-support.php'; // DB 없는 검증 도우미
$source = ImportSource::open("\xEF\xBB\xBF이름,금액\r\n\"첫째,자료\",001.230000\r\n\"여러\n줄\"\"인용\",-0.000000\r\n", 'csv', 'UTF-8', null); // 실제 CSV 바이트
ImportTest::same($source->count(), 2, '인용·쉼표·여러 줄의 레코드 수'); // 독립 기대값
ImportTest::same($source->preview()[1]['values'][0], "여러\n줄\"인용", '여러 줄과 인용 원문'); // 정확한 셀
$config = ImportValues::config(['mode' => 'create', 'name' => '숫자 표', 'columns' => [['source_id' => 's0', 'label' => '이름', 'type' => 'text', 'required' => true], ['source_id' => 's1', 'label' => '금액', 'type' => 'number', 'required' => false]], 'key_column' => 'c0', 'duplicate_policy' => 'skip'], $source->columns(), null); // 실제 매핑
$rows = iterator_to_array($source->rows()); // 작은 표본
ImportTest::same(ImportValues::row($rows[0], $config)['values'], ['첫째,자료', '1.23'], '정밀도·선행0·소수말미0'); // 독립 기대값
ImportTest::same(ImportValues::row($rows[1], $config)['values'][1], '0', '음수0 정규화'); // 0 기준
$cp949 = ImportSource::open("\xC0\xCC\xB8\xA7\n\xC7\xD1\xB1\xDB\n", 'csv', 'CP949', null); // 알려진 국내 인코딩 바이트
ImportTest::same($cp949->preview()[0]['values'], ['한글'], '명시적 CP949 변환'); // 문자 손실 방지
$json = ImportSource::open('{"data":{"items":[{"a/b":{"~key":12345678901234567890},"value":0.0000001},{"extra":"<img src=x>","value":true}]}}', 'json', 'UTF-8', '/data/items'); // 경로와 큰 숫자
ImportTest::same($json->columns()[0]['path'], '/a~1b/~0key', 'JSON Pointer 필드 이스케이프'); // 경로 구분
ImportTest::same($json->preview()[0]['values'][0], '12345678901234567890', '큰 정수 원문 유지'); // 부동소수점 금지
ImportTest::same($json->preview()[0]['values'][1], '0.0000001', '소수 원문 유지'); // 미세 값 보존
ImportTest::same($json->preview()[1]['values'][0], null, '행별 누락 필드 null'); // 합집합 스키마
ImportTest::same(count($json->columns()), 3, '전체 행 필드 합집합'); // 앞20행 한정 금지
$pick = ImportSource::open('{"data":{"items":[{"name":"값"}]}}', 'json', 'UTF-8', null); // 선택 전 JSON
ImportTest::same($pick->requiresPath(), true, '배열 경로 선택 요구'); // 모호한 자동 선택 금지
ImportTest::same($pick->paths()[0]['path'], '/data/items', '배열 경로 후보'); // 경로 안내
$invalidFiles = [ // 구문 오류 표본
    ["a,a\n1,2", 'csv', 'UTF-8', null], // 중복 헤더
    ["a,\n1,2", 'csv', 'UTF-8', null], // 빈 헤더
    ["a\n\"열림", 'csv', 'UTF-8', null], // 미완성 인용
    ["a\n1\"2", 'csv', 'UTF-8', null], // 잘못된 인용 위치
    ["a\n\xFF", 'csv', 'UTF-8', null], // 손상 UTF-8
    ['[{"a":1,"\u0061":2}]', 'json', 'UTF-8', ''], // decoded 중복 키
    ['[{"a":01}]', 'json', 'UTF-8', ''], // 잘못된 숫자
    ['{"items":[]}', 'json', 'UTF-8', '/missing'], // 없는 경로
]; // 오류 표본 끝
foreach ($invalidFiles as $case) // 실제 파싱 거부
{ // 입력 검사
    ImportTest::rejects(static fn() => ImportSource::open(...$case), 415, '구문/구조 오류 거부'); // 명확한 실패
} // 입력 검사 끝
$one = ImportSource::open("값\n1\n", 'csv', 'UTF-8', null); // 단일 열
$numberConfig = ImportValues::config(['mode' => 'create', 'name' => '검증', 'columns' => [['source_id' => 's0', 'label' => '값', 'type' => 'number', 'required' => true]], 'key_column' => null, 'duplicate_policy' => 'skip'], $one->columns(), null); // 숫자 검증
foreach (['999999999999.123456', '+001.200000', '-0'] as $i => $value) // 허용 숫자
{ // 정규화 확인
    ImportTest::same(ImportValues::row(['source_row' => 1, 'values' => [$value], 'errors' => []], $numberConfig)['values'][0], ['999999999999.123456', '1.2', '0'][$i], '숫자 허용 경계'); // 고정 기대값
} // 정규화 끝
foreach (['1000000000000', '0.0000001', '1e3', '1,234', 'NaN', '', true] as $value) // 금지 숫자
{ // 오류 확인
    ImportTest::same(count(ImportValues::row(['source_row' => 1, 'values' => [$value], 'errors' => []], $numberConfig)['errors']) > 0, true, '잘못된 숫자·필수값 거부'); // 값 오류
} // 오류 확인 끝
$dateConfig = $numberConfig; $dateConfig['columns'][0]['type'] = 'date'; // 같은 필드의 날짜 검사
foreach (['2024-02-29', '1000-01-01', '9999-12-31'] as $value) // 실제 날짜
{ // 날짜 허용
    ImportTest::same(ImportValues::row(['source_row' => 1, 'values' => [$value], 'errors' => []], $dateConfig)['errors'], [], '날짜 허용 경계'); // 달력 검사
} // 날짜 허용 끝
foreach (['2025-02-29', '0999-12-31', '2024-2-1'] as $value) // 잘못된 날짜
{ // 날짜 거부
    ImportTest::same(count(ImportValues::row(['source_row' => 1, 'values' => [$value], 'errors' => []], $dateConfig)['errors']), 1, '날짜 형식·달력 거부'); // 오류 위치
} // 날짜 거부 끝
ImportTest::same(ImportSource::open("a,b\n1\n", 'csv', 'UTF-8', null)->preview()[0]['errors'][0]['source_row'], 1, '열 불일치의 원본 데이터 행 번호'); // 헤더 제외 위치
ImportTest::rejects(static fn() => ImportSource::open(str_repeat('x', 5242881), 'csv', 'UTF-8', null), 413, '파일 크기 상한'); // 파싱 전 제한
ImportTest::rejects(static fn() => ImportSource::open('a' . str_repeat("\n1", 10001), 'csv', 'UTF-8', null), 413, '행 수 상한'); // 10001행
ImportTest::same(ImportSource::open('a' . str_repeat("\n1", 10000), 'csv', 'UTF-8', null)->count(), 10000, '10000행 허용'); // 마지막 허용 행
ImportTest::rejects(static fn() => ImportSource::open(implode(',', range(1, 51)) . "\n1", 'csv', 'UTF-8', null), 413, '원본 필드 수 상한'); // 51개
ImportTest::same(count(ImportSource::open(implode(',', range(1, 50)) . "\n" . implode(',', range(1, 50)), 'csv', 'UTF-8', null)->columns()), 50, '50열 허용'); // 최대 필드
ImportTest::rejects(static fn() => ImportSource::open(implode(',', range(1, 50)) . "\n" . implode(',', range(1, 51)), 'csv', 'UTF-8', null), 413, '마지막 레코드 51열 거부'); // 줄 끝 없는 경계
ImportTest::same(ImportSource::open("a\n" . str_repeat('x', 4000), 'csv', 'UTF-8', null)->count(), 1, '4000자 셀 구문 허용'); // 마지막 허용 셀
$textConfig = $numberConfig; $textConfig['columns'][0]['type'] = 'text'; // 문자 매핑
ImportTest::same(count(ImportValues::row(['source_row' => 1, 'values' => [str_repeat('x', 4001)], 'errors' => []], $textConfig)['errors']), 1, '4001자 셀 값 거부'); // 저장 한도
ImportTest::same(count(ImportSource::open('[{"x":"\u0000"}]', 'json', 'UTF-8', '')->preview()[0]['errors']), 1, 'JSON escaped 제어 문자 차단'); // decoded 원문 안전성
ImportTest::same(ImportSource::open(str_pad("a\n1\n", 5242880, "\n"), 'csv', 'UTF-8', null)->count(), 1, '정확한 5MiB 파일 허용'); // 원본 바이트 경계
ImportTest::rejects(static fn() => ImportSource::open('[{"a":{"b":{"c":{"d":{"e":{"f":"x"}}}}}}]', 'json', 'UTF-8', ''), 415, '행 객체 여섯 단계 거부'); // 행 깊이
ImportTest::rejects(static fn() => ImportSource::open(str_repeat('[', 17) . '0' . str_repeat(']', 17), 'json', 'UTF-8', ''), 415, 'JSON 전체 깊이17 거부'); // 전체 깊이
echo '파서 ' . ImportTest::$passed . "개 통과\n"; // 결과
