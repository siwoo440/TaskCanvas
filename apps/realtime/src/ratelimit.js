// 실시간 이벤트 요청 제한: 연결마다 "저장 요청"과 "중계 요청" 두 개의 통(토큰 버킷)을 두고, 통이 비면 거절하거나 버린다
// 통은 burst 개까지 차 있다가 요청마다 하나씩 줄고, 1초에 perSec 개씩 다시 찬다. 한꺼번에 몰리는 정상 작업(여러 객체 함께 이동)은 통과시키고 계속 쏟아지는 요청만 막는다
'use strict';

const env = require('./env'); // 설정 값

const RELAY = new Set(['stroke:preview', 'object:preview']); // 저장하지 않고 다른 참여자에게 전달만 하는 이벤트(넘치면 조용히 버림)
const FREE = new Set(['cursor:move']); // 따로 빈도 제한이 있는 이벤트(커서는 handlers/cursor.js 가 약 30Hz 로 제한)
const LOG_EVERY_MS = 10000; // 같은 연결의 제한 로그는 이 간격으로만 남김

function bucket(burst, perSec)
{
    return { tokens: burst, at: Date.now(), burst, perSec }; // 가득 찬 통
}

// 통에서 하나를 꺼낸다. 비어 있으면 false. burst 가 0 이하면 제한하지 않는다
function take(b, now)
{
    if (b.burst <= 0)
    {
        return true; // 제한 없음(설정으로 끔)
    }
    b.tokens = Math.min(b.burst, b.tokens + (now - b.at) * b.perSec / 1000); // 지난 시간만큼 다시 채움
    b.at = now; // 채운 시각
    if (b.tokens < 1)
    {
        return false; // 통이 비었음
    }
    b.tokens -= 1; // 하나 사용
    return true;
}

function attach(socket)
{
    const save = bucket(env.int('RATE_SAVE_BURST'), env.int('RATE_SAVE_PER_SEC')); // 응답을 돌려주는 요청(참여·잠금·저장·삭제·업무·체크리스트·연결선·선택 알림·점검)
    const relay = bucket(env.int('RATE_RELAY_BURST'), env.int('RATE_RELAY_PER_SEC')); // 미리보기 중계
    let loggedAt = 0; // 마지막으로 로그를 남긴 시각

    socket.use((packet, next) =>
    {
        const event = packet[0]; // 이벤트 이름
        if (FREE.has(event))
        {
            return next(); // 자체 제한이 있는 이벤트
        }
        const now = Date.now(); // 현재 시각
        if (take(RELAY.has(event) ? relay : save, now))
        {
            return next(); // 통에 여유가 있음
        }
        if (now - loggedAt > LOG_EVERY_MS)
        {
            loggedAt = now; // 로그 시각 기록
            console.warn('요청 제한: guest=' + (socket.data.guestId ?? '미참여') + ' event=' + event); // 운영자가 볼 수 있게 가끔만 남김
        }
        const ack = packet[packet.length - 1]; // 응답 콜백(있을 때만)
        if (!RELAY.has(event) && typeof ack === 'function')
        {
            ack({ ok: false, error: { code: 'RATE_LIMITED', message: '요청이 너무 잦습니다. 잠시 후 다시 시도하세요.' } }); // 거절 응답(처리하지 않음)
        }
    }); // next 를 부르지 않으면 그 요청은 처리되지 않고 버려진다
}

module.exports = { attach };
