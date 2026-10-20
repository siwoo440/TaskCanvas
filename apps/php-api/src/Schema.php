<?php
// DB 스키마 보정: 예전에 만든 DB 에 나중에 더한 표와 바뀐 컬럼이 반영되어 있는지 확인하고 아니면 고친다(데이터는 지우지 않음)
declare(strict_types=1);

final class Schema
{
    private const ADDED_TABLES = [
        ['import_datasets', 'CREATE TABLE IF NOT EXISTS import_datasets ( -- 확정 데이터셋
    dataset_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 데이터셋 ID
    project_id BIGINT UNSIGNED NOT NULL, -- 작업실 범위
    name VARCHAR(120) NOT NULL, -- 표시 이름
    schema_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, -- 순서 있는 필드 정의
    key_column VARCHAR(8) NULL, -- 단일 키 필드
    version BIGINT UNSIGNED NOT NULL DEFAULT 1, -- 동시 갱신 버전
    row_count INT UNSIGNED NOT NULL DEFAULT 0, -- 확정 행 수
    created_by BIGINT UNSIGNED NULL, -- 생성 게스트
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 생성 시각
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 갱신 시각
    KEY idx_import_dataset_project (project_id,dataset_id), -- 작업실 목록
    CONSTRAINT fk_import_dataset_project FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE, -- 작업실 정리
    CONSTRAINT fk_import_dataset_creator FOREIGN KEY (created_by) REFERENCES guests(guest_id) ON DELETE SET NULL, -- 기록 보존
    CONSTRAINT ck_import_dataset_schema CHECK (JSON_VALID(schema_json)) -- 올바른 스키마 JSON
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'], // 파일 가져오기 표 추가
        ['import_rows', 'CREATE TABLE IF NOT EXISTS import_rows ( -- 확정 원본 행
    row_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 안정적인 행 ID
    dataset_id BIGINT UNSIGNED NOT NULL, -- 부모 데이터셋
    source_row INT UNSIGNED NOT NULL, -- 파일 내 데이터 행 번호
    key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL, -- 정규 키 해시
    key_value TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL, -- 충돌 확인 원문 키
    values_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, -- 스키마 순서의 값
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 최초 저장
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 최종 갱신
    UNIQUE KEY uq_import_row_key (dataset_id,key_hash), -- 키 없는 행은 별도 허용
    KEY idx_import_row_dataset (dataset_id,row_id), -- 안정적인 페이지
    CONSTRAINT fk_import_row_dataset FOREIGN KEY (dataset_id) REFERENCES import_datasets(dataset_id) ON DELETE CASCADE, -- 데이터셋 정리
    CONSTRAINT ck_import_row_values CHECK (JSON_VALID(values_json)) -- 유효한 값 JSON
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'], // 파일 가져오기 표 추가
        ['import_drafts', 'CREATE TABLE IF NOT EXISTS import_drafts ( -- 세션 소유 임시 원본
    draft_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, -- 공개 토큰의 해시
    project_id BIGINT UNSIGNED NOT NULL, -- 작업실 범위
    guest_session_id BIGINT UNSIGNED NOT NULL, -- 업로드 세션
    original_name VARCHAR(255) NOT NULL, -- 안전한 파일 이름
    format VARCHAR(8) NOT NULL, -- csv 또는 json
    encoding VARCHAR(16) NOT NULL DEFAULT \'UTF-8\', -- 명시적 인코딩
    json_path VARCHAR(1024) NULL, -- 선택 배열 경로
    size_bytes INT UNSIGNED NOT NULL, -- 원본 크기
    source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- 복원 무결성
    config_json LONGTEXT NULL, -- 서버 검증 설정
    validation_revision INT UNSIGNED NOT NULL DEFAULT 0, -- 검증 세대
    target_version BIGINT UNSIGNED NULL, -- 검증한 데이터 버전
    report_json LONGTEXT NULL, -- 제한된 오류 보고
    result_json LONGTEXT NULL, -- 반복 저장 응답
    status VARCHAR(16) NOT NULL DEFAULT \'uploaded\', -- uploaded 또는 consumed
    expires_at DATETIME NOT NULL, -- 접근 만료
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 업로드 시각
    KEY idx_import_draft_session (guest_session_id,status,expires_at), -- 세션별 한도
    KEY idx_import_draft_project (project_id,status,expires_at), -- 작업실별 한도
    CONSTRAINT fk_import_draft_project FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE, -- 작업실 정리
    CONSTRAINT fk_import_draft_session FOREIGN KEY (guest_session_id) REFERENCES guest_sessions(session_id) ON DELETE CASCADE -- 세션 정리
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'], // 파일 가져오기 표 추가
        ['import_draft_chunks', 'CREATE TABLE IF NOT EXISTS import_draft_chunks ( -- 작은 패킷의 원본 조각
    draft_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- 부모 초안
    chunk_no INT UNSIGNED NOT NULL, -- 0부터 시작하는 순서
    data MEDIUMBLOB NOT NULL, -- 최대 64KiB 조각
    PRIMARY KEY (draft_hash,chunk_no), -- 순서별 중복 방지
    CONSTRAINT fk_import_chunk_draft FOREIGN KEY (draft_hash) REFERENCES import_drafts(draft_hash) ON DELETE CASCADE -- 초안과 함께 정리
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'], // 파일 가져오기 표 추가
        ['import_runs', 'CREATE TABLE IF NOT EXISTS import_runs ( -- 검증과 저장 이력
    run_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 이력 ID
    project_id BIGINT UNSIGNED NOT NULL, -- 작업실 범위
    dataset_id BIGINT UNSIGNED NULL, -- 저장 전에는 미지정
    actor_id BIGINT UNSIGNED NULL, -- 실행 게스트
    draft_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- 세션 만료 후에도 이력 유지
    validation_revision INT UNSIGNED NOT NULL, -- 검증 세대
    file_name VARCHAR(255) NOT NULL, -- 출처 파일
    source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- 원본 식별
    status VARCHAR(20) NOT NULL, -- invalid·validated·failed·success
    received INT UNSIGNED NOT NULL DEFAULT 0, -- 입력 데이터 행
    inserted INT UNSIGNED NOT NULL DEFAULT 0, -- 추가 예정 또는 확정
    updated INT UNSIGNED NOT NULL DEFAULT 0, -- 갱신 예정 또는 확정
    skipped INT UNSIGNED NOT NULL DEFAULT 0, -- 건너뛴 행
    error_count INT UNSIGNED NOT NULL DEFAULT 0, -- 전체 오류 수
    report_json LONGTEXT NULL, -- 원문 값 없는 보고
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 검증 시각
    finished_at DATETIME NULL, -- 저장 종료 시각
    UNIQUE KEY uq_import_run_revision (draft_hash,validation_revision), -- 검증당 이력 하나
    KEY idx_import_run_project (project_id,run_id), -- 작업실 이력
    KEY idx_import_run_dataset (dataset_id,run_id), -- 데이터셋 이력
    CONSTRAINT fk_import_run_project FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE, -- 작업실 정리
    CONSTRAINT fk_import_run_dataset FOREIGN KEY (dataset_id) REFERENCES import_datasets(dataset_id) ON DELETE CASCADE, -- 데이터셋 정리
    CONSTRAINT fk_import_run_actor FOREIGN KEY (actor_id) REFERENCES guests(guest_id) ON DELETE SET NULL -- 실행자 기록 보존
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'], // 파일 가져오기 표 추가
        ['import_quality_reports', 'CREATE TABLE IF NOT EXISTS import_quality_reports ( -- 불변 품질 보고서
    run_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, -- 부모 검사 이력
    format_version INT UNSIGNED NOT NULL DEFAULT 1, -- 보고서 형식 버전
    metadata_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, -- 원문 없는 검사 조건
    summary_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, -- 행·컬럼 집계
    expected_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, -- 저장 예상 수치
    actual_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL, -- 성공 때만 확정 수치
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 검사 시각
    CONSTRAINT fk_quality_report_run FOREIGN KEY (run_id) REFERENCES import_runs(run_id) ON DELETE CASCADE, -- 부모 수명
    CONSTRAINT ck_quality_metadata CHECK (JSON_VALID(metadata_json)), -- 조건 JSON 검사
    CONSTRAINT ck_quality_summary CHECK (JSON_VALID(summary_json)), -- 요약 JSON 검사
    CONSTRAINT ck_quality_expected CHECK (JSON_VALID(expected_json)), -- 예상 JSON 검사
    CONSTRAINT ck_quality_actual CHECK (actual_json IS NULL OR JSON_VALID(actual_json)) -- 확정 JSON 검사
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'], // 품질 표 추가
        ['import_quality_rows', 'CREATE TABLE IF NOT EXISTS import_quality_rows ( -- 문제 행별 작은 기록
    run_id BIGINT UNSIGNED NOT NULL, -- 보고서 ID
    source_row INT UNSIGNED NOT NULL, -- 원본 데이터 행 번호
    issues_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, -- 값 없는 압축 문제 목록
    PRIMARY KEY (run_id,source_row), -- 보고서 안의 고정 순서
    CONSTRAINT fk_quality_row_report FOREIGN KEY (run_id) REFERENCES import_quality_reports(run_id) ON DELETE CASCADE, -- 보고서 수명
    CONSTRAINT ck_quality_issues CHECK (JSON_VALID(issues_json)) -- 문제 JSON 검사
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'], // 문제 행 표 추가
        ['users', 'CREATE TABLE IF NOT EXISTS users ( -- 회원 데이터 기반
            user_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 회원 고유 ID
            login_id VARCHAR(120) NOT NULL, -- 로그인 ID
            display_name VARCHAR(60) NOT NULL, -- 회원 표시 이름
            password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- 비밀번호 해시
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 회원 생성 시각
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, -- 회원 변경 시각
            UNIQUE KEY uq_users_login_id (login_id) -- 로그인 ID 중복 방지
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'], // 회원 테이블 추가
        ['user_sessions', 'CREATE TABLE IF NOT EXISTS user_sessions ( -- 회원 세션 데이터 기반
            session_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 세션 행 ID
            user_id BIGINT UNSIGNED NOT NULL, -- 연결 회원 ID
            token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- 세션 토큰 해시
            expires_at DATETIME NOT NULL, -- 세션 만료 시각
            revoked_at DATETIME NULL, -- 세션 폐기 시각
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 발급 시각
            UNIQUE KEY uq_user_sessions_token (token_hash), -- 토큰 해시 중복 방지
            KEY idx_user_sessions_user_expiry (user_id, expires_at), -- 회원별 세션과 만료 조회
            CONSTRAINT fk_user_session_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE -- 회원 삭제 시 세션 정리
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'], // 회원 세션 테이블 추가
        ['guest_user_links', 'CREATE TABLE IF NOT EXISTS guest_user_links ( -- 기존 게스트 연결
            guest_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, -- 게스트당 회원 한 명
            user_id BIGINT UNSIGNED NOT NULL, -- 연결 회원 ID
            linked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 소유 확인 후 연결 시각
            KEY idx_guest_user_links_user (user_id), -- 회원별 여러 게스트 조회
            CONSTRAINT fk_guest_user_link_guest FOREIGN KEY (guest_id) REFERENCES guests (guest_id) ON DELETE CASCADE, -- 게스트 삭제 시 연결 정리
            CONSTRAINT fk_guest_user_link_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT -- 연결 해제 없는 회원 삭제 차단
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'], // 게스트 연결 테이블 추가
        ['task_items', 'CREATE TABLE IF NOT EXISTS task_items (
            item_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            task_id BIGINT UNSIGNED NOT NULL,
            title VARCHAR(120) NOT NULL,
            is_done TINYINT(1) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_item_task (task_id, item_id),
            CONSTRAINT fk_item_task FOREIGN KEY (task_id) REFERENCES tasks (task_id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'],
    ]; // [테이블, 생성 문장] — database/schema.sql 에 표를 더할 때 여기에도 같은 정의를 적는다

    private const ADDED_COLUMNS = [
        ['guest_sessions', 'user_session_id', 'ALTER TABLE guest_sessions ADD COLUMN user_session_id BIGINT UNSIGNED NULL AFTER created_at, ADD CONSTRAINT fk_guest_session_user_session FOREIGN KEY (user_session_id) REFERENCES user_sessions (session_id) ON DELETE CASCADE'], // 회원 세션 결합
        ['realtime_tickets', 'guest_session_id', 'ALTER TABLE realtime_tickets ADD COLUMN guest_session_id BIGINT UNSIGNED NULL AFTER created_at, ADD CONSTRAINT fk_ticket_session FOREIGN KEY (guest_session_id) REFERENCES guest_sessions (session_id) ON DELETE CASCADE'], // 발급 세션 결합
        ['project_invites', 'max_uses', 'ALTER TABLE project_invites ADD COLUMN max_uses INT UNSIGNED NULL AFTER role'],
        ['project_invites', 'used_count', 'ALTER TABLE project_invites ADD COLUMN used_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER max_uses'],
        ['realtime_tickets', 'project_id', 'ALTER TABLE realtime_tickets ADD COLUMN project_id BIGINT UNSIGNED NULL AFTER board_id, ADD CONSTRAINT fk_ticket_project FOREIGN KEY (project_id) REFERENCES projects (project_id) ON DELETE CASCADE'],
    ]; // [테이블, 컬럼, 추가 문장] — database/schema.sql 에 컬럼을 더할 때 여기에도 적는다

    private const NULLABLE_COLUMNS = [
        ['realtime_tickets', 'board_id', 'ALTER TABLE realtime_tickets MODIFY board_id BIGINT UNSIGNED NULL'],
    ]; // [테이블, 컬럼, 변경 문장] — 처음에는 NOT NULL 이었다가 나중에 NULL 을 허용하게 된 컬럼

    // 나중에 더한 표의 이름들(이 표들은 보정으로 만들 수 있으므로 "스키마 미적용"으로 보지 않는다)
    public static function tableNames(): array
    {
        return array_column(self::ADDED_TABLES, 0); // 표 이름 목록
    }

    // 아직 반영되지 않은 변경 목록(표는 "테이블(표)", 컬럼은 "테이블.컬럼", NULL 허용 변경은 뒤에 표시를 붙임)
    public static function missing(): array
    {
        $missing = []; // 반영되지 않은 변경
        foreach (self::ADDED_TABLES as [$table])
        {
            if (!self::table($table))
            {
                $missing[] = $table . '(표)'; // 만들어야 하는 표
            }
        }
        foreach (self::ADDED_COLUMNS as [$table, $column])
        {
            if (self::column($table, $column) === null)
            {
                $missing[] = $table . '.' . $column; // 추가가 필요한 컬럼
            }
        }
        foreach (self::NULLABLE_COLUMNS as [$table, $column])
        {
            $found = self::column($table, $column); // 현재 컬럼 정보
            if ($found !== null && $found['is_nullable'] !== 'YES')
            {
                $missing[] = $table . '.' . $column . '(NULL 허용)'; // NULL 허용으로 바꿔야 하는 컬럼
            }
        }
        return $missing; // 반영되지 않은 변경 목록
    }

    // 반영되지 않은 변경을 적용하고, 적용한 목록을 돌려준다. 이미 다 되어 있으면 아무것도 하지 않는다
    public static function upgrade(): array
    {
        $applied = []; // 적용한 변경
        foreach (self::ADDED_TABLES as [$table, $sql])
        {
            if (!self::table($table))
            {
                Database::pdo()->exec($sql); // 표 생성(기존 표와 데이터는 그대로)
                $applied[] = $table . '(표)'; // 적용 기록
            }
        }
        foreach (self::ADDED_COLUMNS as [$table, $column, $sql])
        {
            if (self::column($table, $column) === null)
            {
                Database::pdo()->exec($sql); // 컬럼 추가(기존 행은 기본값으로 채워짐)
                $applied[] = $table . '.' . $column; // 적용 기록
            }
        }
        foreach (self::NULLABLE_COLUMNS as [$table, $column, $sql])
        {
            $found = self::column($table, $column); // 현재 컬럼 정보
            if ($found !== null && $found['is_nullable'] !== 'YES')
            {
                Database::pdo()->exec($sql); // NULL 허용으로 변경(기존 값은 그대로)
                $applied[] = $table . '.' . $column . '(NULL 허용)'; // 적용 기록
            }
        }
        return $applied; // 적용한 변경 목록
    }

    // 표가 있는지
    private static function table(string $table): bool
    {
        return Database::one(
            'SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
            [$table]
        ) !== null; // 표 존재 여부
    }

    // 컬럼 정보(없으면 null)
    private static function column(string $table, string $column): ?array
    {
        return Database::one(
            'SELECT is_nullable FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
            [$table, $column]
        ); // 컬럼 존재와 NULL 허용 여부
    }
}
