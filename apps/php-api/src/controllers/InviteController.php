<?php
// 관리자용 초대 코드 목록·발급·취소
declare(strict_types=1);

final class InviteController
{
    public function list(Request $request): void
    {
        $guest = Auth::requireGuest($request); // 현재 게스트
        $projectId = $request->params['id']; // 프로젝트 ID
        Auth::requireRole((int) $guest['guest_id'], $projectId, 'admin'); // 관리자 확인
        Response::ok(['project_id' => $projectId, 'invites' => array_map([Invite::class, 'format'], Invite::listForProject($projectId))]); // 목록 응답(코드 원문·해시 없음)
    }

    public function create(Request $request): void
    {
        Auth::requireMutationHeader($request); // CSRF 헤더 검사
        $guest = Auth::requireGuest($request); // 현재 게스트
        $projectId = $request->params['id']; // 프로젝트 ID
        Auth::requireRole((int) $guest['guest_id'], $projectId, 'admin'); // 관리자 확인
        $role = $request->string('role', 20) ?: 'editor'; // 부여 역할(기본 편집자)
        $days = $request->json()['days'] ?? 7; // 유효 일수(기본 7일)
        if (!is_int($days) && !(is_string($days) && ctype_digit($days)))
        {
            throw new ApiException(400, 'BAD_REQUEST', 'days 값은 정수여야 합니다.'); // 타입 검사
        }
        $maxUses = $request->json()['max_uses'] ?? null; // 인원 제한(없거나 null 이면 제한 없음)
        if ($maxUses !== null && !is_int($maxUses) && !(is_string($maxUses) && ctype_digit($maxUses)))
        {
            throw new ApiException(400, 'BAD_REQUEST', 'max_uses 값은 정수이거나 비워 두어야 합니다.'); // 타입 검사
        }
        $issued = Invite::issue($projectId, $role, (int) $days, $maxUses === null ? null : (int) $maxUses); // 발급(역할·기간·인원 검사 포함)
        Response::ok([
            'invite' => Invite::format(Invite::find($issued['invite_id'])),
            'code' => $issued['code'],
        ], 201); // 코드 원문은 이 응답에서만 한 번 전달
    }

    public function revoke(Request $request): void
    {
        Auth::requireMutationHeader($request); // CSRF 헤더 검사
        $guest = Auth::requireGuest($request); // 현재 게스트
        $invite = Invite::find($request->params['id']); // 대상 초대
        if ($invite === null)
        {
            throw new ApiException(404, 'NOT_FOUND', '초대 코드를 찾을 수 없습니다.'); // 없음
        }
        Auth::requireRole((int) $guest['guest_id'], (int) $invite['project_id'], 'admin'); // 해당 프로젝트 관리자 확인
        Database::run('UPDATE project_invites SET revoked_at = NOW() WHERE invite_id = ? AND revoked_at IS NULL', [(int) $invite['invite_id']]); // 취소 처리(이미 취소면 유지)
        Response::ok(['invite' => Invite::format(Invite::find((int) $invite['invite_id']))]); // 취소 결과
    }
}
