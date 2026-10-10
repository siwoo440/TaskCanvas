<?php
// DB 스키마 보정: 예전에 만든 DB 에 나중에 추가된 컬럼이 있는지 확인하고 없으면 더한다(데이터는 지우지 않음)
declare(strict_types=1);

final class Schema
{
    private const ADDED_COLUMNS = [
        ['project_invites', 'max_uses', 'ALTER TABLE project_invites ADD COLUMN max_uses INT UNSIGNED NULL AFTER role'],
        ['project_invites', 'used_count', 'ALTER TABLE project_invites ADD COLUMN used_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER max_uses'],
    ]; // [테이블, 컬럼, 추가 문장] — database/schema.sql 에 컬럼을 더할 때 여기에도 적는다

    // 아직 없는 컬럼 목록("테이블.컬럼")
    public static function missing(): array
    {
        $missing = []; // 없는 컬럼
        foreach (self::ADDED_COLUMNS as [$table, $column])
        {
            $found = Database::one(
                'SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
                [$table, $column]
            ); // 컬럼 존재 확인
            if ((int) $found['n'] === 0)
            {
                $missing[] = $table . '.' . $column; // 추가가 필요한 컬럼
            }
        }
        return $missing; // 없는 컬럼 목록
    }

    // 없는 컬럼을 더하고, 더한 컬럼 목록을 돌려준다. 이미 다 있으면 아무것도 하지 않는다
    public static function upgrade(): array
    {
        $missing = self::missing(); // 없는 컬럼
        $applied = []; // 더한 컬럼
        foreach (self::ADDED_COLUMNS as [$table, $column, $sql])
        {
            if (in_array($table . '.' . $column, $missing, true))
            {
                Database::pdo()->exec($sql); // 컬럼 추가(기존 행은 기본값으로 채워짐)
                $applied[] = $table . '.' . $column; // 더한 컬럼 기록
            }
        }
        return $applied; // 더한 컬럼 목록
    }
}
