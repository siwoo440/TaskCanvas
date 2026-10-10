// Socket.IO 연결 관리: 티켓으로 보드 참여(또는 작업실 연결), 재접속 시 자동 재참여
'use strict';

class Realtime
{
    constructor(url, handlers)
    {
        this.url = url; // 실시간 서버 주소
        this.handlers = handlers; // 이벤트 콜백 모음
        this.socket = null; // 현재 소켓
        this.boardId = null; // 참여 중인 보드
        this.projectId = null; // 작업실 연결이면 프로젝트 ID(보드 연결이면 null)
        this.joined = false; // 참여 완료 여부
        this.joinedOnce = false; // 이 연결에서 참여한 적이 있는지(재접속 판별)
        this.refusedShown = false; // 첫 연결 거부 안내를 이미 했는지
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

    join(boardId)
    {
        this.leave(); // 이전 연결 정리
        this.boardId = boardId; // 보드 기록
        this.open(); // 연결 시작
    }

    // 작업실 연결: 보드에 들어가지 않고 프로젝트의 공유 업무 생성·변경만 주고받는다
    watchProject(projectId)
    {
        this.leave(); // 이전 연결 정리
        this.projectId = projectId; // 프로젝트 기록
        this.open(); // 연결 시작
    }

    open()
    {
        this.socket = window.io(this.url, { transports: ['websocket', 'polling'] }); // 소켓 생성
        const socket = this.socket; // 지역 참조

        socket.on('connect', () => this.authenticate(socket)); // 연결(재연결 포함) 시 참여 절차
        socket.on('disconnect', () =>
        {
            this.joined = false; // 참여 해제
            this.handlers.onStatus('reconnecting'); // 재접속 중 표시
        });
        socket.io.on('reconnect_failed', () => this.handlers.onStatus('offline')); // 재접속 포기
        socket.on('connect_error', () =>
        {
            if (socket === this.socket && !this.joinedOnce && !this.refusedShown)
            {
                this.refusedShown = true; // 다시 시도할 때마다 반복해서 띄우지 않음
                this.handlers.onRefused(); // 한 번도 연결되지 못함: 서버가 꺼져 있거나 이 주소의 접속을 허용하지 않음
            }
        });
        socket.on('presence:update', (data) => this.handlers.onPresence(data.participants)); // 참여자 갱신
        socket.on('cursor:move', (data) => this.handlers.onCursor(data)); // 타인 커서
        socket.on('selection:update', (data) => this.handlers.onSelection(data)); // 타인 선택
        socket.on('stroke:preview', (data) => this.handlers.onStrokePreview(data)); // 타인 펜 미리보기
        socket.on('object:created', (data) => this.handlers.onObjectCreated(data.object, data.guest_id)); // 확정 객체
        socket.on('object:locked', (data) => this.handlers.onObjectLocked(data)); // 타인 잠금
        socket.on('object:unlocked', (data) => this.handlers.onObjectUnlocked(data)); // 잠금 해제
        socket.on('object:preview', (data) => this.handlers.onObjectPreview(data)); // 타인 이동 중
        socket.on('object:updated', (data) => this.handlers.onObjectUpdated(data.object, data.guest_id)); // 타인 변경 확정
        socket.on('object:deleted', (data) => this.handlers.onObjectDeleted(data.object_id, data.guest_id)); // 타인 삭제
        socket.on('task:created', (data) => this.handlers.onTaskCreated(data.task, data.guest_id)); // 공유 업무 생성
        socket.on('task:updated', (data) => this.handlers.onTaskUpdated(data.task, data.guest_id)); // 공유 업무 변경
        socket.on('link:created', (data) => this.handlers.onLinkCreated(data.link, data.guest_id)); // 연결선 생성
        socket.on('link:updated', (data) => this.handlers.onLinkUpdated(data.link, data.guest_id)); // 연결선 라벨 변경
        socket.on('link:deleted', (data) => this.handlers.onLinkDeleted(data.link_id, data.guest_id)); // 연결선 삭제
        socket.on('board:renamed', (data) => this.handlers.onBoardRenamed(data)); // 작업실에서 보드 이름이 바뀜
        socket.on('board:deleted', (data) => this.handlers.onBoardDeleted(data)); // 작업실에서 보드가 삭제됨
    }

    async authenticate(socket)
    {
        const wasJoined = this.joinedOnce === true; // 이전 참여 이력
        try
        {
            const scope = this.projectId !== null ? { project_id: this.projectId } : { board_id: this.boardId }; // 참여할 범위(작업실 또는 보드)
            const ticket = await this.handlers.getTicket(scope); // PHP 에서 일회성 티켓 발급
            if (socket !== this.socket)
            {
                return; // 그 사이 다른 보드로 이동
            }
            const reply = await this.request(this.projectId !== null ? 'project:join' : 'board:join', { ...scope, ticket }); // 작업실 연결 또는 보드 참여
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
                    reject(Object.assign(new Error(error.message), { code: error.code, locked_by: error.locked_by ?? null, object: reply && reply.object ? reply.object : null, task: reply && reply.task ? reply.task : null })); // 실패(잠금 소유자·최신 객체·최신 업무 포함)
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
        this.refusedShown = false; // 다음 연결에서는 다시 안내
        this.boardId = null; // 보드 비움
        this.projectId = null; // 프로젝트 비움
    }
}

window.Realtime = Realtime; // 전역 노출
