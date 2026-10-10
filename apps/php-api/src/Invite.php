<?php
// 초대 코드 생성·발급 (CLI 와 관리자 API 가 함께 사용)
declare(strict_types=1);

final class Invite
{
    public const MAX_DAYS = 30; // 최대 유효 일수
    public const MAX_USES = 100; // 인원 제한으로 정할 수 있는 최댓값
    private const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 혼동 문자(0·O·1·I)를 뺀 코드 문자 집합

    public static function generateCode(): string
    {
        $code = ''; // 초대 코드 원문
        for ($i = 0; $i < 12; $i++)
        {
            $code .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)]; // 암호학적 난수로 문자 선택
            if ($i === 3 || $i === 7)
            {
                $code .= '-'; // 4자 단위 구분
            }
        }
        return $code; // XXXX-XXXX-XXXX 형식
    }

    public static function issue(int $projectId, string $role, int $days, ?int $maxUses = null): array
    {
        if (!in_array($role, Auth::ROLES, true))
        {
            throw new ApiException(400, 'BAD_REQUEST', '역할은 admin·editor·viewer 중 하나여야 합니다.'); // 역할 검사
        }
        if ($days < 1 || $days > self::MAX_DAYS)
        {
            throw new ApiException(400, 'BAD_REQUEST', '유효 기간은 1~' . self::MAX_DAYS . '일이어야 합니다.'); // 기간 검사
        }
        if ($maxUses !== null && ($maxUses < 1 || $maxUses > self::MAX_USES))
        {
            throw new ApiException(400, 'BAD_REQUEST', '인원 제한은 1~' . self::MAX_USES . '명이어야 합니다(비우면 제한 없음).'); // 인원 제한 검사
        }
        $code = self::generateCode(); // 코드 원문(응답·출력에 한 번만 사용)
        Database::run(
            'INSERT INTO project_invites (project_id, code_hash, role, max_uses, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))',
            [$projectId, Auth::hash($code), $role, $maxUses, $days]
        ); // 해시만 저장
        return ['invite_id' => Database::lastId(), 'code' => $code]; // 발급 결과
    }

    public static function find(int $inviteId): ?array
    {
        return Database::one(
            'SELECT invite_id, project_id, role, max_uses, used_count, expires_at, revoked_at, created_at, (expires_at <= NOW()) AS expired FROM project_invites WHERE invite_id = ?',
            [$inviteId]
        ); // 초대 한 건 조회(코드 해시는 반환하지 않음)
    }

    public static function listForProject(int $projectId): array
    {
        return Database::all(
            'SELECT invite_id, project_id, role, max_uses, used_count, expires_at, revoked_at, created_at, (expires_at <= NOW()) AS expired FROM project_invites WHERE project_id = ? ORDER BY invite_id DESC',
            [$projectId]
        ); // 프로젝트의 초대 목록
    }

    public static function format(array $row): array
    {
        $maxUses = $row['max_uses'] === null ? null : (int) $row['max_uses']; // 인원 제한(없으면 null)
        $usedCount = (int) $row['used_count']; // 이 코드로 새로 입장한 인원
        $full = $maxUses !== null && $usedCount >= $maxUses; // 인원이 다 참
        $status = $row['revoked_at'] !== null ? 'revoked' : ((int) $row['expired'] === 1 ? 'expired' : ($full ? 'exhausted' : 'active')); // 취소 > 만료 > 인원 마감 > 사용 가능
        return [
            'invite_id' => (int) $row['invite_id'],
            'role' => $row['role'],
            'max_uses' => $maxUses,
            'used_count' => $usedCount,
            'expires_at' => $row['expires_at'],
            'revoked_at' => $row['revoked_at'],
            'created_at' => $row['created_at'],
            'status' => $status,
        ]; // 응답 형식
    }
}
