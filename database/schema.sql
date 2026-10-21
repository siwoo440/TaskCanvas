-- TaskCanvas 초기 데이터베이스 스키마 초안
-- MySQL 8 / MariaDB 호환 여부 확인 필요
CREATE DATABASE IF NOT EXISTS taskcanvas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; -- DB 생성
USE taskcanvas; -- 대상 DB 선택

CREATE TABLE IF NOT EXISTS guests ( -- 게스트 계정
    guest_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 게스트 고유 ID
    display_name VARCHAR(60) NOT NULL, -- 표시 이름
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP -- 최초 입장 시각
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; -- 게스트 테이블

CREATE TABLE IF NOT EXISTS users ( -- 정식 회원 데이터 기반
    user_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 회원 고유 ID
    login_id VARCHAR(120) NOT NULL, -- 대소문자를 구분하지 않는 로그인 ID
    display_name VARCHAR(60) NOT NULL, -- 회원 표시 이름
    password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- PHP 비밀번호 해시
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 회원 생성 시각
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, -- 회원 변경 시각
    UNIQUE KEY uq_users_login_id (login_id) -- 로그인 ID 중복 방지
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci; -- 회원 테이블

CREATE TABLE IF NOT EXISTS user_sessions ( -- 정식 회원 세션 데이터 기반
    session_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 회원 세션 행 ID
    user_id BIGINT UNSIGNED NOT NULL, -- 연결 회원 ID
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- 세션 토큰의 SHA-256 해시
    expires_at DATETIME NOT NULL, -- 세션 만료 시각
    revoked_at DATETIME NULL, -- 세션 폐기 시각
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 세션 발급 시각
    UNIQUE KEY uq_user_sessions_token (token_hash), -- 세션 토큰 해시 중복 방지
    KEY idx_user_sessions_user_expiry (user_id, expires_at), -- 회원별 세션과 만료 조회
    CONSTRAINT fk_user_session_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE -- 회원 삭제 시 세션 정리
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci; -- 회원 세션 테이블

CREATE TABLE IF NOT EXISTS guest_user_links ( -- 기존 게스트와 정식 회원의 검증된 연결
    guest_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, -- 게스트당 회원 한 명
    user_id BIGINT UNSIGNED NOT NULL, -- 연결 회원 ID
    linked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 소유 확인 후 연결 시각
    KEY idx_guest_user_links_user (user_id), -- 회원별 여러 게스트 조회
    CONSTRAINT fk_guest_user_link_guest FOREIGN KEY (guest_id) REFERENCES guests (guest_id) ON DELETE CASCADE, -- 게스트 삭제 시 연결 정리
    CONSTRAINT fk_guest_user_link_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT -- 연결 해제 없는 회원 삭제 차단
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci; -- 게스트 연결 테이블

CREATE TABLE IF NOT EXISTS guest_sessions ( -- 게스트 세션
    session_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 세션 행 ID
    guest_id BIGINT UNSIGNED NOT NULL, -- 연결 게스트 ID
    token_hash CHAR(64) NOT NULL UNIQUE, -- 토큰 해시
    expires_at DATETIME NOT NULL, -- 세션 만료 시각
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 발급 시각
    user_session_id BIGINT UNSIGNED NULL, -- 발급 회원 세션
    CONSTRAINT fk_guest_session_guest FOREIGN KEY (guest_id) REFERENCES guests (guest_id) ON DELETE CASCADE, -- 게스트 연결
    CONSTRAINT fk_guest_session_user_session FOREIGN KEY (user_session_id) REFERENCES user_sessions (session_id) ON DELETE CASCADE -- 회원 세션 연결
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; -- 세션 테이블

CREATE TABLE IF NOT EXISTS projects ( -- 프로젝트 정보
    project_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 프로젝트 ID
    title VARCHAR(120) NOT NULL, -- 프로젝트 제목
    description TEXT NULL, -- 프로젝트 설명
    created_by BIGINT UNSIGNED NULL, -- 최초 관리자 게스트
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 생성 시각
    CONSTRAINT fk_project_creator FOREIGN KEY (created_by) REFERENCES guests (guest_id) ON DELETE SET NULL -- 작성자 참조
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; -- 프로젝트 테이블

CREATE TABLE IF NOT EXISTS project_members ( -- 프로젝트 참여자
    project_id BIGINT UNSIGNED NOT NULL, -- 프로젝트 ID
    guest_id BIGINT UNSIGNED NOT NULL, -- 게스트 ID
    role VARCHAR(20) NOT NULL DEFAULT 'viewer', -- 관리자·편집자·열람자
    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 참여 시각
    PRIMARY KEY (project_id, guest_id), -- 중복 참여 방지
    CONSTRAINT fk_project_member_project FOREIGN KEY (project_id) REFERENCES projects (project_id) ON DELETE CASCADE, -- 프로젝트 참조
    CONSTRAINT fk_project_member_guest FOREIGN KEY (guest_id) REFERENCES guests (guest_id) ON DELETE CASCADE -- 게스트 참조
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; -- 참여자 테이블

CREATE TABLE IF NOT EXISTS project_invites ( -- 초대 코드 정보
    invite_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 초대 ID
    project_id BIGINT UNSIGNED NOT NULL, -- 연결 프로젝트
    code_hash CHAR(64) NOT NULL UNIQUE, -- 초대 코드 해시
    role VARCHAR(20) NOT NULL DEFAULT 'editor', -- 부여 권한
    max_uses INT UNSIGNED NULL, -- 이 코드로 새로 입장할 수 있는 인원(NULL 이면 제한 없음)
    used_count INT UNSIGNED NOT NULL DEFAULT 0, -- 이 코드로 새로 입장한 인원
    expires_at DATETIME NOT NULL, -- 유효 기간
    revoked_at DATETIME NULL, -- 초대 취소 시각
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 발급 시각
    CONSTRAINT fk_invite_project FOREIGN KEY (project_id) REFERENCES projects (project_id) ON DELETE CASCADE -- 프로젝트 참조
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; -- 초대 테이블

CREATE TABLE IF NOT EXISTS boards ( -- 프로젝트별 보드
    board_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 보드 ID
    project_id BIGINT UNSIGNED NOT NULL, -- 프로젝트 ID
    title VARCHAR(120) NOT NULL, -- 보드 이름
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 생성 시각
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, -- 갱신 시각
    CONSTRAINT fk_board_project FOREIGN KEY (project_id) REFERENCES projects (project_id) ON DELETE CASCADE -- 프로젝트 참조
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; -- 보드 테이블

CREATE TABLE IF NOT EXISTS tasks ( -- P1 원본 업무
    task_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 업무 ID
    project_id BIGINT UNSIGNED NOT NULL, -- 프로젝트 ID
    title VARCHAR(180) NOT NULL, -- 업무 이름
    description TEXT NULL, -- 업무 설명
    status VARCHAR(24) NOT NULL DEFAULT 'todo', -- 진행 상태
    assignee_id BIGINT UNSIGNED NULL, -- 담당 게스트 ID
    due_at DATETIME NULL, -- 마감 시각
    version BIGINT UNSIGNED NOT NULL DEFAULT 1, -- 변경 버전
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 생성 시각
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, -- 수정 시각
    CONSTRAINT fk_task_project FOREIGN KEY (project_id) REFERENCES projects (project_id) ON DELETE CASCADE, -- 프로젝트 참조
    CONSTRAINT fk_task_assignee FOREIGN KEY (assignee_id) REFERENCES guests (guest_id) ON DELETE SET NULL -- 담당자 참조
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; -- 업무 테이블

CREATE TABLE IF NOT EXISTS task_status_history ( -- 실제 업무 상태 변경 이력
    history_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 이력 ID
    project_id BIGINT UNSIGNED NOT NULL, -- 작업실 범위
    task_id BIGINT UNSIGNED NOT NULL, -- 대상 업무
    from_status VARCHAR(24) NOT NULL, -- 변경 전 상태
    to_status VARCHAR(24) NOT NULL, -- 변경 후 상태
    actor_guest_id BIGINT UNSIGNED NULL, -- 변경 게스트
    actor_user_id BIGINT UNSIGNED NULL, -- 연결 회원
    request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- 멱등 요청 키
    changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 실제 변경 시각
    UNIQUE KEY uq_task_status_request (project_id,request_id), -- 작업실별 중복 기록 방지
    KEY idx_task_status_project_time (project_id,changed_at,history_id), -- 기간 추이 조회
    KEY idx_task_status_task_time (task_id,changed_at,history_id), -- 업무별 이력 조회
    CONSTRAINT fk_task_status_project FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE, -- 작업실 정리
    CONSTRAINT fk_task_status_task FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE, -- 업무 정리
    CONSTRAINT fk_task_status_guest FOREIGN KEY (actor_guest_id) REFERENCES guests(guest_id) ON DELETE SET NULL, -- 게스트 기록 보존
    CONSTRAINT fk_task_status_user FOREIGN KEY (actor_user_id) REFERENCES users(user_id) ON DELETE SET NULL -- 회원 기록 보존
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci; -- 상태 이력 표

CREATE TABLE IF NOT EXISTS task_items ( -- P1 업무 체크리스트 항목
    item_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 항목 ID
    task_id BIGINT UNSIGNED NOT NULL, -- 업무 ID
    title VARCHAR(120) NOT NULL, -- 항목 이름
    is_done TINYINT(1) NOT NULL DEFAULT 0, -- 완료 여부
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 생성 시각
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, -- 수정 시각
    KEY idx_item_task (task_id, item_id), -- 업무별 항목 조회(만든 순서)
    CONSTRAINT fk_item_task FOREIGN KEY (task_id) REFERENCES tasks (task_id) ON DELETE CASCADE -- 업무 참조(업무가 지워지면 항목도 삭제)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; -- 체크리스트 항목 테이블

CREATE TABLE IF NOT EXISTS board_objects ( -- 보드 저장 객체
    object_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 객체 ID
    board_id BIGINT UNSIGNED NOT NULL, -- 보드 ID
    task_id BIGINT UNSIGNED NULL, -- P1 공유 업무 원본
    type VARCHAR(32) NOT NULL, -- stroke·shape·image·video·task 등
    x DOUBLE NOT NULL DEFAULT 0, -- 객체 X 좌표
    y DOUBLE NOT NULL DEFAULT 0, -- 객체 Y 좌표
    width DOUBLE NOT NULL DEFAULT 0, -- 객체 너비
    height DOUBLE NOT NULL DEFAULT 0, -- 객체 높이
    payload_json JSON NULL, -- 객체 본문 및 펜 경로
    style_json JSON NULL, -- 객체 색상·굵기 스타일
    version BIGINT UNSIGNED NOT NULL DEFAULT 1, -- 낙관적 변경 버전
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 생성 시각
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, -- 변경 시각
    INDEX idx_objects_board (board_id), -- 보드별 조회 인덱스
    CONSTRAINT fk_object_board FOREIGN KEY (board_id) REFERENCES boards (board_id) ON DELETE CASCADE, -- 보드 참조
    CONSTRAINT fk_object_task FOREIGN KEY (task_id) REFERENCES tasks (task_id) ON DELETE SET NULL -- 업무 참조
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; -- 객체 테이블

CREATE TABLE IF NOT EXISTS media_assets ( -- 이미지 파일 메타데이터
    asset_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 이미지 ID
    project_id BIGINT UNSIGNED NOT NULL, -- 소속 프로젝트
    uploaded_by BIGINT UNSIGNED NULL, -- 업로더 게스트
    original_name VARCHAR(255) NOT NULL, -- 원래 파일명
    stored_path VARCHAR(400) NOT NULL, -- 서버 내부 파일 경로
    mime_type VARCHAR(60) NOT NULL, -- 서버 확인 MIME
    size_bytes BIGINT UNSIGNED NOT NULL, -- 파일 크기
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 업로드 시각
    CONSTRAINT fk_media_project FOREIGN KEY (project_id) REFERENCES projects (project_id) ON DELETE CASCADE, -- 프로젝트 참조
    CONSTRAINT fk_media_uploader FOREIGN KEY (uploaded_by) REFERENCES guests (guest_id) ON DELETE SET NULL -- 업로더 참조
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; -- 이미지 테이블

CREATE TABLE IF NOT EXISTS board_links ( -- P1 객체 관계 연결선
    link_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 관계 ID
    board_id BIGINT UNSIGNED NOT NULL, -- 동일 보드 ID
    from_object_id BIGINT UNSIGNED NOT NULL, -- 출발 객체
    to_object_id BIGINT UNSIGNED NOT NULL, -- 도착 객체
    label VARCHAR(100) NULL, -- 연결선 라벨
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 생성 시각
    CONSTRAINT fk_link_board FOREIGN KEY (board_id) REFERENCES boards (board_id) ON DELETE CASCADE, -- 보드 참조
    CONSTRAINT fk_link_from FOREIGN KEY (from_object_id) REFERENCES board_objects (object_id) ON DELETE CASCADE, -- 출발 객체 참조
    CONSTRAINT fk_link_to FOREIGN KEY (to_object_id) REFERENCES board_objects (object_id) ON DELETE CASCADE -- 도착 객체 참조
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; -- 연결선 테이블

CREATE TABLE IF NOT EXISTS realtime_tickets ( -- Socket.IO 단기 접속 티켓
    ticket_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 티켓 행 ID
    ticket_hash CHAR(64) NOT NULL UNIQUE, -- 티켓 원문 SHA-256 해시
    guest_id BIGINT UNSIGNED NOT NULL, -- 발급 대상 게스트
    board_id BIGINT UNSIGNED NULL, -- 참여 허용 보드(작업실 연결용 티켓이면 NULL)
    project_id BIGINT UNSIGNED NULL, -- 작업실 연결용 티켓의 프로젝트(보드 티켓이면 NULL)
    expires_at DATETIME NOT NULL, -- 티켓 만료 시각
    used_at DATETIME NULL, -- 사용 시각(일회성 검사)
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 발급 시각
    guest_session_id BIGINT UNSIGNED NULL, -- 티켓 발급 세션
    CONSTRAINT fk_ticket_guest FOREIGN KEY (guest_id) REFERENCES guests (guest_id) ON DELETE CASCADE, -- 게스트 참조
    CONSTRAINT fk_ticket_board FOREIGN KEY (board_id) REFERENCES boards (board_id) ON DELETE CASCADE, -- 보드 참조
    CONSTRAINT fk_ticket_project FOREIGN KEY (project_id) REFERENCES projects (project_id) ON DELETE CASCADE, -- 프로젝트 참조
    CONSTRAINT fk_ticket_session FOREIGN KEY (guest_session_id) REFERENCES guest_sessions (session_id) ON DELETE CASCADE -- 발급 세션 연결
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; -- 티켓 테이블

CREATE TABLE IF NOT EXISTS join_attempts ( -- 게스트 입장 시도 기록(요청 제한용)
    attempt_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 시도 행 ID
    client_ip VARCHAR(45) NOT NULL, -- 요청 IP(IPv6 길이 허용)
    succeeded TINYINT(1) NOT NULL DEFAULT 0, -- 성공 여부
    attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 시도 시각
    INDEX idx_attempts_ip_time (client_ip, attempted_at) -- IP·시간 조회 인덱스
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; -- 입장 시도 테이블

CREATE TABLE IF NOT EXISTS import_datasets ( -- 확정 데이터셋
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci; -- 데이터셋 표

CREATE TABLE IF NOT EXISTS import_rows ( -- 확정 원본 행
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci; -- 행 표

CREATE TABLE IF NOT EXISTS import_drafts ( -- 세션 소유 임시 원본
    draft_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, -- 공개 토큰의 해시
    project_id BIGINT UNSIGNED NOT NULL, -- 작업실 범위
    guest_session_id BIGINT UNSIGNED NOT NULL, -- 업로드 세션
    original_name VARCHAR(255) NOT NULL, -- 안전한 파일 이름
    format VARCHAR(8) NOT NULL, -- csv 또는 json
    encoding VARCHAR(16) NOT NULL DEFAULT 'UTF-8', -- 명시적 인코딩
    json_path VARCHAR(1024) NULL, -- 선택 배열 경로
    size_bytes INT UNSIGNED NOT NULL, -- 원본 크기
    source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- 복원 무결성
    config_json LONGTEXT NULL, -- 서버 검증 설정
    validation_revision INT UNSIGNED NOT NULL DEFAULT 0, -- 검증 세대
    target_version BIGINT UNSIGNED NULL, -- 검증한 데이터 버전
    report_json LONGTEXT NULL, -- 제한된 오류 보고
    result_json LONGTEXT NULL, -- 반복 저장 응답
    status VARCHAR(16) NOT NULL DEFAULT 'uploaded', -- uploaded 또는 consumed
    expires_at DATETIME NOT NULL, -- 접근 만료
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 업로드 시각
    KEY idx_import_draft_session (guest_session_id,status,expires_at), -- 세션별 한도
    KEY idx_import_draft_project (project_id,status,expires_at), -- 작업실별 한도
    CONSTRAINT fk_import_draft_project FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE, -- 작업실 정리
    CONSTRAINT fk_import_draft_session FOREIGN KEY (guest_session_id) REFERENCES guest_sessions(session_id) ON DELETE CASCADE -- 세션 정리
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci; -- 초안 표

CREATE TABLE IF NOT EXISTS import_draft_chunks ( -- 작은 패킷의 원본 조각
    draft_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- 부모 초안
    chunk_no INT UNSIGNED NOT NULL, -- 0부터 시작하는 순서
    data MEDIUMBLOB NOT NULL, -- 최대 64KiB 조각
    PRIMARY KEY (draft_hash,chunk_no), -- 순서별 중복 방지
    CONSTRAINT fk_import_chunk_draft FOREIGN KEY (draft_hash) REFERENCES import_drafts(draft_hash) ON DELETE CASCADE -- 초안과 함께 정리
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci; -- 조각 표

CREATE TABLE IF NOT EXISTS import_runs ( -- 검증과 저장 이력
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci; -- 이력 표
CREATE TABLE IF NOT EXISTS import_quality_reports ( -- 불변 품질 보고서
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci; -- 품질 표
CREATE TABLE IF NOT EXISTS import_quality_rows ( -- 문제 행별 작은 기록
    run_id BIGINT UNSIGNED NOT NULL, -- 보고서 ID
    source_row INT UNSIGNED NOT NULL, -- 원본 데이터 행 번호
    issues_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, -- 값 없는 압축 문제 목록
    PRIMARY KEY (run_id,source_row), -- 보고서 안의 고정 순서
    CONSTRAINT fk_quality_row_report FOREIGN KEY (run_id) REFERENCES import_quality_reports(run_id) ON DELETE CASCADE, -- 보고서 수명
    CONSTRAINT ck_quality_issues CHECK (JSON_VALID(issues_json)) -- 문제 JSON 검사
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci; -- 문제 행 표
