// 프론트엔드 접속 설정 (같은 PC 의 PHP API 와 3001 포트 실시간 서버를 기본으로 사용)
'use strict';

window.TC_CONFIG = {
    apiBase: '', // PHP API 가 같은 출처(/api/...)에 있을 때 빈 문자열
    realtimeUrl: location.protocol + '//' + location.hostname + ':3001', // Socket.IO 서버 주소
    cursorIntervalMs: 33, // 커서 전송 최소 간격
    previewIntervalMs: 40, // 펜 미리보기 전송 최소 간격
}; // 전역 설정
