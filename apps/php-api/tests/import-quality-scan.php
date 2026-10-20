<?php // 독립 품질 집계 표본
declare(strict_types=1); // 엄격한 자료형
require __DIR__ . '/import-test-support.php'; // 제품 클래스와 비교
$source = ImportSource::open("키,숫자,날짜\nA,,2026-10-20\nB,틀림,2026-02-30\n,2,2026-10-20\nA,3,2026-10-20\n", 'csv', 'UTF-8', null); // 실제 원본
$config = ImportValues::config(['name' => '검사', 'columns' => [['source_id' => 's0', 'label' => '키', 'type' => 'text', 'required' => true], ['source_id' => 's1', 'label' => '숫자', 'type' => 'number', 'required' => false], ['source_id' => 's2', 'label' => '날짜', 'type' => 'date', 'required' => true]], 'key_column' => 'c0'], $source->columns(), null); // 고정 매핑
$scan = new ImportQualityScan($config); $issues = []; // 관찰기 부재 RED
foreach ($source->rows() as $raw) // 전체 원본 관찰
{ // 행 처리
    $row = ImportValues::row($raw, $config); $issues[] = $scan->observe($raw, $row, $raw['source_row'] === 4, $raw['source_row'] === 4); // 독립 중복 표본
} // 관찰 끝
$summary = $scan->summary(); // 집계 결과
foreach (['received' => 4, 'valid_rows' => 2, 'error_rows' => 2, 'error_count' => 3, 'warning_rows' => 2, 'warning_count' => 3, 'duplicate_rows' => 1, 'file_duplicate_rows' => 1, 'existing_duplicate_rows' => 1] as $key => $expected) // 독립 기대값
{ // 합계 검사
    ImportTest::same($summary[$key], $expected, $key); // 행/오류/중첩 구분
} // 합계 끝
ImportTest::same($summary['columns'][1]['missing_count'], 1, '잘못된 숫자를 결측으로 세지 않음'); // 원본 결측 기준
ImportTest::same($summary['columns'][1]['missing_rate'], 25.0, '컬럼 결측률'); // 전체 행 분모
ImportTest::same($summary['columns'][1]['invalid_count'], 1, '숫자 형식 오류'); // 자료형 집계
ImportTest::same($issues[1][0][1], 'invalid_number', '숫자 오류 코드'); // 세분 판정
ImportTest::same($issues[1][1][1], 'invalid_date', '날짜 오류 코드'); // 달력 판정
$empty = (new ImportQualityScan($config))->summary(); // 빈 분모
ImportTest::same($empty['columns'][0]['missing_rate'], 0.0, '빈 분모 비율0'); // 나누기 예외 방지
$raw = ['source_row' => 1, 'values' => ['A', null, '2026-10-20'], 'errors' => [['source_id' => 's1', 'code' => 'INVALID_ROW', 'field' => '숫자', 'message' => '배열 셀', 'source_row' => 1]]]; // 파서 구조 오류
$structural = new ImportQualityScan($config); $structural->observe($raw, ImportValues::row($raw, $config), false, false); // 구조로 바뀐 null
ImportTest::same($structural->summary()['columns'][1]['missing_count'], 0, '구조 오류 null은 결측 아님'); // 거짓 결측 방지
ImportTest::same(str_contains(json_encode($summary), '틀림'), false, '원문 없는 집계'); // 값 비노출
foreach (['[{"a":"ok","b":"ok"},false]', '[{"a":"ok","b":"ok"},{"a":[],"b":"ok"}]', '[{"a":"ok","b":"ok"},{"a":"\\u0001","b":"ok"}]'] as $json) // 구조가 만든 빈 값
{ // 실제 파서 표본
    $source = ImportSource::open($json, 'json', 'UTF-8', null); // 제품 파싱
    $config = ImportValues::config(['name' => '구조', 'columns' => [['source_id' => 's0', 'label' => 'a', 'type' => 'text', 'required' => true], ['source_id' => 's1', 'label' => 'b', 'type' => 'text', 'required' => false]]], $source->columns(), null); // 필수·선택 필드
    $scan = new ImportQualityScan($config); // 독립 집계
    foreach ($source->rows() as $raw) // 정상 행과 구조 오류 행
    { // 관찰 실행
        $scan->observe($raw, ImportValues::row($raw, $config), false, false); // 공통 판정
    } // 관찰 끝
    $result = $scan->summary(); // 원문 없는 결과
    ImportTest::same($result['error_count'], 1, '구조 오류에 거짓 필수 오류 없음'); // 중복 오류 방지
    ImportTest::same($result['warning_count'], 0, '합성 null의 거짓 선택 경고 없음'); // 허위 경고 방지
    ImportTest::same(array_column($result['columns'], 'missing_count'), [0, 0], '합성 null의 거짓 결측 없음'); // 정확한 결측
} // 구조 표본 끝
$source = ImportSource::open("a,b,c\n,x\n", 'csv', 'UTF-8', null); // 실제 빈 첫 셀과 누락 마지막 셀
$config = ImportValues::config(['name' => 'CSV 구조', 'columns' => [['source_id' => 's0', 'label' => 'a', 'type' => 'text', 'required' => true], ['source_id' => 's1', 'label' => 'b', 'type' => 'text', 'required' => false], ['source_id' => 's2', 'label' => 'c', 'type' => 'text', 'required' => true]]], $source->columns(), null); // 세 컬럼
$scan = new ImportQualityScan($config); // CSV 관찰
foreach ($source->rows() as $raw) // 원본의 실제 위치
{ // 실제 값 검증
    $scan->observe($raw, ImportValues::row($raw, $config), false, false); // 구조·값 별도
} // 검증 끝
ImportTest::same(array_column($scan->summary()['columns'], 'missing_count'), [1, 0, 0], 'CSV 실제 빈 셀만 결측 유지'); // 구조 행 전체 억제 금지
ImportTest::same($scan->summary()['error_count'], 2, 'CSV 구조 오류와 실제 필수 결측만 집계'); // 누락 열 중복 오류 없음
echo '품질 집계 ' . ImportTest::$passed . "개 통과\n"; // 실제 결과
