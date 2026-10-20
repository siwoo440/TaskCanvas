'use strict'; // 엄격한 검사
const fs = require('fs'); // 스키마·라우터
const path = require('path'); // 절대 경로
const crypto = require('crypto'); // 실행 식별
const net = require('net'); // 포트 예약
const { spawn } = require('child_process'); // 실제 PHP 서버
const mysql = require('mysql2/promise'); // 분리 MariaDB
const env = require('../../src/env'); // 기존 접속 설정
class ImportHarness // 실행별 테스트 환경
{ // 하네스 시작
    static async start() // 고유 DB와 두 서버
    { // 준비 시작
        const harness = new ImportHarness(); // 실행 상태
        harness.root = path.resolve(__dirname, '../../../..'); // 저장소 경로
        harness.name = 'taskcanvas_d30_api_' + crypto.randomBytes(8).toString('hex'); // 고유 DB
        harness.servers = []; harness.files = []; harness.urls = []; harness.created = false; // 정리 대상
        const options = { host: env.get('DB_HOST'), port: env.int('DB_PORT'), user: env.get('DB_USER'), password: env.get('DB_PASS'), multipleStatements: true, charset: 'utf8mb4' }; // 접속 설정
        harness.admin = await mysql.createConnection(options); // 생성 연결
        try // 실패 시 정리
        { // 환경 준비
            await harness.admin.query('CREATE DATABASE `' + harness.name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); // 분리 DB
            harness.created = true; harness.db = await mysql.createConnection({ ...options, database: harness.name }); // 테스트 연결
            const [[actual]] = await harness.db.query('SELECT DATABASE() AS name'); // 실제 선택 확인
            if (actual.name !== harness.name) // 개발 DB 보호
            { // 실행 차단
                throw new Error('분리 DB 불일치'); // 쓰기 금지
            } // 실행 차단 끝
            await harness.db.query(fs.readFileSync(path.join(harness.root, 'database/schema.sql'), 'utf8').replace(/^(?:CREATE DATABASE IF NOT EXISTS taskcanvas\b.*|USE taskcanvas;.*)$/gm, '')); // 신규 설치
            for (let i = 0; i < 2; i += 1) // 동시 요청 서버
            { // 서버 준비
                const reservation = net.createServer(); // 가용 포트
                await new Promise((resolve, reject) => // 포트 점유 검사
                { // 예약 시작
                    reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); // 임의 포트
                }); // 예약 끝
                const port = reservation.address().port; await new Promise((resolve) => reservation.close(resolve)); // PHP에 양도
                const nonce = crypto.randomBytes(16).toString('hex'); // 서버 신원
                const router = path.join(harness.root, 'tmp', harness.name + '-' + i + '.php'); // 이번 라우터
                fs.mkdirSync(path.dirname(router), { recursive: true }); // 테스트 폴더
                const target = path.join(harness.root, 'apps/php-api/public/index.php').replace(/\\/g, '/').replace(/'/g, "\\'"); // PHP 경로 이스케이프
                fs.writeFileSync(router, "<?php // 고유 테스트 서버\nheader('X-Import-Test: " + nonce + "'); // 서버 신원\nreturn require '" + target + "'; // 실제 API\n"); // 제품 코드 위임
                harness.files.push(router); harness.urls.push('http://127.0.0.1:' + port); // 검사 주소
                const log = fs.openSync(path.join(harness.root, 'tmp', harness.name + '-' + i + '.log'), 'w'); // 오류 기록
                const server = spawn(process.env.PHP_BIN || 'C:/xampp/php/php.exe', ['-d', 'upload_max_filesize=6M', '-d', 'post_max_size=6M', '-d', 'memory_limit=192M', '-S', '127.0.0.1:' + port, '-t', 'apps/frontend/public', router], { cwd: harness.root, stdio: ['ignore', log, log], env: { ...process.env, DB_NAME: harness.name, DB_HOST: options.host, DB_PORT: String(options.port), DB_USER: options.user, DB_PASS: options.password, COOKIE_SECURE: '0', USER_SESSION_COOKIE: 'tc_user_session', RATE_LIMIT: '10000', RATE_WINDOW: '60', UPLOAD_DIR: path.join(harness.root, 'tmp', harness.name + '-uploads') } }); // 독립 실제 서버
                fs.closeSync(log); harness.servers.push(server); // 정리 소유
                let error = null; server.once('error', (value) => error = value); // 시작 실패
                let ready = false; // 신원 확인
                for (let attempt = 0; attempt < 60; attempt += 1) // 짧은 준비 확인
                { // 서버 검사
                    if (error || server.exitCode !== null) // 시작 실패
                    { // 중단
                        throw error || new Error('PHP 시작 실패'); // 다른 서버에 POST 금지
                    } // 중단 끝
                    try // 읽기 전용 확인
                    { // health 요청
                        const res = await fetch(harness.urls[i] + '/api/health'); // 상태만 읽기
                        if (res.headers.get('x-import-test') !== nonce) // 포트 양도 경쟁
                        { // 다른 서버 거부
                            throw new Error('FOREIGN_IMPORT_SERVER'); // 변경 요청 전에 중단
                        } // 다른 서버 거부 끝
                        ready = res.ok; // 실제 서버
                    } // health 끝
                    catch (failure) // 연결 준비 또는 신원 오류
                    { // 오류 분류
                        if (failure.message === 'FOREIGN_IMPORT_SERVER') // 다른 서버
                        { // 즉시 중단
                            throw failure; // 재사용 금지
                        } // 중단 끝
                    } // 분류 끝
                    if (ready) // 서버 확인
                    { // 준비 완료
                        break; // 다음 서버
                    } // 준비 완료 끝
                    await new Promise((resolve) => setTimeout(resolve, 50)); // 시작 대기
                } // 서버 검사 끝
                if (!ready) // 시간 초과
                { // 준비 실패
                    throw new Error('PHP 준비 시간 초과'); // 명확한 실패
                } // 준비 실패 끝
            } // 서버 준비 끝
            return harness; // 두 서버와 DB
        } // 환경 준비 끝
        catch (error) // 준비 실패
        { // 자원 정리
            await harness.close(); throw error; // 실패 전달
        } // 자원 정리 끝
    } // 준비 끝
    async request(method, route, body, cookie = '', index = 0, mutationHeader = true) // 실제 HTTP
    { // 요청 시작
        if (method === 'GET') // 본문 없는 조회
        { // 조회 정리
            body = undefined; // fetch 조회 계약
        } // 조회 정리 끝
        const headers = { Cookie: cookie }; // 테스트 쿠키
        if (mutationHeader) // 정상 보호 헤더
        { // 헤더 추가
            headers['X-TaskCanvas'] = '1'; // CSRF 보호
        } // 헤더 추가 끝
        const form = body instanceof FormData; // 실제 multipart
        if (body !== undefined && !form) // JSON 요청
        { // 본문 형식
            headers['Content-Type'] = 'application/json'; // 정상 JSON
        } // 본문 형식 끝
        const response = await fetch(this.urls[index] + route, { method, headers, body: body === undefined ? undefined : form ? body : JSON.stringify(body), signal: AbortSignal.timeout(30000) }); // 실제 API
        const text = await response.text(); let data = null; // 응답 읽기
        try // JSON 해석
        { // 본문 검사
            data = JSON.parse(text); // 제품 응답
        } // 본문 검사 끝
        catch (_) // 손상 응답
        { // 오류 자료
            data = null; // 테스트에서 상태·본문 검사
        } // 오류 자료 끝
        const cookies = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; '); // 세션 갱신
        return { status: response.status, data, text, cookie: cookies, headers: response.headers }; // 독립 검증 자료
    } // 요청 끝
    async close() // 이번 실행의 자원만 정리
    { // 정리 시작
        for (const server of this.servers) // 고유 PHP 서버
        { // 프로세스 해제
            if (server.pid && server.exitCode === null && server.signalCode === null) // 실행 중인 서버
            { // 종료 대기
                const stopped = new Promise((resolve) => server.once('exit', resolve)); server.kill(); await stopped; // DB 연결 해제
            } // 종료 대기 끝
        } // 프로세스 해제 끝
        if (this.db) // 테스트 연결
        { // 연결 종료
            await this.db.end(); // 잠금 해제
        } // 연결 종료 끝
        if (this.created) // 이번 DB
        { // 고유 DB 정리
            await this.admin.query('DROP DATABASE `' + this.name + '`'); // 운영 DB 보존
        } // 고유 DB 정리 끝
        for (const file of this.files) // 정확한 라우터
        { // 파일 정리
            fs.unlinkSync(file); // 이번 파일만 제거
        } // 파일 정리 끝
        await this.admin.end(); // 관리 연결 해제
    } // 정리 끝
} // 하네스 끝
module.exports = ImportHarness; // 테스트 공개
