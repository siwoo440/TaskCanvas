'use strict'; // 엄격한 검사
const fs = require('fs'); // 임시 업로드·스키마
const path = require('path'); // 절대 경로
const crypto = require('crypto'); // 임시 DB 이름
const net = require('net'); // 가용 포트
const { spawn } = require('child_process'); // 기존 수용 검사
const mysql = require('mysql2/promise'); // 분리 DB
const env = require('../src/env'); // 접속 설정
async function main() // 운영 자료와 분리된 전체 수용 검사
{ // 실행 시작
    const root = path.resolve(__dirname, '../../..'); // 저장소 루트
    const name = 'taskcanvas_ac_' + crypto.randomBytes(8).toString('hex'); // 고유 DB
    const admin = await mysql.createConnection({ host: env.get('DB_HOST'), port: env.int('DB_PORT'), user: env.get('DB_USER'), password: env.get('DB_PASS'), multipleStatements: true }); // 생성 연결
    let created = false; // 이번 DB 여부
    let upload = null; // 이번 업로드 경로
    const reservations = []; // 이번 포트 예약
    try // 검사 수명
    { // 환경 생성
        await admin.query('CREATE DATABASE ' + name + ' CHARACTER SET utf8mb4'); // 분리 DB
        created = true; // 정리 등록
        await admin.query('USE ' + name); // 쓰기 대상 제한
        await admin.query(fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8').replace(/^(?:CREATE DATABASE IF NOT EXISTS taskcanvas\b.*|USE taskcanvas;.*)$/gm, '')); // 최신 스키마
        fs.mkdirSync(path.join(root, 'tmp'), { recursive: true }); // 무시된 임시 폴더
        upload = fs.mkdtempSync(path.join(root, 'tmp', 'acceptance-')); // 고유 업로드 경로
        for (let index = 0; index < 2; index += 1) // 두 서버 포트
        { // 포트 확보
            const server = net.createServer(); // 예약 서버
            reservations.push(server); // 실패 시 정리
            await new Promise((resolve, reject) => // 점유 여부 검사
            { // 예약 시작
                server.once('error', reject); server.listen(0, '127.0.0.1', resolve); // 고유 가용 포트
            }); // 예약 끝
        } // 포트 확보 끝
        const ports = reservations.map((server) => server.address().port); // 서로 다른 포트
        await Promise.all(reservations.map((server) => new Promise((resolve) => server.close(resolve)))); // 실제 서버에 양도
        console.log('분리 수용 DB: ' + name); // 검사 대상 증거
        const child = spawn(process.execPath, [path.join(__dirname, 'acceptance.js')], { cwd: root, stdio: 'inherit', env: { ...process.env, DB_NAME: name, DB_HOST: env.get('DB_HOST'), DB_PORT: env.get('DB_PORT'), DB_USER: env.get('DB_USER'), DB_PASS: env.get('DB_PASS'), UPLOAD_DIR: upload, AC_API_PORT: String(ports[0]), AC_RT_PORT: String(ports[1]) } }); // 기존 전체 검사 재사용
        const code = await new Promise((resolve, reject) => // 실제 종료 대기
        { // 대기 시작
            child.once('error', reject); child.once('exit', resolve); // 성공·실패 수집
        }); // 대기 끝
        process.exitCode = code === 0 ? 0 : 1; // 검사 결과 전달
    } // 검사 수명 끝
    finally // 고유 자원 정리
    { // 정리 시작
        reservations.forEach((server) => server.close()); // 잔여 예약 해제
        if (created) // 이번 DB만
        { // 자료 정리
            await admin.query('DROP DATABASE ' + name); // 임시 검사 DB 삭제
        } // 자료 정리 끝
        await admin.end(); // 관리 연결 해제
        if (upload && path.resolve(upload).startsWith(path.resolve(root, 'tmp') + path.sep) && path.basename(upload).startsWith('acceptance-')) // 절대 경로와 고유 접두사 검증
        { // 업로드 정리
            fs.rmSync(upload, { recursive: true, force: true }); // 이번 임시 업로드만 삭제
        } // 업로드 정리 끝
    } // 정리 끝
} // 실행 끝
main().catch((error) => // 최종 오류 보고
{ // 오류 처리
    console.error(error.message); process.exitCode = 1; // 실패 원인과 코드
}); // 오류 처리 끝
