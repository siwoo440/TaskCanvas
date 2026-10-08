// MySQL 커넥션 풀 (PHP API 와 같은 DB 사용)
'use strict';

const mysql = require('mysql2/promise'); // 프로미스 기반 드라이버
const env = require('./env'); // 설정 값

const pool = mysql.createPool({
    host: env.get('DB_HOST'), // DB 호스트
    port: env.int('DB_PORT'), // DB 포트
    database: env.get('DB_NAME'), // DB 이름
    user: env.get('DB_USER'), // DB 사용자
    password: env.get('DB_PASS'), // DB 비밀번호
    charset: 'utf8mb4', // 한글 저장 문자셋
    connectionLimit: 10, // 동시 연결 수
    namedPlaceholders: false, // ? 바인딩 사용
}); // 풀 생성

async function query(sql, params = [])
{
    const [rows] = await pool.execute(sql, params); // 바인딩 실행
    return rows; // 결과 행
}

async function one(sql, params = [])
{
    const rows = await query(sql, params); // 전체 결과
    return rows.length > 0 ? rows[0] : null; // 첫 행 또는 null
}

module.exports = { pool, query, one };
