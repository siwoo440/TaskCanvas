// 소개 화면 하단 문구 검증
'use strict'; // 엄격한 문법 검사
const test = require('node:test'); // 기본 테스트 실행기
const assert = require('node:assert/strict'); // 엄격한 결과 비교
const fs = require('node:fs'); // 파일 읽기 도구
const path = require('node:path'); // 경로 조합 도구
const htmlPath = path.resolve(__dirname, '../../frontend/public/index.html'); // 소개 화면 파일 경로

test('하단에서 기술 구성과 수업 프로젝트 문구를 제거', () => // 하단 문구 제거 검증
{
    const html = fs.readFileSync(htmlPath, 'utf8'); // 소개 화면 내용 읽기
    assert.doesNotMatch(html, /<footer class="site-footer">/); // 빈 하단 영역 부재 확인
    assert.doesNotMatch(html, /TaskCanvas · XAMPP\(Apache·PHP\) \+ Node\.js·Socket\.IO \+ MySQL\/MariaDB 로 만든 웹서버 수업 팀 프로젝트/); // 전체 삭제 문구 부재 확인
}); // 하단 문구 제거 검증 종료
