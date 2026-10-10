# 이미지·외부 영상 처리

---

## MVP 이미지 업로드 조건

| 항목 | 확정 내용 |
|---|---|
| 허용 파일 | PNG, JPG/JPEG, WEBP |
| 최대 크기 | 파일당 10 MB 이하 |
| 추가 방식 | 파일 선택 버튼, 드래그 앤 드롭, 이미지 클립보드 붙여넣기 |
| 저장 방법 | 서버 전용 저장 디렉터리 + DB 메타데이터 |
| 파일 접근 | 서버가 프로젝트 참여·권한을 확인하고 응답 |
| 파일 삭제 | 보드에서 이미지를 지워도 파일은 바로 지우지 않음. 어느 보드에서도 쓰지 않는 이미지는 정리 스크립트로 따로 지움 |

**브라우저가 보내는 MIME만으로 신뢰하지 않습니다.** 파일 내용을 검사하고 업로드 크기·확장자를 함께 검증하며, 저장명은 랜덤 생성 이름으로 바꿉니다. 이미지 업로드 취약점을 막기 위해 실행 가능한 코드는 저장/서빙하지 않습니다.

**구현(5단계):** `POST /api/images` 가 `finfo`(내용 MIME)와 `getimagesize` 로 검사해 `apps/php-api/storage/uploads/{project_id}/{랜덤}.{png|jpg|webp}` 에 저장하고 `media_assets` 에 메타데이터를 남깁니다. `GET /api/images/{id}` 는 프로젝트 참여자만 접근할 수 있고 `X-Content-Type-Options: nosniff` 로 반환합니다. 보드 객체는 `type='image'`, `payload={asset_id, url, mime_type}` 이며 실시간 서버가 `asset_id` 가 같은 프로젝트 소유인지 다시 확인합니다. XAMPP php.ini 기본값(`upload_max_filesize=40M`)은 10MB 제한보다 크므로 그대로 사용 가능합니다.

**파일 정리(16단계):** 이미지 객체를 지운 사람이 실행 취소로 되살릴 수 있어야 하므로, 객체가 지워져도 파일과 `media_assets` 행은 남깁니다. `apps/php-api/bin/clean-uploads.php` 가 어느 보드의 이미지 객체도 가리키지 않고 올린 지 24시간이 지난 이미지를 찾아 보여 주고, `--apply` 를 붙이면 지웁니다. 최근 30분 안에 보드 접속 기록이 있으면 멈추므로 아무도 편집하지 않을 때 실행합니다.

---

## 외부 영상

- 동영상 파일을 직접 업로드하지 않음.
- 사용자 URL은 정해진 허용 서비스 도메인·ID 형식을 검사하여 임베드 URL로 변환.
- iframe `sandbox`/`allow` 권한을 최소화하고 임의 HTML 삽입을 피함.
- 학교 PC에서 외부 영상 사이트 접근·임베드 가능 여부를 미리 점검.
- 영상 링크와 배치 정보를 보드 객체로 저장.

**구현(5단계):** 허용 서비스는 YouTube(`youtube.com/watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`)와 Vimeo 입니다. 실시간 서버 `src/video.js` 가 URL 을 해석해 ID 형식을 검사하고 `embed_url`(`youtube-nocookie.com/embed/{id}`, `player.vimeo.com/video/{id}`)을 **서버가 생성**합니다. 보드 객체는 `type='video'`, `payload={provider, video_id, embed_url, source_url}` 이고, 프론트엔드는 캔버스 위 오버레이 iframe(`sandbox="allow-scripts allow-same-origin allow-presentation"`)으로 표시하며 제목 막대(28 단위)를 잡아 이동합니다.

---

## 브라우저 테스트

1. 허용된 세 종류의 이미지 업로드·표시·재접속 확인.
2. 10MB 초과/위장 확장자/손상된 이미지/빈 파일 거절 확인.
3. 업로드 중 연속 중단 및 중복 요청 처리 확인.
4. Chrome에서 드래그 및 Ctrl+V 동작 확인.
5. 게스트가 속하지 않은 프로젝트의 이미지 URL 접근 차단 확인.
