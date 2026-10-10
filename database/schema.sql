-- TaskCanvas 초기 데이터베이스 스키마 초안
-- MySQL 8 / MariaDB 호환 여부 확인 필요
CREATE DATABASE IF NOT EXISTS taskcanvas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; -- DB 생성
USE taskcanvas; -- 대상 DB 선택

CREATE TABLE IF NOT EXISTS guests ( -- 게스트 계정
    guest_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 게스트 고유 ID
    display_name VARCHAR(60) NOT NULL, -- 표시 이름
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP -- 최초 입장 시각
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; -- 게스트 테이블

CREATE TABLE IF NOT EXISTS guest_sessions ( -- 게스트 세션
    session_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 세션 행 ID
    guest_id BIGINT UNSIGNED NOT NULL, -- 연결 게스트 ID
    token_hash CHAR(64) NOT NULL UNIQUE, -- 토큰 해시
    expires_at DATETIME NOT NULL, -- 세션 만료 시각
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 발급 시각
    CONSTRAINT fk_guest_session_guest FOREIGN KEY (guest_id) REFERENCES guests (guest_id) ON DELETE CASCADE -- 게스트 연결
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
    CONSTRAINT fk_ticket_guest FOREIGN KEY (guest_id) REFERENCES guests (guest_id) ON DELETE CASCADE, -- 게스트 참조
    CONSTRAINT fk_ticket_board FOREIGN KEY (board_id) REFERENCES boards (board_id) ON DELETE CASCADE, -- 보드 참조
    CONSTRAINT fk_ticket_project FOREIGN KEY (project_id) REFERENCES projects (project_id) ON DELETE CASCADE -- 프로젝트 참조
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; -- 티켓 테이블

CREATE TABLE IF NOT EXISTS join_attempts ( -- 게스트 입장 시도 기록(요청 제한용)
    attempt_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, -- 시도 행 ID
    client_ip VARCHAR(45) NOT NULL, -- 요청 IP(IPv6 길이 허용)
    succeeded TINYINT(1) NOT NULL DEFAULT 0, -- 성공 여부
    attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 시도 시각
    INDEX idx_attempts_ip_time (client_ip, attempted_at) -- IP·시간 조회 인덱스
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; -- 입장 시도 테이블
