---
# 34일차 회원 작업 흐름 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회원별 저장 뷰·역할 관리·검색·개인 홈과 키보드 기본 흐름 완성.
**Architecture:** 기존 게스트-회원 연결의 최고 역할을 공통 범위로 확인하고 개인 데이터는 회원 ID로 격리한다. 역할 변경은 프로젝트 행을 잠가 원자적으로 처리한다.
**Tech Stack:** PHP8·MariaDB·Socket.IO·순수 JavaScript
**Spec:** docs/superpowers/specs/2026-10-21-day34-member-workflow-design.md

---
## Global Constraints

- 기존 회원/게스트 인증·1~33일차 데이터 보존
- Allman 스타일·각 코드 줄의 짧은 한글 명사형 주석
- Asia/Seoul 날짜와 바인딩 SQL, textContent 안전 출력
- 공유 main 커밋·푸시 없이 구현 결과 전달

---
## Review Focus

- 같은 회원의 여러 게스트 중 하나만 강등되어 우회하지 않는지 확인
- 두 관리자의 동시 강등/내보내기에서 관리자 한 명 보존
- 검색의 메모 JSON과 %/_ 입력 및 숨은 타 작업실 자료
- 저장 뷰의 기본값과 version, 계정 변경 후 늦은 응답
- 즐겨찾기·최근 보드의 삭제·탈퇴 후 숨김 및 키보드 포커스 복원

---
### Task 1: 회원 설정 스키마·공통 권한

**Files:** database/schema.sql, apps/php-api/src/Schema.php, MemberScope.php, tests/member-workflow-schema.php
**Interfaces:** MemberScope::role(userId,projectId,minimum)와 transaction(user,projectId,callback).
- [x] 신규·보정 일치 및 회원별 데이터 제약의 실패 검사 작성/실행.
- [x] 3개 표와 공통 범위 구현.
- [x] PHP 스키마 검사 통과 확인.

---
### Task 2: 저장 뷰·개인 홈·검색 API

**Files:** SavedViews.php, MemberHome.php, MemberSearch.php, controllers/MemberToolsController.php, public/index.php, apps/realtime/scripts/test-member-tools.js
**Interfaces:** GET/POST analytics/views, GET auth/home/search, POST auth/favorites/visits.
- [x] 실제 API 고유 DB에서404 실패 확인.
- [x] 회원별 격리·공통 필터·수정 충돌·기본값·자료 상한 구현.
- [x] 소유·검색·최근·즐겨찾기 API 통과.

---
### Task 3: 역할 변경·내보내기

**Files:** MemberManagement.php, controllers/MemberToolsController.php, session-guard.js, test-member-tools.js
**Interfaces:** GET members/manage, POST members/role·remove; 기존 Socket.IO 인증.
- [x] 마지막 관리자·동시 강등·타 회원 우회의 실패 검사.
- [x] 프로젝트 잠금·회원 묶음·최신 세션 재검사와 티켓 무효화.
- [x] HTTP·실시간 권한 회귀 검사.

---
### Task 4: UI와 접근성

**Files:** saved-views.js, member-tools.js, member-management.js, member-tools.css, index.html, app.js, analytics-dashboard.js
**Interfaces:** TC_MEMBER_USER·작업실 선택 이벤트·현재 적용 분석 필터.
- [x] 회원 UI 실제 브라우저 검사 시나리오 작성.
- [x] 저장 뷰·개인 홈·즐겨찾기·역할 패널과 Ctrl+K 대화상자 구현.
- [x] 계정 변경 폐기·Enter/Esc/포커스·한글 입력 검증.

---
### Task 5: 회귀·문서·검토

**Files:** README.md, docs/README.md, 07-http-api.md, 10-wbs-timeline.md, 11-acceptance-tests.md, 24-product-expansion-backlog.md, 30-roadmap-reordered.md, 34-member-workflow.md
- [x] 고유 DB 전체 수용과 기존 인증·분석 회귀 실행.
- [x] 새 스키마 로컬 보정 후 실제 브라우저에서 회원 흐름 확인.
- [x] 전체 변경의 읽기 전용 검토와 주요 문제 수정.
- [x] 검증된 범위만 문서 완료 표기.
