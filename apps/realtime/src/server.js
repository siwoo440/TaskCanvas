// TaskCanvas Socket.IO 실시간 서버 진입점
'use strict';

const http = require('http'); // HTTP 서버
const { Server } = require('socket.io'); // Socket.IO
const env = require('./env'); // 설정 값
const db = require('./db'); // DB 연결 확인용
const boardHandler = require('./handlers/board'); // 보드 참여
const cursorHandler = require('./handlers/cursor'); // 커서 중계
const strokeHandler = require('./handlers/stroke'); // 펜 중계·저장
const objectHandler = require('./handlers/object'); // 객체 생성
const editHandler = require('./handlers/edit'); // 잠금·이동·삭제
const taskHandler = require('./handlers/task'); // 공유 업무(P1)
const linkHandler = require('./handlers/link'); // 연결선(P1)
const locks = require('./locks'); // 잠금 만료 검사
const boards = require('./boards'); // 보드 삭제·이름 변경 감시
const origin = require('./origin'); // 접속 출처 검사

const httpServer = http.createServer((req, res) =>
{
    if (req.url === '/health')
    {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); // 상태 응답 헤더
        res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() })); // 상태 응답
        return;
    }
    res.writeHead(404); // 그 외 경로
    res.end();
}); // 상태 확인용 HTTP 서버

const io = new Server(httpServer, {
    cors: (req, callback) => callback(null, { origin: origin.isAllowed(req.headers.origin, req.headers.host) }), // 폴링 응답의 CORS 헤더는 허용한 출처에만 붙임
    allowRequest: (req, callback) => callback(null, origin.isAllowed(req.headers.origin, req.headers.host)), // 웹소켓을 포함한 모든 새 연결 요청의 출처 검사(거부 시 403)
    maxHttpBufferSize: 1e6, // 이벤트당 최대 1MB
}); // Socket.IO 서버

io.on('connection', (socket) =>
{
    boardHandler.register(io, socket); // board:join·disconnect
    cursorHandler.register(io, socket); // cursor:move
    strokeHandler.register(io, socket); // stroke:preview·commit
    objectHandler.register(io, socket); // object:create
    editHandler.register(io, socket); // object:lock·preview·commit·delete·unlock
    taskHandler.register(io, socket); // task:create·update
    linkHandler.register(io, socket); // link:create·update·delete
});

async function start()
{
    await db.one('SELECT 1'); // DB 연결 확인
    locks.startSweeper(io); // 만료 잠금 정리 시작
    boards.startWatcher(io); // 보드 삭제·이름 변경 감시 시작
    const port = env.int('PORT'); // 수신 포트
    httpServer.listen(port, '0.0.0.0', () =>
    {
        console.log('TaskCanvas 실시간 서버 시작: 포트 ' + port + ', 접속 출처 ' + origin.describe()); // 시작 로그
    });
}

start().catch((err) =>
{
    console.error('서버 시작 실패', err); // 시작 실패 로그
    process.exit(1); // 비정상 종료
});
