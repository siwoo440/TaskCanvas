// 현재 세션의 참여 작업실 중에서 선택 대상을 결정
'use strict'; // 엄격한 문법 검사

class WorkspaceSelection
{
    static choose(projects, preferredId, storedId)
    {
        if (!Array.isArray(projects) || projects.length === 0) // 서버 멤버십 목록 확인
        {
            return null; // 참여 작업실 없음
        }
        for (const projectId of [preferredId, storedId]) // 요청한 작업실을 기억된 번호보다 우선
        {
            if (!Number.isSafeInteger(projectId) || projectId <= 0) // 잘못된 번호 제외
            {
                continue; // 다음 후보 검사
            }
            const chosen = projects.find((project) => project.project_id === projectId); // 멤버십에 속한 항목만 선택
            if (chosen)
            {
                return chosen; // 인증된 작업실 반환
            }
        }
        return projects[0]; // 저장된 번호가 없으면 첫 작업실
    }
}

if (typeof module !== 'undefined' && module.exports) // Node.js 단위 테스트 지원
{
    module.exports = WorkspaceSelection; // 테스트 모듈 공개
}
