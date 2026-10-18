'use strict'; // 엄격한 문법
const auth = require('./auth'); // 공통 세션 확인
function close(socket, ack) // 무효 연결 정리
{ // 해제 시작
    const error = { code: 'SESSION_EXPIRED', message: '접속 권한이 만료되었습니다. 로그인 또는 작업실을 다시 선택하세요.' }; // 재인증 안내
    if (typeof ack === 'function') // 응답 가능한 요청
    { // 오류 응답
        ack({ ok: false, error }); // 인증 오류 전달
    } // 응답 끝
    socket.emit('auth:expired', error); // 유휴 화면에도 알림
    socket.disconnect(true); // 방·참여자·잠금 정리
} // 해제 끝
async function valid(socket) // 활성 연결 검사
{ // 검사 시작
    return auth.validSession(socket.data.guestSessionId, socket.data.guestId, socket.data.projectId); // 발급 세션과 역할 소유
} // 검사 끝
function register(io, socket) // 수신 이벤트 인증
{ // 등록 시작
    socket.use(async (packet, next) => // 모든 수신 패킷
    { // 패킷 검사
        const event = packet[0]; // 이벤트 이름
        const ack = typeof packet[packet.length - 1] === 'function' ? packet[packet.length - 1] : null; // 선택 ACK
        if (!socket.data.projectId) // 참여 전 연결
        { // 초기 티켓 경로
            if (event === 'board:join' || event === 'project:join') // 최초 참여
            { // 병렬 참여 방지
                if (socket.data.joinPending) // 이미 티켓 처리 중
                { // 중복 거부
                    if (ack) // 응답 함수
                    { // 중복 응답
                        ack({ ok: false, error: { code: 'ALREADY_JOINED', message: '참여 요청을 처리 중입니다.' } }); // 연결 범위 변경 차단
                    } // 응답 끝
                    return; // 중복 이벤트 중단
                } // 중복 검사 끝
                socket.data.joinPending = true; // 초기 참여 직렬화
            } // 초기 참여 끝
            return next(); // 티켓 검증 핸들러로 전달
        } // 초기 경로 끝
        try // 세션 DB 조회
        { // 인증 검사
            if (await valid(socket)) // 현재 유효한 소유와 세션
            { // 허용 경로
                return next(); // 기존 역할 검사로 전달
            } // 허용 끝
        } // DB 검사 끝
        catch (error) // DB 조회 실패
        { // 오류 기록
            console.error('실시간 세션 확인 실패', error.message); // 운영 오류
        } // 오류 기록 끝
        close(socket, ack); // 무효·조회 실패 모두 차단
    }); // 가드 등록 끝
} // 등록 끝
function startWatcher(io) // 유휴 연결 인증 감시
{ // 감시 시작
    let running = false; // 주기 중첩 방지
    const timer = setInterval(async () => // 고정 인증 주기
    { // 감시 실행
        if (running) // 이전 검사 진행 중
        { // 중복 주기
            return; // 중첩 생략
        } // 중복 검사 끝
        running = true; // 실행 상태
        try // 활성 소켓 검사
        { // 소켓 순회
            for (const socket of io.sockets.sockets.values()) // 현재 연결 목록
            { // 개별 검사
                if (!socket.data.projectId) // 참여 전 연결
                { // 대상 제외
                    continue; // 수신 방 없는 연결
                } // 제외 끝
                let allowed = false; // 기본 접근 거부
                try // 개별 DB 검사
                { // 인증 조회
                    allowed = await valid(socket); // 세션 유효성
                } // 조회 끝
                catch (error) // DB 장애
                { // 오류 기록
                    console.error('실시간 인증 감시 실패', error.message); // 실패 원인
                } // 오류 끝
                if (!allowed && socket.connected) // 무효한 활성 연결
                { // 강제 정리
                    close(socket); // 수신 방에서 제거
                } // 정리 끝
            } // 개별 검사 끝
        } // 순회 끝
        finally // 실행 상태 복구
        { // 복구 시작
            running = false; // 다음 검사 허용
        } // 복구 끝
    }, 1000); // 1초 감시 간격
    timer.unref(); // 서버 종료 방해 방지
    return timer; // 테스트 정리 핸들
} // 감시 끝
module.exports = { register, startWatcher }; // 공통 가드 내보내기
