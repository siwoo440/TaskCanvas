// 접속 출처 검사: 브라우저가 보낸 Origin 헤더로, 이 실시간 서버에 붙어도 되는 페이지인지 판단한다
'use strict';

const env = require('./env'); // 설정 값

const setting = env.get('CORS_ORIGIN').trim(); // auto | * | 쉼표로 나눈 출처 목록
const mode = setting === '*' ? 'any' : (setting === '' || setting.toLowerCase() === 'auto') ? 'same-host' : 'list'; // 검사 방식
const allowList = mode === 'list' ? setting.split(',').map(normalize).filter((v) => v !== '') : []; // 허용 출처 목록

function normalize(origin)
{
    return String(origin).trim().replace(/\/+$/, '').toLowerCase(); // 끝 슬래시·대소문자 차이 제거
}

function hostnameOf(value)
{
    try
    {
        return new URL(value.includes('://') ? value : 'http://' + value).hostname.toLowerCase(); // 포트를 뺀 호스트 이름
    }
    catch (err)
    {
        return ''; // 해석할 수 없는 값
    }
}

// origin: 요청의 Origin 헤더(브라우저가 아닌 클라이언트는 없음), host: 요청의 Host 헤더(브라우저가 이 서버에 접속한 주소)
function isAllowed(origin, host)
{
    if (!origin)
    {
        return true; // 출처 없음 = 브라우저가 아닌 클라이언트(테스트 스크립트). 다른 사이트의 페이지가 아니므로 통과시키고 티켓 검증은 그대로 적용
    }
    if (mode === 'any')
    {
        return true; // CORS_ORIGIN=* : 모든 출처 허용(개발용)
    }
    if (mode === 'list')
    {
        return allowList.includes(normalize(origin)); // 목록에 적은 출처만
    }
    const pageHost = hostnameOf(String(origin)); // 페이지가 열린 호스트
    return pageHost !== '' && pageHost === hostnameOf(String(host ?? '')); // 실시간 서버와 같은 호스트에서 열린 페이지만(포트는 달라도 됨)
}

function describe()
{
    return mode === 'any' ? '모든 출처 허용(*)' : mode === 'list' ? '목록 ' + allowList.join(', ') : '이 서버와 같은 호스트의 페이지만(auto)'; // 시작 로그용 설명
}

module.exports = { isAllowed, describe, mode };
