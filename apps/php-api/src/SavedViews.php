<?php // 회원별 분석 저장 보기
declare(strict_types=1); // 엄격한 자료형
final class SavedViews // 개인 필터 저장
{ // 서비스 시작
    private static function format(array $row): array // 공개 자료형
    { // 응답 구성
        return ['view_id' => (int) $row['view_id'], 'name' => $row['name'], 'filters' => json_decode($row['filters_json'], true, 512, JSON_THROW_ON_ERROR), 'is_default' => (bool) $row['is_default'], 'version' => (int) $row['version']]; // 개인 보기 계약
    } // 응답 구성 끝
    public static function list(array $user, int $projectId): array // 본인 보기 목록
    { // 조회 시작
        MemberScope::role((int) $user['user_id'], $projectId); // 최신 작업실 권한
        return array_map([self::class, 'format'], Database::all('SELECT * FROM dashboard_views WHERE user_id=? AND project_id=? ORDER BY is_default DESC,view_id', [(int) $user['user_id'], $projectId])); // 소유자 조건
    } // 조회 끝
    public static function save(array $user, int $projectId, array $body): array // 생성·수정
    { // 입력 검사
        $name = $body['name'] ?? null; $input = $body['filters'] ?? null; // 이름과 조건
        $id = $body['view_id'] ?? 0; $version = $body['version'] ?? 0; $default = $body['is_default'] ?? false; // 수정 계약
        if (!is_string($name) || trim($name) === '' || mb_strlen(trim($name)) > 60 || !is_array($input) || !is_int($id) || $id < 0 || !is_int($version) || $version < 0 || !is_bool($default)) // 형식 경계
        { // 입력 거부
            throw new ApiException(400, 'BAD_REQUEST', '보기 이름·필터·버전을 확인하세요.'); // 필드 안내
        } // 입력 거부 끝
        $query = array_filter($input, static fn ($value) => $value !== null); // 전체 조건 제거
        $query = array_map(static fn ($value) => is_int($value) ? (string) $value : $value, $query); // 담당자 ID 정규화
        $filters = AnalyticsFilters::parse($query); // 기존 필터 검증
        if ($filters['created_from'] === null || $filters['created_to'] === null || (new DateTimeImmutable($filters['created_from']))->diff(new DateTimeImmutable($filters['created_to']))->days >= 366) // 실제 적용 기간
        { // 기간 거부
            throw new ApiException(400, 'INVALID_FILTER', '저장 보기는 시작일·종료일이 있는 최대 366일 조건이어야 합니다.'); // 범위 안내
        } // 기간 거부 끝
        return MemberScope::transaction($user, $projectId, static function () use ($user, $projectId, $name, $filters, $id, $version, $default): array // 원자적 개인 설정
        { // 변경 본문
            $userId = (int) $user['user_id']; MemberScope::role($userId, $projectId); // 잠금 뒤 권한 확인
            $existing = $id === 0 ? null : Database::one('SELECT * FROM dashboard_views WHERE view_id=? AND user_id=? AND project_id=?', [$id, $userId, $projectId]); // 본인 보기만
            if ($id > 0 && $existing === null) // 타 회원·없는 ID
            { // 대상 거부
                throw new ApiException(404, 'NOT_FOUND', '저장 보기를 찾을 수 없습니다.'); // 소유자 정보 은닉
            } // 대상 거부 끝
            if ($existing !== null && (int) $existing['version'] !== $version) // 오래된 수정
            { // 충돌 거부
                throw new ApiException(409, 'VERSION_CONFLICT', '다른 창에서 변경된 보기입니다. 다시 불러오세요.'); // 재조회 안내
            } // 충돌 거부 끝
            if ($id === 0 && count(self::list($user, $projectId)) >= 20) // 개인 자료 상한
            { // 한도 거부
                throw new ApiException(409, 'VIEW_LIMIT', '작업실별 저장 보기는 20개까지 가능합니다.'); // 한도 안내
            } // 한도 검사 끝
            if (Database::one('SELECT view_id FROM dashboard_views WHERE user_id=? AND project_id=? AND name=? AND view_id<>?', [$userId, $projectId, trim($name), $id]) !== null) // 중복 이름
            { // 중복 거부
                throw new ApiException(409, 'NAME_IN_USE', '같은 이름의 저장 보기가 있습니다.'); // 이름 안내
            } // 중복 거부 끝
            if ($default) // 기본값 선택
            { // 이전 기본 해제
                Database::run('UPDATE dashboard_views SET is_default=0,version=version+1 WHERE user_id=? AND project_id=? AND is_default=1 AND view_id<>?', [$userId, $projectId, $id]); // 이전 버전도 갱신
            } // 기본값 해제 끝
            $json = json_encode($filters, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR); // 검증한 조건
            if ($id === 0) // 신규 보기
            { // 신규 저장
                Database::run('INSERT INTO dashboard_views (user_id,project_id,name,filters_json,is_default) VALUES (?,?,?,?,?)', [$userId, $projectId, trim($name), $json, (int) $default]); // 소유 정보는 서버 지정
                return self::format(Database::one('SELECT * FROM dashboard_views WHERE view_id=?', [Database::lastId()])); // 생성 결과
            } // 신규 저장 끝
            Database::run('UPDATE dashboard_views SET name=?,filters_json=?,is_default=?,version=version+1 WHERE view_id=?', [trim($name), $json, (int) $default, $id]); // 본인 보기 수정
            return self::format(Database::one('SELECT * FROM dashboard_views WHERE view_id=?', [$id])); // 수정 결과
        }); // 원자적 설정 끝
    } // 저장 끝
    public static function delete(array $user, int $projectId, int $id, int $version): void // 본인 보기 삭제
    { // 삭제 시작
        MemberScope::transaction($user, $projectId, static function () use ($user, $projectId, $id, $version): void // 원자적 삭제
        { // 삭제 본문
            MemberScope::role((int) $user['user_id'], $projectId); // 최신 권한
            $row = Database::one('SELECT version FROM dashboard_views WHERE view_id=? AND user_id=? AND project_id=?', [$id, (int) $user['user_id'], $projectId]); // 본인만
            if ($row === null) // 없는 보기
            { // 대상 거부
                throw new ApiException(404, 'NOT_FOUND', '저장 보기를 찾을 수 없습니다.'); // 안전한 안내
            } // 대상 거부 끝
            if ((int) $row['version'] !== $version) // 오래된 삭제
            { // 충돌 거부
                throw new ApiException(409, 'VERSION_CONFLICT', '변경된 보기입니다. 다시 불러오세요.'); // 재조회 안내
            } // 충돌 거부 끝
            Database::run('DELETE FROM dashboard_views WHERE view_id=?', [$id]); // 소유 검증 후 삭제
        }); // 원자적 삭제 끝
    } // 삭제 끝
} // 서비스 끝
