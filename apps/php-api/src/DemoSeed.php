<?php
// 시연용 예시 내용: 빈 보드에 메모·도형·펜 획·연결선·공유 업무 블럭을 채운다 (CLI 전용 도우미)
declare(strict_types=1);

final class DemoSeed
{
    // 프로젝트의 첫 번째 보드(와 있으면 두 번째 보드)에 예시 내용을 넣는다. 결과 요약을 돌려준다
    public static function fill(int $projectId, bool $force = false): array
    {
        $boards = Database::all('SELECT board_id, title FROM boards WHERE project_id = ? ORDER BY board_id', [$projectId]); // 프로젝트 보드
        if ($boards === [])
        {
            throw new RuntimeException("project_id={$projectId} 에 보드가 없습니다."); // 채울 보드 없음
        }
        $main = (int) $boards[0]['board_id']; // 예시를 채울 보드
        $existing = (int) Database::one('SELECT COUNT(*) AS n FROM board_objects WHERE board_id = ?', [$main])['n']; // 이미 있는 객체 수
        if ($existing > 0 && !$force)
        {
            throw new RuntimeException("보드 '{$boards[0]['title']}' 에 이미 객체 {$existing}개가 있습니다. 덮어쓰지 않습니다(--force 로 추가 가능)."); // 중복 방지
        }

        $pdo = Database::pdo(); // 트랜잭션용 연결
        $pdo->beginTransaction(); // 예시는 전부 들어가거나 전부 취소
        try
        {
            // 제목(배경 없는 텍스트)과 밑줄(펜 획)
            self::note($main, 60, 36, 620, 44, 'TaskCanvas 기획 보드 — 웹서버 수업 팀 프로젝트', null, '#111827'); // 제목
            $points = []; // 밑줄 좌표
            for ($i = 0; $i <= 38; $i++)
            {
                $points[] = [62 + $i * 12, 86 + round(sin($i / 2) * 2, 1)]; // 살짝 흔들리는 손그림 선
            }
            self::stroke($main, $points, '#2563eb', 4); // 밑줄

            // 왼쪽: 색이 다른 메모 세 장
            self::note($main, 60, 110, 230, 140, "목표\n· PC 4대가 같은 보드를 동시에 편집\n· 놓는 순간 저장, 새로고침 후 복원", '#fff59d'); // 노란 메모
            self::note($main, 60, 270, 230, 140, "이번 주 할 일\n· 학교 PC 포트·방화벽 확인\n· 2인 펜 동기화 시연", '#bfdbfe'); // 파란 메모
            self::note($main, 60, 430, 230, 120, "아이디어\n· 회의가 끝나면 보드를 PNG 로 저장", '#bbf7d0'); // 초록 메모

            // 위쪽: 사용 흐름 세 단계(연결선으로 이음)와 강조 타원
            $step1 = self::note($main, 340, 110, 200, 76, '① 초대 코드로 입장', '#fde68a'); // 1단계
            $step2 = self::note($main, 600, 110, 200, 76, '② 같은 보드에서 함께 편집', '#fde68a'); // 2단계
            self::shape($main, 'ellipse', 840, 92, 240, 112, '#e53935', null, 3); // 3단계 강조 타원(메모보다 먼저 넣어 아래에 그려짐)
            $step3 = self::note($main, 860, 110, 200, 76, '③ 놓는 순간 서버에 저장', '#fde68a'); // 3단계
            self::link($main, $step1, $step2, '다음'); // 1 → 2
            self::link($main, $step2, $step3, '다음'); // 2 → 3

            // 아래쪽: 공유 업무 영역(테두리 사각형 + 안내 글 + 업무 블럭 세 개)
            self::shape($main, 'rect', 320, 230, 800, 200, '#9ca3af', null, 2); // 영역 테두리
            self::note($main, 500, 236, 460, 40, '공유 업무 — 다른 보드의 같은 블럭과 함께 바뀝니다', null, '#6b7280'); // 안내 글
            $design = self::task($projectId, '로그인 화면 디자인', 'doing', 7); // 진행 중 업무
            $server = self::task($projectId, '실시간 서버 방 구현', 'todo', 10); // 할 일 업무
            $schema = self::task($projectId, 'DB 스키마 검토', 'done', null); // 완료 업무
            $designBlock = self::taskBlock($main, $design, 340, 290); // 업무 블럭 1
            self::taskBlock($main, $server, 600, 290); // 업무 블럭 2
            self::taskBlock($main, $schema, 860, 290); // 업무 블럭 3
            self::link($main, $step1, $designBlock, '관련 업무'); // 흐름 1단계 → 업무

            // 두 번째 보드가 비어 있으면 같은 업무를 한 번 더 놓아 "여러 보드가 공유하는 업무"를 바로 보여 준다
            $second = null; // 두 번째 보드
            if (isset($boards[1]) && (int) Database::one('SELECT COUNT(*) AS n FROM board_objects WHERE board_id = ?', [(int) $boards[1]['board_id']])['n'] === 0)
            {
                $second = (int) $boards[1]['board_id']; // 비어 있는 두 번째 보드
                self::note($second, 60, 40, 420, 100, "이 보드의 '로그인 화면 디자인' 블럭은 첫 번째 보드와 같은 업무입니다.\n상태를 바꾸면 양쪽이 함께 바뀝니다.", '#fff59d'); // 안내 메모
                self::taskBlock($second, $design, 60, 170); // 같은 업무를 참조하는 블럭
            }
            $pdo->commit(); // 확정
        }
        catch (Throwable $e)
        {
            $pdo->rollBack(); // 실패 시 전부 취소
            throw $e;
        }

        return [
            'board_id' => $main,
            'board_title' => $boards[0]['title'],
            'objects' => (int) Database::one('SELECT COUNT(*) AS n FROM board_objects WHERE board_id = ?', [$main])['n'],
            'links' => (int) Database::one('SELECT COUNT(*) AS n FROM board_links WHERE board_id = ?', [$main])['n'],
            'tasks' => (int) Database::one('SELECT COUNT(*) AS n FROM tasks WHERE project_id = ?', [$projectId])['n'],
            'second_board_id' => $second,
        ]; // 채운 내용 요약
    }

