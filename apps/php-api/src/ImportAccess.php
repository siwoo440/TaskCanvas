<?php // 가져오기 쓰기의 권한과 잠금 수명
declare(strict_types=1); // 엄격한 자료형
final class ImportAccess // 인증과 원자적 변경
{ // 접근 시작
    public static function write(Request $request, int $projectId, string $minimumRole, callable $operation): mixed // 보호된 쓰기
    { // 변경 시작
        Auth::requireMutationHeader($request); $guest = Auth::requireGuest($request); // 파싱 전 신원
        Auth::requireRole((int) $guest['guest_id'], $projectId, $minimumRole); // 최초 역할
        $pdo = Database::pdo(); $pdo->beginTransaction(); // 같은 연결의 변경
        try // 잠금과 재검증
        { // 트랜잭션 본문
            if (Database::one('SELECT project_id FROM projects WHERE project_id=? FOR UPDATE', [$projectId]) === null) // 작업실 우선 잠금
            { // 삭제된 대상
                throw new ApiException(404, 'PROJECT_NOT_FOUND', '작업실이 삭제되었습니다.'); // 기존 화면 정리
            } // 삭제된 대상 끝
            if ($guest['user_session_id'] !== null) // 회원 결합 세션
            { // 회원 잠금
                Database::one('SELECT session_id FROM user_sessions WHERE session_id=? FOR UPDATE', [(int) $guest['user_session_id']]); // 폐기와 직렬화
            } // 회원 잠금 끝
            Database::one('SELECT session_id FROM guest_sessions WHERE session_id=? FOR UPDATE', [(int) $guest['session_id']]); // 게스트 수명 잠금
            $member = Database::one('SELECT role FROM project_members WHERE project_id=? AND guest_id=? FOR UPDATE', [$projectId, (int) $guest['guest_id']]); // 역할 변경 잠금
            $current = Auth::requireGuest($request); // 잠금 후 실제 결합 확인
            if ($current['session_id'] !== $guest['session_id'] || $member === null || Auth::rank($member['role']) < Auth::rank($minimumRole)) // 신원과 역할 재검사
            { // 변경 차단
                throw new ApiException(403, 'FORBIDDEN', '가져오기 권한을 다시 확인하세요.'); // 접근 상실
            } // 변경 차단 끝
            $result = $operation($current, $pdo); // 서버 소유 변경
            Auth::requireGuest($request); // 긴 처리 중 만료도 차단
            $pdo->commit(); return $result; // 전체 확정
        } // 트랜잭션 본문 끝
        catch (Throwable $error) // 전체 실패
        { // 롤백 시작
            if ($pdo->inTransaction()) // 활성 변경
            { // 변경 취소
                $pdo->rollBack(); // 부분 저장 금지
            } // 변경 취소 끝
            if ($error instanceof PDOException && in_array((int) ($error->errorInfo[1] ?? 0), [1205, 1213], true)) // 잠금 경합
            { // 재시도 안내
                throw new ApiException(409, 'IMPORT_CONFLICT', '다른 작업이 진행 중입니다. 잠시 후 현재 요청을 다시 시도하세요.'); // 실제 가능한 복구
            } // 재시도 안내 끝
            throw $error; // 기존 오류 계약
        } // 롤백 끝
    } // 변경 끝
} // 접근 끝
