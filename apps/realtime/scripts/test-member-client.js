'use strict'; // 엄격한 문법
const fs = require('fs'); // 실제 화면 코드
const path = require('path'); // 소스 경로
const vm = require('vm'); // 비동기 화면 경계 검사
const frontend = path.resolve(__dirname, '../../frontend/public/js'); // 프런트 코드 위치
class TestEvent // DOM 없는 알림 객체
{ // 이벤트 대역 시작
} // 이벤트 대역 끝
function check(value, message) // 검사 결과
{ // 검사 시작
    if (!value) // 실패 조건
    { // 실패 보고
        throw new Error(message); // 실패 원인
    } // 실패 끝
    console.log('PASS ' + message); // 통과 출력
} // 검사 끝
async function main() // 화면 인증 회귀
{ // 검사 범위
    let expired = 0; // 전역 만료 알림
    let rejectTicket = null; // 지연된 이전 요청
    const window = // 화면 이벤트 경계
    { // 브라우저 대역
        dispatchEvent: () => // 만료 알림 관측
        { // 알림 집계
            expired += 1; // 전체 화면 초기화 횟수
        }, // 관측 끝
    }; // 대역 끝
    const context = vm.createContext({ window, Event: TestEvent, setTimeout, clearTimeout }); // 실제 클래스 실행 환경
    vm.runInContext(fs.readFileSync(path.join(frontend, 'realtime.js'), 'utf8'), context); // 실제 연결 관리 코드
    const handlers = // 네트워크 응답 경계
    { // 콜백 구성
        getTicket: () => new Promise((resolve, reject) => // 이전 티켓 지연
        { // 실패 함수 보관
            rejectTicket = reject; // 다른 작업실 선택 후 응답
        }), // 응답 경계 끝
        onStatus: () => undefined, // 상태 표시 대역
        onJoinError: () => undefined, // 오류 표시 대역
    }; // 콜백 끝
    const client = new window.Realtime('test', handlers); // 실제 관리자
    const oldSocket = { io: { reconnection: () => undefined }, disconnect: () => undefined }; // 이전 연결
    const newSocket = {}; // 새 작업실 연결
    client.socket = oldSocket; // 기존 연결 활성화
    const pending = client.authenticate(oldSocket); // 비동기 티켓 요청
    client.socket = newSocket; // 요청 도중 작업실 교체
    rejectTicket(Object.assign(new Error('old session'), { status: 401 })); // 이전 요청의 늦은 실패
    await pending; // 오류 처리 완료
    check(expired === 0 && client.socket === newSocket, '이전 소켓의 늦은 인증 실패가 새 작업실에 영향 없음'); // 경합 회귀
    const source = fs.readFileSync(path.join(frontend, 'app.js'), 'utf8'); // 실제 앱 이벤트
    const start = source.lastIndexOf("window.addEventListener('focus', async"); // 세션 복귀 검사
    const end = source.indexOf('}); // 복귀 등록 끝', start) + '}); // 복귀 등록 끝'.length; // 독립 이벤트 단위
    let focus = null; // 등록된 실제 핸들러
    let requests = 0; // 서버 재확인 횟수
    let cleared = 0; // 이전 신원 정리 횟수
    let restored = 0; // 서버 상태 복원 횟수
    const guestState = { member: false, guest: { guest_id: 10 }, project: { project_id: 1 } }; // 회원과 공존 중인 미연결 게스트
    const focusWindow = // 탭 복귀 경계
    { // 창 대역
        addEventListener: (name, handler) => // 실제 등록 보관
        { // 핸들러 저장
            focus = handler; // 복귀 이벤트
        }, // 저장 끝
        api: // 서버 신원 경계
        { // 응답 구성
            get: async () => // 다른 탭의 선택 결과
            { // 요청 관측
                requests += 1; // 서버 확인 집계
                return { member: true, guest: { guest_id: 20 }, projects: [] }; // 변경된 쿠키의 회원 게스트
            }, // 응답 끝
        }, // API 대역 끝
    }; // 창 대역 끝
    const clear = () => // 이전 화면 경계
    { // 정리 관측
        cleared += 1; // 이전 신원 폐기
    }; // 정리 끝
    const bootstrap = async () => // 화면 복원 경계
    { // 복원 관측
        restored += 1; // 새 서버 신원 반영
    }; // 복원 끝
    vm.runInNewContext(source.slice(start, end), { window: focusWindow, state: guestState, leaveDeletedWorkspace: clear, bootstrap }); // 실제 복귀 처리
    await focus(); // 독립 게스트 탭 복귀
    check(requests === 1 && cleared === 1 && restored === 1, '미연결 게스트 탭도 다른 탭의 회원 작업실 선택 반영'); // 다중 탭 회귀
} // 검사 끝
main().catch((error) => // 검사 오류
{ // 실패 보고
    console.error('FAIL ' + error.message); // 원인 출력
    process.exitCode = 1; // 실패 코드
}); // 오류 끝
