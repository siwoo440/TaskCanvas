// 이미지 업로드, 영상 URL 검사, 영상 iframe 오버레이(캔버스 위에 겹쳐 배치)
'use strict';

const Media = {
    ALLOWED: ['image/png', 'image/jpeg', 'image/webp'], // 허용 이미지 형식
    MAX_BYTES: 10 * 1024 * 1024, // 파일당 10MB
    MAX_SIZE: 400, // 삽입 시 긴 변 최대 길이(월드 단위)
    VIDEO_WIDTH: 480, // 영상 카드 기본 너비
    VIDEO_HEIGHT: 270, // 영상 재생 영역 기본 높이(제목 막대 제외)

    checkFile(file)
    {
        if (!Media.ALLOWED.includes(file.type))
        {
            return 'PNG, JPG, WEBP 이미지만 추가할 수 있습니다.'; // 형식 오류
        }
        if (file.size > Media.MAX_BYTES)
        {
            return '파일당 최대 10MB 까지 추가할 수 있습니다.'; // 크기 오류
        }
        return null; // 통과
    },

    async upload(projectId, file)
    {
        const form = new FormData(); // multipart 본문
        form.append('project_id', String(projectId)); // 대상 프로젝트
        form.append('file', file, file.name || 'image'); // 이미지 파일
        const res = await fetch(window.TC_CONFIG.apiBase + '/api/images', {
            method: 'POST', // 업로드
            credentials: 'same-origin', // 세션 쿠키 포함
            headers: { 'X-TaskCanvas': '1' }, // CSRF 방어 헤더(Content-Type 은 브라우저가 경계 포함해 설정)
            body: form, // 폼 데이터
        }); // 업로드 요청
        let data = null; // 응답 본문
        try
        {
            data = await res.json(); // JSON 파싱
        }
        catch (err)
        {
            data = null; // 본문 없음
        }
        if (!res.ok)
        {
            const error = data && data.error ? data.error : { code: 'HTTP_' + res.status, message: '업로드 실패 (' + res.status + ')' }; // 오류 정보
            throw new window.api.ApiError(res.status, error.code, error.message); // 예외 전달
        }
        return data.asset; // {asset_id, url, width, height, mime_type, size_bytes}
    },

    fitSize(width, height)
    {
        const longest = Math.max(width, height, 1); // 긴 변
        const ratio = longest > Media.MAX_SIZE ? Media.MAX_SIZE / longest : 1; // 축소 비율
        return { width: Math.max(1, width * ratio), height: Math.max(1, height * ratio) }; // 삽입 크기
    },

    // 서버와 같은 규칙의 가벼운 사전 검사(최종 판단은 서버)
    parseVideoUrl(input)
    {
        let url = null; // URL 객체
        try
        {
            url = new URL(String(input).trim()); // URL 해석
        }
        catch (err)
        {
            return null; // URL 아님
        }
        const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, ''); // 호스트 정규화
        if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'youtu.be')
        {
            return 'youtube'; // YouTube
        }
        if (host === 'vimeo.com' || host === 'player.vimeo.com')
        {
            return 'vimeo'; // Vimeo
        }
        return null; // 허용되지 않음
    },
};

class VideoOverlay
{
    constructor(container)
    {
        this.container = container; // 오버레이 요소
        this.frames = new Map(); // object_id → iframe
    }

    sync(canvas)
    {
        const seen = new Set(); // 이번 렌더에 존재하는 영상
        const width = canvas.el.width / canvas.dpr; // 화면 너비
        const height = canvas.el.height / canvas.dpr; // 화면 높이
        for (const o of canvas.objects)
        {
            if (o.type !== 'video' || !o.payload || !o.payload.embed_url)
            {
                continue; // 영상 아님·임베드 URL 없음
            }
            seen.add(o.object_id); // 존재 기록
            let frame = this.frames.get(o.object_id); // 기존 iframe
            if (!frame)
            {
                frame = document.createElement('iframe'); // 임베드 프레임
                frame.src = o.payload.embed_url; // 서버가 만든 임베드 URL
                frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation'); // 최소 권한
                frame.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen'); // 재생 권한
                frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin'); // 참조 정보 최소화
                frame.title = '영상 ' + o.object_id; // 접근성 제목
                this.container.appendChild(frame); // 오버레이에 추가
                this.frames.set(o.object_id, frame); // 등록
            }
            const pos = canvas.displayPosition(o); // 표시 위치(이동 중 반영)
            const s = canvas.toScreen(pos.x, pos.y + BoardCanvas.VIDEO_BAR); // 재생 영역 화면 좌표
            const w = o.width * canvas.view.scale; // 화면 너비
            const h = (o.height - BoardCanvas.VIDEO_BAR) * canvas.view.scale; // 화면 높이
            const offscreen = s.x + w < 0 || s.y + h < 0 || s.x > width || s.y > height || h <= 0; // 화면 밖 여부
            frame.style.display = offscreen ? 'none' : ''; // 화면 밖이면 숨김
            frame.style.transform = 'translate(' + s.x + 'px, ' + s.y + 'px)'; // 위치
            frame.style.width = w + 'px'; // 너비
            frame.style.height = Math.max(0, h) + 'px'; // 높이
        }
        for (const [id, frame] of this.frames)
        {
            if (!seen.has(id))
            {
                frame.remove(); // 사라진 영상 제거
                this.frames.delete(id); // 등록 해제
            }
        }
    }
}

window.Media = Media; // 전역 노출
window.VideoOverlay = VideoOverlay; // 전역 노출