    private static function insert(int $boardId, string $type, float $x, float $y, float $width, float $height, array $payload, array $style, ?int $taskId = null): int
    {
        Database::run(
            'INSERT INTO board_objects (board_id, task_id, type, x, y, width, height, payload_json, style_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$boardId, $taskId, $type, $x, $y, $width, $height, json_encode((object) $payload, JSON_UNESCAPED_UNICODE), json_encode((object) $style, JSON_UNESCAPED_UNICODE)]
        ); // 실시간 서버가 저장하는 것과 같은 형식으로 저장
        return Database::lastId(); // 객체 ID
    }

    private static function note(int $boardId, float $x, float $y, float $width, float $height, string $text, ?string $fill, string $color = '#222222'): int
    {
        return self::insert($boardId, 'note', $x, $y, $width, $height, ['text' => $text], ['fill' => $fill, 'color' => $color]); // 메모(배경이 null 이면 텍스트)
    }

    private static function shape(int $boardId, string $type, float $x, float $y, float $width, float $height, string $stroke, ?string $fill, int $lineWidth): int
    {
        return self::insert($boardId, $type, $x, $y, $width, $height, [], ['stroke' => $stroke, 'fill' => $fill, 'width' => $lineWidth]); // 사각형·원
    }

    private static function stroke(int $boardId, array $points, string $color, int $lineWidth): int
    {
        $xs = array_column($points, 0); // X 좌표 목록
        $ys = array_column($points, 1); // Y 좌표 목록
        return self::insert($boardId, 'stroke', min($xs), min($ys), max($xs) - min($xs), max($ys) - min($ys), ['stroke_id' => 'seed-' . bin2hex(random_bytes(4)), 'points' => $points], ['color' => $color, 'width' => $lineWidth]); // 펜 획(경계 사각형 포함)
    }

    private static function task(int $projectId, string $title, string $status, ?int $dueInDays): int
    {
        if ($dueInDays === null)
        {
            Database::run('INSERT INTO tasks (project_id, title, status) VALUES (?, ?, ?)', [$projectId, $title, $status]); // 마감 없는 업무
        }
        else
        {
            Database::run('INSERT INTO tasks (project_id, title, status, due_at) VALUES (?, ?, ?, DATE_ADD(CURDATE(), INTERVAL ? DAY))', [$projectId, $title, $status, $dueInDays]); // 마감 있는 업무
        }
        return Database::lastId(); // 업무 ID
    }

    private static function taskBlock(int $boardId, int $taskId, float $x, float $y): int
    {
        return self::insert($boardId, 'task', $x, $y, 240, 110, [], [], $taskId); // 업무 블럭(내용은 tasks 원본에서 가져옴)
    }

    private static function link(int $boardId, int $from, int $to, string $label): void
    {
        Database::run('INSERT INTO board_links (board_id, from_object_id, to_object_id, label) VALUES (?, ?, ?, ?)', [$boardId, $from, $to, $label]); // 연결선
    }
}
