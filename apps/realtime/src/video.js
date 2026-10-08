// 외부 영상 URL 검증: 허용 서비스·ID 형식만 통과시키고 서버가 임베드 URL 을 만든다
'use strict';

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/; // YouTube 영상 ID 형식
const VIMEO_ID = /^\d{6,12}$/; // Vimeo 영상 ID 형식

function parse(input)
{
    if (typeof input !== 'string' || input.length > 500)
    {
        return null; // 형식 오류
    }
    let url = null; // URL 객체
    try
    {
        url = new URL(input.trim()); // URL 해석
    }
    catch (err)
    {
        return null; // URL 아님
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
    {
        return null; // http/https 만 허용
    }
    const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, ''); // 호스트 정규화
    let videoId = null; // 영상 ID
    let provider = null; // 서비스 이름

    if (host === 'youtube.com' || host === 'youtube-nocookie.com')
    {
        provider = 'youtube'; // YouTube
        const parts = url.pathname.split('/').filter(Boolean); // 경로 조각
        if (url.pathname === '/watch')
        {
            videoId = url.searchParams.get('v'); // watch?v=ID
        }
        else if (['embed', 'shorts', 'live', 'v'].includes(parts[0]) && parts[1])
        {
            videoId = parts[1]; // /embed/ID, /shorts/ID, /live/ID
        }
    }
    else if (host === 'youtu.be')
    {
        provider = 'youtube'; // 단축 URL
        videoId = url.pathname.split('/').filter(Boolean)[0] ?? null; // youtu.be/ID
    }
    else if (host === 'vimeo.com' || host === 'player.vimeo.com')
    {
        provider = 'vimeo'; // Vimeo
        const parts = url.pathname.split('/').filter(Boolean); // 경로 조각
        videoId = parts[0] === 'video' ? parts[1] ?? null : parts[0] ?? null; // vimeo.com/ID, player.vimeo.com/video/ID
    }

    if (provider === 'youtube' && videoId && YOUTUBE_ID.test(videoId))
    {
        return { provider, video_id: videoId, embed_url: 'https://www.youtube-nocookie.com/embed/' + videoId, source_url: input.trim() }; // YouTube 임베드
    }
    if (provider === 'vimeo' && videoId && VIMEO_ID.test(videoId))
    {
        return { provider, video_id: videoId, embed_url: 'https://player.vimeo.com/video/' + videoId, source_url: input.trim() }; // Vimeo 임베드
    }
    return null; // 허용되지 않음
}

module.exports = { parse };
