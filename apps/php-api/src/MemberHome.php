<?php // 회원별 업무와 보드
declare(strict_types=1); // 엄격한 자료형
final class MemberHome // 개인 홈 자료
{ // 서비스 시작
    public static function get(array $user): array // 본인 자료 조회
    { // 조회 시작
        $uid = (int) $user['user_id']; $scope = MemberScope::sql('t.project_id'); // 현재 멤버십 범위
        $sql = "SELECT t.task_id,t.project_id,t.title,t.status,t.due_at,p.title AS project_title FROM tasks t JOIN projects p ON p.project_id=t.project_id WHERE t.status<>'done' AND EXISTS(SELECT 1 FROM guest_user_links own WHERE own.guest_id=t.assignee_id AND own.user_id=?) AND " . $scope; // 본인에게 배정된 업무
        $tasks = Database::all($sql . ' ORDER BY t.task_id DESC LIMIT 20', [$uid, $uid]); // 최근 업무
        $today = new DateTimeImmutable('today', new DateTimeZone('Asia/Seoul')); // 서울 오늘
        $due = Database::all($sql . ' AND t.due_at>=? AND t.due_at<? ORDER BY t.due_at,t.task_id LIMIT 20', [$uid, $uid, $today->format('Y-m-d'), $today->modify('+4 days')->format('Y-m-d')]); // 오늘부터 3일 이내
        $base = 'SELECT b.board_id,b.project_id,b.title,p.title AS project_title FROM boards b JOIN projects p ON p.project_id=b.project_id '; // 보드 정보
        $favorites = Database::all($base . 'JOIN user_board_favorites f ON f.board_id=b.board_id WHERE f.user_id=? AND ' . MemberScope::sql('b.project_id') . ' ORDER BY f.created_at DESC,b.board_id DESC LIMIT 100', [$uid, $uid]); // 접근 가능한 즐겨찾기
        $recent = Database::all($base . 'JOIN user_board_visits v ON v.board_id=b.board_id WHERE v.user_id=? AND ' . MemberScope::sql('b.project_id') . ' ORDER BY v.visited_at DESC,b.board_id DESC LIMIT 10', [$uid, $uid]); // 최근 보드
        return ['tasks' => $tasks, 'due_soon' => $due, 'favorites' => $favorites, 'recent' => $recent]; // 자료별 분리
    } // 조회 끝
    public static function board(array $user, int $boardId, ?bool $favorite): void // 즐겨찾기 또는 방문
    { // 변경 시작
        $projectId = Auth::boardProject($boardId); // 실제 보드 범위
        MemberScope::transaction($user, $projectId, static function () use ($user, $boardId, $projectId, $favorite): void // 개인 한도 직렬화
        { // 변경 본문
            $uid = (int) $user['user_id']; MemberScope::role($uid, $projectId); // 최신 접근 검사
            if ($favorite === null) // 방문 시각
            { // 최근 기록
                Database::run('INSERT INTO user_board_visits (user_id,board_id,visited_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE visited_at=VALUES(visited_at)', [$uid, $boardId, date('Y-m-d H:i:s')]); // 서울 최근 시각
                return; // 방문 종료
            } // 방문 끝
            if (!$favorite) // 해제 요청
            { // 즐겨찾기 해제
                Database::run('DELETE FROM user_board_favorites WHERE user_id=? AND board_id=?', [$uid, $boardId]); // 본인 자료만
                return; // 해제 종료
            } // 해제 끝
            Database::run('DELETE f FROM user_board_favorites f JOIN boards b ON b.board_id=f.board_id WHERE f.user_id=? AND NOT ' . MemberScope::sql('b.project_id'), [$uid, $uid]); // 접근 해제된 본인 설정 한도 회수
            $existing = Database::one('SELECT board_id FROM user_board_favorites WHERE user_id=? AND board_id=?', [$uid, $boardId]); // 중복 요청
            if ($existing !== null) // 이미 등록
            { // 멱등 처리
                return; // 추가 없음
            } // 멱등 처리 끝
            if ((int) Database::one('SELECT COUNT(*) AS n FROM user_board_favorites WHERE user_id=?', [$uid])['n'] >= 100) // 개인 한도
            { // 한도 안내
                throw new ApiException(409, 'FAVORITE_LIMIT', '즐겨찾기는 100개까지 등록할 수 있습니다.'); // 등록 제한
            } // 한도 끝
            Database::run('INSERT INTO user_board_favorites (user_id,board_id) VALUES (?,?)', [$uid, $boardId]); // 신규 등록
        }); // 변경 본문 끝
    } // 변경 끝
} // 서비스 끝
