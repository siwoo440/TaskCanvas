'use strict'; // 엄격한 검사
const assert = require('assert/strict'); // 독립 기대값
const auth = require('../src/auth'); // 실제 인증 경계
const db = require('../src/db'); // 조회 경계
const guard = require('../src/session-guard'); // 제품 패킷 가드
const original = { valid: auth.validSession, role: auth.currentRole, one: db.one }; // 원본 복구점
async function main() // 역할 변경 연결 정리
{ // 검사 시작
    let handler = null; let advanced = false; let closed = false; let reply = null; // 경계 관찰
    const socket = { connected: true, data: { projectId: 1, guestId: 2, guestSessionId: 3, role: 'admin' }, use: (callback) => handler = callback, emit() {}, disconnect: () => closed = true }; // 네트워크 대역
    auth.validSession = async () => true; auth.currentRole = async () => 'viewer'; db.one = async () => ({ project_id: 1 }); // 유효 세션의 강등 재현
    guard.register({}, socket); // 실제 미들웨어
    await handler(['object:create', {}, (value) => reply = value], () => advanced = true); // 강등 뒤 편집 시도
    assert.equal(advanced, false); assert.equal(closed, true); assert.equal(reply.error.code, 'SESSION_EXPIRED'); // 이전 권한 연결 차단
    console.log('PASS 역할 변경 시 이전 연결의 패킷 차단·오류 ACK·연결 해제'); // 결과
} // 검사 끝
main().catch((error) => // 실패 보고
{ // 오류 처리
    console.error(error); process.exitCode = 1; // 실제 실패
}).finally(async () => // 공유 경계 복구
{ // 복구 시작
    auth.validSession = original.valid; auth.currentRole = original.role; db.one = original.one; // 제품 원본
    await db.pool.end(); // 검사 풀 정리
}); // 복구 끝
