'use strict'; // 엄격한 문법
const auth = require('../src/auth'); // 인증 경계
const guard = require('../src/session-guard'); // 실제 수신 가드
const original = auth.validSession; // 검사 후 원본 복구
async function run() // DB 장애의 접근 거부 검사
{ // 검사 시작
    let middleware = null; // 등록된 패킷 가드
    let closed = false; // 연결 종료 여부
    let advanced = false; // 제품 핸들러 실행 여부
    let reply = null; // 실제 ACK
    const socket = // 네트워크 경계 대역
    { // 대역 구성
        connected: true, // 살아 있는 연결의 종료 검사
        data: { projectId: 1, guestId: 2, guestSessionId: 3 }, // 인증된 연결 범위
        use: (handler) => // 패킷 검사 등록
        { // 등록 시작
            middleware = handler; // 실제 가드 보관
        }, // 등록 끝
        emit: () => // 화면 알림 경계
        { // 알림 대역
            return; // 네트워크 전송 제외
        }, // 알림 끝
        disconnect: () => // 연결 종료 경계
        { // 종료 기록
            closed = true; // 해제 관측
        }, // 종료 끝
    }; // 대역 구성 끝
    auth.validSession = async () => // DB 장애 재현
    { // 장애 응답
        throw new Error('test-only-database-unavailable'); // 인증 저장소 실패
    }; // 대역 끝
    guard.register({}, socket); // 실제 가드 등록
    const acknowledge = (value) => // ACK 관측
    { // 결과 보관
        reply = value; // 응답 저장
    }; // 관측 끝
    const next = () => // 제품 핸들러 경계
    { // 실행 기록
        advanced = true; // 접근 통과 관측
    }; // 기록 끝
    await middleware(['object:create', {}, acknowledge], next); // 변경 패킷 전달
    if (!closed || advanced || reply?.error?.code !== 'SESSION_EXPIRED') // 접근 허용 여부
    { // 실패 보고
        throw new Error('DB 장애 시 이벤트 접근이 차단되지 않았습니다.'); // 보안 회귀
    } // 결과 검사 끝
    console.log('PASS 인증 DB 장애 시 ACK 오류·핸들러 미실행·연결 해제'); // 의미 있는 경계 검증
} // 검사 끝
run().catch((error) => // 검사 실패
{ // 오류 결과
    console.error(error.message); // 원인 출력
    process.exitCode = 1; // 실패 코드
}).finally(async () => // 검사 자원 복원
{ // 복원 시작
    auth.validSession = original; // 실제 인증 복구
    await require('../src/db').pool.end(); // 지연 생성 풀 정리
}); // 복원 끝
