<?php // 회원 작업실 권한 경계
declare(strict_types=1); // 엄격한 자료형
final class MemberScope // 회원 공통 범위
{ // 서비스 시작
    public static function sql(string $column): string // 내부 SQL 범위
    { // 범위 조립
        return 'EXISTS (SELECT 1 FROM project_members ms JOIN guest_user_links ls ON ls.guest_id=ms.guest_id WHERE ms.project_id=' . $column . ' AND ls.user_id=?)'; // 중복 없는 접근 조건
    } // 범위 조립 끝
    public static function role(int $userId, int $projectId, string $minimum = 'viewer'): array // 연결 게스트의 최고 역할
    { // 역할 검사
        $row = Database::one("SELECT m.guest_id,m.role FROM project_members m JOIN guest_user_links l ON l.guest_id=m.guest_id WHERE l.user_id=? AND m.project_id=? ORDER BY FIELD(m.role,'admin','editor','viewer'),m.guest_id LIMIT 1", [$userId, $projectId]); // 실제 멤버십
        if ($row === null || Auth::rank($row['role']) < Auth::rank($minimum)) // 접근 부족
        { // 접근 거부
            throw new ApiException(403, 'FORBIDDEN', '이 작업실에 대한 회원 권한이 없습니다.'); // 서버 범위 안내
        } // 접근 거부 끝
        return $row; // 검증한 대표 멤버십
    } // 역할 검사 끝
    public static function transaction(array $user, int $projectId, callable $operation): mixed // 회원 변경 직렬화
    { // 변경 시작
        $pdo = Database::pdo(); $pdo->beginTransaction(); // 단일 트랜잭션
        try // 최신 소유·세션 검사
        { // 잠금 획득
            if ($projectId > 0 && Database::one('SELECT project_id FROM projects WHERE project_id=? FOR UPDATE', [$projectId]) === null) // 작업실 잠금
            { // 대상 없음
                throw new ApiException(404, 'NOT_FOUND', '작업실을 찾을 수 없습니다.'); // 삭제 안내
            } // 대상 검사 끝
            Database::one('SELECT user_id FROM users WHERE user_id=? FOR UPDATE', [(int) $user['user_id']]); // 개인 한도·기본값 직렬화
            $session = Database::one('SELECT session_id FROM user_sessions WHERE session_id=? AND user_id=? AND revoked_at IS NULL AND expires_at>NOW() FOR UPDATE', [(int) $user['user_session_id'], (int) $user['user_id']]); // 대기 중 만료 재검사
            if ($session === null) // 만료 세션
            { // 인증 거부
                throw new ApiException(401, 'UNAUTHORIZED', '로그인이 만료되었습니다.'); // 재인증 안내
            } // 인증 검사 끝
            $result = $operation(); $pdo->commit(); // 저장 확정
            return $result; // 변경 결과
        } // 변경 본문 끝
        catch (Throwable $error) // 실패 복구
        { // 복구 시작
            $pdo->rollBack(); throw $error; // 전체 변경 취소
        } // 복구 끝
    } // 변경 끝
} // 서비스 끝
