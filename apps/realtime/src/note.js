// 메모(스티키 노트)·텍스트 객체의 글과 스타일 검증 (object:create 와 object:commit 이 함께 사용)
'use strict';

const HEX = /^#[0-9a-fA-F]{6}$/; // 색상 형식
const MAX_TEXT = 2000; // 메모 한 개의 최대 글자 수

// 글 정리: 줄바꿈을 \n 으로 통일하고 제어 문자를 지운다(탭·줄바꿈은 유지). 문자열이 아니거나 너무 길면 null
function cleanText(value)
{
    if (value === undefined || value === null)
    {
        return ''; // 글 없음
    }
    if (typeof value !== 'string')
    {
        return null; // 형식 오류
    }
    const text = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''); // 줄바꿈 통일·제어 문자 제거
    return text.length > MAX_TEXT ? null : text; // 길이 제한
}

function cleanNoteStyle(style)
{
    const s = style && typeof style === 'object' ? style : {}; // 객체 보정
    return {
        fill: typeof s.fill === 'string' && HEX.test(s.fill) ? s.fill : null, // 배경 색(없으면 배경 없는 텍스트)
        color: typeof s.color === 'string' && HEX.test(s.color) ? s.color : '#222222', // 글자 색
    }; // 메모 스타일
}

module.exports = { MAX_TEXT, cleanText, cleanNoteStyle };
