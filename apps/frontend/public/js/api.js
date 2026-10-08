// PHP HTTP API 호출 도우미
'use strict';

class ApiError extends Error
{
    constructor(status, code, message)
    {
        super(message); // 사용자 안내 메시지
        this.status = status; // HTTP 상태
        this.code = code; // docs/07-http-api.md 오류 코드
    }
}

async function apiRequest(method, path, body)
{
    const res = await fetch(window.TC_CONFIG.apiBase + path, {
        method, // HTTP 메서드
        credentials: 'same-origin', // 세션 쿠키 포함
        headers: { 'Content-Type': 'application/json', 'X-TaskCanvas': '1' }, // JSON 과 CSRF 방어 헤더
        body: body === undefined ? undefined : JSON.stringify(body), // JSON 본문
    }); // HTTP 요청
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
        const error = data && data.error ? data.error : { code: 'HTTP_' + res.status, message: '서버 응답 오류 (' + res.status + ')' }; // 오류 정보
        throw new ApiError(res.status, error.code, error.message); // 예외 전달
    }
    return data; // 성공 본문
}

window.api = {
    get: (path) => apiRequest('GET', path), // GET 호출
    post: (path, body) => apiRequest('POST', path, body ?? {}), // POST 호출
    ApiError, // 오류 타입
}; // 전역 API 객체
