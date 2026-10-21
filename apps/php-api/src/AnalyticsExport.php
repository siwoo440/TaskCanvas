<?php // 분석 CSV 내보내기
declare(strict_types=1); // 엄격한 자료형
final class AnalyticsExport // 화면과 같은 전체 자료
{ // 서비스 시작
    private static function safeCell(?string $value): ?string // 스프레드시트 수식 차단
    { // 셀 검사 시작
        if ($value === null) // 빈 셀
        { // 빈 값 유지
            return null; // NULL 보존
        } // 빈 값 끝
        return preg_match('/\A[=+\-@]/u', ltrim($value)) === 1 ? "'" . $value : $value; // 수식 기호 이스케이프
    } // 셀 검사 끝
    public static function download(int $projectId, array $query): void // CSV 응답
    { // 다운로드 시작
        $data = AnalyticsDashboard::allRows($projectId, $query); // 공통 필터 원본
        $stream = fopen('php://temp/maxmemory:2097152', 'w+'); // 2MiB 초과 시 임시 디스크 사용
        if ($stream === false) // 스트림 실패
        { // 오류 처리
            throw new RuntimeException('CSV 스트림을 열 수 없습니다.'); // 생성 실패
        } // 오류 처리 끝
        $pdo = Database::pdo(); // 같은 연결
        try // 일관된 CSV 생성
        { // 생성 시작
            $pdo->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); // 스냅샷 격리
            $pdo->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'); // 동시 변경과 분리
            fwrite($stream, "\xEF\xBB\xBF"); // 엑셀용 UTF-8 BOM
            fputcsv($stream, ['업무 ID', '업무명', '상태', '담당자', '마감일', '생성일', '체크리스트 완료', '체크리스트 전체', '보드 ID'], ',', '"', ''); // 표준 열 제목
            foreach ($data['rows'] as $row) // 최대 500개씩 조회
            { // 행 출력
                $written = fputcsv($stream, [$row['task_id'], self::safeCell($row['title']), self::safeCell($row['status']), self::safeCell($row['assignee_name'] ?? '미배정'), $row['due_at'], $row['created_at'], $row['checklist']['done'], $row['checklist']['total'], $row['board_id']], ',', '"', ''); // 수식 방어와 표준 인코딩
                if ($written === false) // 임시 디스크 쓰기 실패
                { // 생성 중단
                    throw new RuntimeException('CSV 저장 공간이 부족합니다.'); // 잘못된 다운로드 차단
                } // 생성 중단 끝
            } // 행 출력 끝
            $pdo->commit(); // 읽기 잠금 해제
            rewind($stream); // 출력 시작점
            header('Content-Type: text/csv; charset=utf-8'); // CSV 자료형
            header('Content-Disposition: attachment; filename="taskcanvas-project-' . $projectId . '-analytics.csv"'); // 안전한 파일명
            header('Cache-Control: no-store'); // 최신 자료
            fpassthru($stream); // 전체 문자열 복사 없는 출력
        } // 생성 끝
        finally // 자원 정리
        { // 정리 시작
            if ($pdo->inTransaction()) // 실패한 읽기
            { // 읽기 해제
                $pdo->rollBack(); // 스냅샷 종료
            } // 읽기 해제 끝
            fclose($stream); // 메모리와 임시 파일 해제
        } // 정리 끝
    } // 다운로드 끝
} // 서비스 끝
