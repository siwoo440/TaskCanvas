// TaskCanvas Socket.IO 실시간 서버 진입점
'use strict';

const http = require('http'); // HTTP 서버
const { Server } = require('socket.io'); // Socket.IO
const env = require('./env'); // 설정 값
const db = require('./db'); // DB 연결 확인용
const boardHandler = require('./handlers/board'); // 보드 참여
const cursorHandler = require('./handlers/cursor'); // 커서 중계
const strokeHandler = require('./handlers/stroke'); // 펜 중계·저장

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
    cors: { origin: env.get('CORS_ORIGIN') === '*' ? true : env.get('CORS_ORIGIN').split(',') }, // 브라우저 출처 허용
    maxHttpBufferSize: 1e6, // 이벤트당 최대 1MB
}); // Socket.IO 서버

io.on('connection', (socket) =>
{
    boardHandler.register(io, socket); // board:join·disconnect
    cursorHandler.register(io, socket); // cursor:move
    strokeHandler.register(io, socket); // stroke:preview·commit
});

async function start()
{
    await db.one('SELECT 1'); // DB 연결 확인
    const port = env.int('PORT'); // 수신 포트
    httpServer.listen(port, '0.0.0.0', () =>
    {
        console.log('TaskCanvas 실시간 서버 시작: 포트 ' + port); // 시작 로그
    });
}

start().catch((err) =>
{
    console.error('서버 시작 실패', err); // 시작 실패 로그
    process.exit(1); // 비정상 종료
});
