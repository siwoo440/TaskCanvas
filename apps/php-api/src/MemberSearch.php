<?php // 권한 범위의 통합 검색
declare(strict_types=1); // 엄격한 자료형
final class MemberSearch // 회원 빠른 이동
{ // 서비스 시작
    public static function get(array $user, array $query): array // 안전한 부분 문자열 검색
    { // 검색 시작
        $text = $query['q'] ?? null; // 검색어
        if (array_diff(array_keys($query), ['q']) !== [] || !is_string($text) || trim($text) === '' || mb_strlen(trim($text)) > 80) // 자료형·길이 제한
        { // 입력 거부
            throw new ApiException(400, 'BAD_REQUEST', '검색어는 1~80자여야 합니다.'); // 검색 안내
        } // 입력 검사 끝
        $term = '%' . str_replace(['=', '%', '_'], ['==', '=%', '=_'], trim($text)) . '%'; // LIKE 특수 문자 이스케이프
        $uid = (int) $user['user_id']; $results = []; // 본인 범위
        $definitions = [ // 유형별 최대 10개
            ['project', "SELECT p.project_id AS id,p.project_id,NULL AS board_id,p.title FROM projects p WHERE " . MemberScope::sql('p.project_id') . " AND p.title LIKE ? ESCAPE '=' ORDER BY p.project_id DESC LIMIT 10"], // 작업실
            ['board', "SELECT b.board_id AS id,b.project_id,b.board_id,b.title FROM boards b WHERE " . MemberScope::sql('b.project_id') . " AND b.title LIKE ? ESCAPE '=' ORDER BY b.board_id DESC LIMIT 10"], // 보드
            ['task', "SELECT t.task_id AS id,t.project_id,NULL AS board_id,t.title FROM tasks t WHERE " . MemberScope::sql('t.project_id') . " AND (t.title LIKE ? ESCAPE '=' OR t.description LIKE ? ESCAPE '=') ORDER BY t.task_id DESC LIMIT 10"], // 업무 제목·설명
            ['note', "SELECT o.object_id AS id,b.project_id,b.board_id,LEFT(JSON_UNQUOTE(JSON_EXTRACT(o.payload_json,'$.text')),180) AS title FROM board_objects o JOIN boards b ON b.board_id=o.board_id WHERE " . MemberScope::sql('b.project_id') . " AND o.type='note' AND JSON_UNQUOTE(JSON_EXTRACT(o.payload_json,'$.text')) LIKE ? ESCAPE '=' ORDER BY o.object_id DESC LIMIT 10"], // 메모 원문
        ]; // 검색 정의 끝
        foreach ($definitions as [$kind, $sql]) // 자료 유형 순회
        { // 안전한 조회
            $params = $kind === 'task' ? [$uid, $term, $term] : [$uid, $term]; // 쿼리 바인딩
            foreach (Database::all($sql, $params) as $row) // 현재 범위 결과
            { // 결과 정규화
                $row['kind'] = $kind; $row['id'] = (int) $row['id']; $row['project_id'] = (int) $row['project_id']; // 공개 식별자
                $row['board_id'] = $row['board_id'] === null ? null : (int) $row['board_id']; // 이동할 보드
                $results[] = $row; // 최대 40개
            } // 결과 정규화 끝
        } // 유형 순회 끝
        return ['results' => $results, 'limit' => 40]; // 제한된 응답
    } // 검색 끝
} // 서비스 끝
