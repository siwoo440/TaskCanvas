<?php // 회원 기반 참여자 관리
declare(strict_types=1); // 엄격한 자료형
final class MemberManagement // 관리자 무결성 보호
{ // 서비스 시작
    public static function list(array $user, int $projectId): array // 관리용 참여자 목록
    { // 조회 시작
        MemberScope::role((int) $user['user_id'], $projectId, 'admin'); // 회원 관리자만
        $rows = Database::all('SELECT m.guest_id,m.role,g.display_name,l.user_id,u.display_name AS user_display_name FROM project_members m JOIN guests g ON g.guest_id=m.guest_id LEFT JOIN guest_user_links l ON l.guest_id=m.guest_id LEFT JOIN users u ON u.user_id=l.user_id WHERE m.project_id=? ORDER BY m.guest_id', [$projectId]); // 계정 비밀 제외
        foreach ($rows as &$row) // 공개 자료형
        { // ID 정규화
            $row['guest_id'] = (int) $row['guest_id']; $row['user_id'] = $row['user_id'] === null ? null : (int) $row['user_id']; // 회원·게스트 구분
        } // ID 정규화 끝
        unset($row); return $rows; // 안전한 목록
    } // 조회 끝
    public static function change(array $user, int $projectId, int $targetId, ?string $role, string $confirmName = ''): void // 역할 변경·내보내기
    { // 변경 시작
        if ($targetId < 1 || ($role !== null && !in_array($role, Auth::ROLES, true))) // 허용 역할·대상
        { // 입력 거부
            throw new ApiException(400, 'BAD_REQUEST', '대상과 역할을 확인하세요.'); // 입력 안내
        } // 입력 검사 끝
        MemberScope::transaction($user, $projectId, static function () use ($user, $projectId, $targetId, $role, $confirmName): void // 작업실 전체 변경 직렬화
        { // 변경 본문
            MemberScope::role((int) $user['user_id'], $projectId, 'admin'); // 대기 뒤 최신 관리자
            $members = Database::all('SELECT m.guest_id,m.role,g.display_name,l.user_id FROM project_members m JOIN guests g ON g.guest_id=m.guest_id LEFT JOIN guest_user_links l ON l.guest_id=m.guest_id WHERE m.project_id=? FOR UPDATE', [$projectId]); // 전체 역할 행 잠금
            $target = null; // 대상 참여자
            foreach ($members as $member) // 대상 식별
            { // ID 확인
                if ((int) $member['guest_id'] === $targetId) // 같은 작업실 대상
                { // 대상 선택
                    $target = $member; // 소유와 표시 이름
                } // 대상 선택 끝
            } // 대상 식별 끝
            if ($target === null) // 타 작업실·없는 대상
            { // 대상 거부
                throw new ApiException(404, 'NOT_FOUND', '참여자를 찾을 수 없습니다.'); // 범위 은닉
            } // 대상 거부 끝
            if ($role === null && $confirmName !== $target['display_name']) // 내보내기 실수 방지
            { // 확인 거부
                throw new ApiException(400, 'CONFIRM_MISMATCH', '참여자 이름을 정확히 입력하세요.'); // 확인 안내
            } // 확인 검사 끝
            $ids = []; $remainingAdmins = 0; // 변경 대상과 남는 관리자
            foreach ($members as $member) // 같은 회원의 모든 별칭
            { // 그룹 판별
                $same = $target['user_id'] === null ? (int) $member['guest_id'] === $targetId : (string) $member['user_id'] === (string) $target['user_id']; // 연결 회원 기준
                if ($same) // 변경할 별칭
                { // 그룹 추가
                    $ids[] = (int) $member['guest_id']; // 같은 작업실 범위만
                } // 그룹 추가 끝
                elseif ($member['role'] === 'admin') // 변경 밖 관리자
                { // 관리자 집계
                    $remainingAdmins++; // 보호 대상 수
                } // 관리자 집계 끝
            } // 그룹 판별 끝
            if ($role !== 'admin' && $remainingAdmins === 0) // 마지막 관리자 소멸
            { // 무결성 거부
                throw new ApiException(409, 'LAST_ADMIN', '마지막 관리자는 강등하거나 내보낼 수 없습니다.'); // 복구 가능성 보호
            } // 무결성 검사 끝
            $placeholders = implode(',', array_fill(0, count($ids), '?')); // 안전한 IN 바인딩
            if ($role === null) // 참여 해제
            { // 멤버십 제거
                Database::run('DELETE FROM project_members WHERE project_id=? AND guest_id IN (' . $placeholders . ')', array_merge([$projectId], $ids)); // 연결 이름 전체 회수
            } // 참여 해제 끝
            else // 역할 변경
            { // 역할 저장
                Database::run('UPDATE project_members SET role=? WHERE project_id=? AND guest_id IN (' . $placeholders . ')', array_merge([$role, $projectId], $ids)); // 별칭 최고 역할 우회 차단
            } // 역할 저장 끝
            Database::run('DELETE rt FROM realtime_tickets rt LEFT JOIN boards b ON b.board_id=rt.board_id WHERE (rt.project_id=? OR b.project_id=?) AND rt.guest_id IN (' . $placeholders . ')', array_merge([$projectId, $projectId], $ids)); // 이전 역할의 미사용 티켓 회수
        }); // 원자적 변경 끝
    } // 변경 끝
} // 서비스 끝
