<?php
// DB 스키마 보정: 예전에 만든 DB 에 나중에 더한 표와 바뀐 컬럼이 반영되어 있는지 확인하고 아니면 고친다(데이터는 지우지 않음)
declare(strict_types=1);

final class Schema
{
    private const ADDED_TABLES = [
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
