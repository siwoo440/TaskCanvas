'use strict'; // 엄격한 문법 검사
const http = require('http'); // 기존 서버 역할의 가상 서버
const path = require('path'); // 인증 테스트 경로
const { spawn } = require('child_process'); // 실제 테스트 실행

async function main() // 포트 충돌 시 쓰기 요청 차단 검증
{ // 포트 검증 시작
    let mutations = 0; // 가상 기존 서버에 도착한 변경 요청 수
    const existing = http.createServer((request, response) => // 실제 DB 없는 기존 서버 모사
    { // 가상 응답 시작
        if (request.method !== 'GET') // 상태 조회 이외의 요청
        { // 잘못된 대상 요청 기록
            mutations += 1; // 변경 요청 횟수
        } // 요청 기록 끝
        request.resume(); // 요청 본문 비우기
        response.statusCode = request.url === '/api/health' ? 200 : request.url === '/api/auth/me' ? 401 : request.headers['x-taskcanvas'] ? 400 : 403; // 기존 정상 서버처럼 상태 응답
        response.setHeader('Content-Type', 'application/json'); // JSON 형식
        response.end(JSON.stringify({ status: 'ok', db: true, error: { message: '포트 충돌 검증' } })); // 가상 결과
    }); // 가상 서버 생성 끝
    await new Promise((resolve) => existing.listen(0, '127.0.0.1', resolve)); // 가용 포트를 미리 점유
    try // 점유된 포트로 인증 테스트 실행
    { // 충돌 검사 시작
        const child = spawn(process.execPath, [path.join(__dirname, 'test-member-auth.js')], { env: { ...process.env, AUTH_TEST_PORT: String(existing.address().port) }, stdio: 'ignore' }); // 점유 포트 지정
        const exitCode = await new Promise((resolve, reject) => // 테스트 종료 관찰
        { // 종료 관찰 시작
            child.once('error', reject); // 실행 실패 전달
            child.once('exit', resolve); // 정상 종료 코드 수신
        }); // 종료 관찰 끝
        if (exitCode === 0 || mutations !== 0) // 안전한 실패 여부 확인
        { // 위험 요청 보고 시작
            throw new Error('포트 충돌 시 기존 서버로 보낸 변경 요청: ' + mutations); // 잘못된 서버 대상 변경 검출
        } // 위험 요청 보고 끝
        console.log('PASS 점유된 포트에서 즉시 중단, 기존 서버 변경 요청 0개'); // 검증 결과
    } // 충돌 검사 끝
    finally // 가상 서버 정리
    { // 서버 정리 시작
        existing.closeAllConnections(); // 남은 가상 연결 정리
        await new Promise((resolve) => existing.close(resolve)); // 점유 포트 반환
    } // 서버 정리 끝
} // 포트 검증 끝

main().catch((error) => // 최종 오류 처리
{ // 실패 보고 시작
    console.error('FAIL ' + error.message); // 검증 원인
    process.exitCode = 1; // 실패 종료 코드
}); // 실패 보고 끝
