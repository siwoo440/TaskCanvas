// .env 로더와 설정 접근자 (외부 패키지 없이 동작)
'use strict';

const fs = require('fs'); // 파일 읽기
const path = require('path'); // 경로 계산

const DEFAULTS = { // .env 가 없을 때의 기본값
    PORT: '3001',
    DB_HOST: '127.0.0.1',
    DB_PORT: '3306',
    DB_NAME: 'taskcanvas',
    DB_USER: 'root',
    DB_PASS: '',
    CORS_ORIGIN: '*',
    CURSOR_INTERVAL_MS: '33',
    MAX_STROKE_POINTS: '5000',
};

const values = { ...DEFAULTS }; // 로드된 설정 값
const envPath = path.join(__dirname, '..', '.env'); // .env 위치

if (fs.existsSync(envPath))
{
    for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/))
    {
        const line = rawLine.trim(); // 공백 제거
        if (line === '' || line.startsWith('#') || !line.includes('='))
        {
            continue; // 주석·빈 줄 건너뜀
        }
        const index = line.indexOf('='); // 구분자 위치
        values[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^["']|["']$/g, ''); // 따옴표 제거 후 저장
    }
}

module.exports = {
    get: (key) => values[key] ?? '', // 문자열 설정 조회
    int: (key) => parseInt(values[key] ?? '0', 10) || 0, // 정수 설정 조회
};
