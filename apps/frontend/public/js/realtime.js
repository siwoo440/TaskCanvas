// Socket.IO 연결 관리: 티켓으로 보드 참여, 재접속 시 자동 재참여
'use strict';

class Realtime
{
    constructor(url, handlers)
    {
        this.url = url; // 실시간 서버 주소
        this.handlers = handlers; // 이벤트 콜백 모음
        this.socket = null; // 현재 소켓
        this.boardId = null; // 참여 중인 보드
        this.joined = false; // 참여 완료 여부
        this.joinedOnce = false; // 이 연결에서 참여한 적이 있는지(재접속 판별)
    }

    static loadClient(url)
    {
        if (window.io)
        {
            return Promise.resolve(); // 이미 로드됨
        }
        return new Promise((resolve, reject) =>
        {
            const script = document.createElement('script'); // 스크립트 태그
            script.src = url + '/socket.io/socket.io.js'; // 실시간 서버가 제공하는 클라이언트
            script.onload = () => resolve(); // 로드 완료
            script.onerror = () => reject(new Error('실시간 서버(' + url + ')에 연결할 수 없습니다.')); // 로드 실패
            document.head.appendChild(script); // 문서에 추가
        });
    }

    async join(boardId)
    {
        this.leave(); // 이전 연결 정리
        this.boardId = boardId; // 보드 기록
        this.socket = window.io(this.url, { transports: ['websocket', 'polling'] }); // 소켓 생성
        const socket = this.socket; // 지역 참조

        socket.on('connect', () => this.authenticate(socket)); // 연결(재연결 포함) 시 참여 절차
        socket.on('disconnect', () =>
        {
            this.joined = false; // 참여 해제
            this.handlers.onStatus('reconnecting'); // 재접속 중 표시
        });
        socket.io.on('reconnect_failed', () => this.handlers.onStatus('offline')); // 재접속 포기
        socket.on('presence:update', (data) => this.handlers.onPresence(data.participants)); // 참여자 갱신
        socket.on('cursor:move', (data) => this.handlers.onCursor(data)); // 타인 커서
        socket.on('stroke:preview', (data) => this.handlers.onStrokePreview(data)); // 타인 펜 미리보기
        socket.on('object:created', (data) => this.handlers.onObjectCreated(data.object, data.guest_id)); // 확정 객체
    }

    async authenticate(socket)
    {
        const wasJoined = this.joinedOnce === true; // 이전 참여 이력
        try
        {
            const ticket = await this.handlers.getTicket(this.boardId); // PHP 에서 일회성 티켓 발급
            if (socket !== this.socket)
            {
                return; // 그 사이 다른 보드로 이동
            }
            const reply = await this.request('board:join', { board_id: this.boardId, ticket }); // 보드 참여
            this.joined = true; // 참여 완료
            this.joinedOnce = true; // 참여 이력 기록
            this.handlers.onStatus('online'); // 연결됨 표시
            this.handlers.onJoined(reply, wasJoined); // 참여 결과 전달(재참여 여부 포함)
        }
        catch (err)
        {
            this.handlers.onStatus('offline'); // 연결 실패 표시
            this.handlers.onJoinError(err); // 오류 전달
        }
    }

    request(event, data)
    {
        return new Promise((resolve, reject) =>
        {
            if (!this.socket || !this.socket.connected)
            {
                return reject(new Error('실시간 서버와 연결되어 있지 않습니다.')); // 미연결
            }
            const timer = setTimeout(() => reject(new Error('서버 응답 시간 초과')), 8000); // 응답 대기 제한
            this.socket.emit(event, data, (reply) =>
            {
                clearTimeout(timer); // 타이머 해제
                if (reply && reply.ok)
                {
                    resolve(reply); // 성공
                }
                else
                {
                    const error = reply && reply.error ? reply.error : { code: 'UNKNOWN', message: '알 수 없는 오류' }; // 오류 정보
                    reject(Object.assign(new Error(error.message), { code: error.code })); // 실패
                }
            }); // ack 포함 전송
        });
    }

    emit(event, data)
    {
        if (this.socket && this.joined)
        {
            this.socket.emit(event, data); // 응답 없는 전송
        }
    }

    leave()
    {
        if (this.socket)
        {
            this.socket.removeAllListeners(); // 콜백 해제
            this.socket.disconnect(); // 연결 종료
        }
        this.socket = null; // 소켓 비움
        this.joined = false; // 참여 해제
        this.joinedOnce = false; // 참여 이력 초기화
        this.boardId = null; // 보드 비움
    }
}

window.Realtime = Realtime; // 전역 노출
