// 소개 화면의 역할 카드와 캐러셀 화살표 배치 검증
'use strict'; // 엄격한 문법 검사
const test = require('node:test'); // 기본 테스트 실행기
const assert = require('node:assert/strict'); // 엄격한 결과 비교
const puppeteer = require('puppeteer-core'); // 실제 브라우저 렌더링
const { findChrome } = require('./lib/browser-kit'); // 설치 브라우저 탐색
const PAGE_URL = process.env.TC_HOME_URL || 'http://127.0.0.1:8080'; // 검증 대상 주소
let browser = null; // 공유 브라우저 보관

test.before(async () => // 브라우저 시작 준비
{
    browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--lang=ko-KR'] }); // 실제 브라우저 시작
}); // 브라우저 시작 종료

test.after(async () => // 브라우저 종료 준비
{
    if (browser) // 브라우저 존재 확인
    {
        await browser.close(); // 브라우저 자원 정리
    } // 브라우저 존재 확인 종료
}); // 브라우저 종료 종료

async function openHome(width = 1280, height = 900) // 소개 화면 열기
{
    const page = await browser.newPage(); // 독립 검증 탭 생성
    await page.setViewport({ width, height }); // 화면 크기 설정
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' }); // 소개 화면 이동
    await page.waitForSelector('#home-intro:not([hidden])'); // 소개 화면 표시 대기
    return page; // 준비된 탭 반환
} // 소개 화면 열기 종료

test('첫 화면 소개 문구에는 실시간 협업 화이트보드만 표시', async () => // 첫 화면 소개 문구 검증
{
    const page = await openHome(); // 소개 화면 준비
    const eyebrow = await page.$eval('.hero .eyebrow', (element) => element.textContent.trim()); // 첫 화면 소개 문구 수집
    assert.equal(eyebrow, '실시간 협업 화이트보드'); // 불필요한 수업 문구 제거 확인
    await page.close(); // 검증 탭 정리
}); // 첫 화면 소개 문구 검증 종료

test('관리자·편집자·열람자를 일러스트가 있는 세 카드로 표시', async () => // 역할 카드 구성 검증
{
    const page = await openHome(); // 소개 화면 준비
    const roles = await page.$$eval('.role-card', (cards) => cards.map((card) => ({ title: card.querySelector('h3')?.textContent.trim(), source: card.querySelector('img')?.getAttribute('src'), loaded: Boolean(card.querySelector('img')?.complete && card.querySelector('img')?.naturalWidth) }))); // 화면 역할 정보 수집
    assert.deepEqual(roles, [ // 기대 역할 순서 비교
        { title: '관리자', source: 'assets/roles/admin.svg', loaded: true }, // 관리자 카드 기대값
        { title: '편집자', source: 'assets/roles/editor.svg', loaded: true }, // 편집자 카드 기대값
        { title: '열람자', source: 'assets/roles/viewer.svg', loaded: true }, // 열람자 카드 기대값
    ]); // 기대 역할 순서 비교 종료
    await page.close(); // 검증 탭 정리
}); // 역할 카드 구성 검증 종료

test('역할 일러스트의 원본과 표시 영역을 정사각형 비율로 유지', async () => // 역할 그림 비율 검증
{
    const page = await openHome(); // 소개 화면 준비
    const ratios = await page.$$eval('.role-card img', (images) => images.map((image) => // 역할 그림 비율 수집
    {
        const rect = image.getBoundingClientRect(); // 화면 표시 영역 측정
        return { natural: image.naturalWidth / image.naturalHeight, rendered: rect.width / rect.height }; // 원본과 표시 비율 반환
    })); // 역할 그림 비율 수집 종료
    assert.equal(ratios.length, 3); // 역할 그림 세 개 확인
    assert.ok(ratios.every((ratio) => Math.abs(ratio.natural - 1) <= 0.01), '원본 비율: ' + ratios.map((ratio) => ratio.natural).join(', ')); // 원본 정사각형 확인
    assert.ok(ratios.every((ratio) => Math.abs(ratio.rendered - 1) <= 0.01), '표시 비율: ' + ratios.map((ratio) => ratio.rendered).join(', ')); // 표시 정사각형 확인
    await page.close(); // 검증 탭 정리
}); // 역할 그림 비율 검증 종료

test('역할 일러스트의 중심과 시각 크기를 동일한 안전 영역에 배치', async () => // 역할 그림 균형 검증
{
    const page = await openHome(); // 소개 화면 준비
    const bounds = await page.$$eval('.role-card img', async (images) => // 역할 그림 경계 수집
    {
        const results = []; // 역할별 경계 보관
        for (const image of images) // 역할 그림 순회
        {
            const source = await (await fetch(image.src)).text(); // SVG 원문 조회
            const documentNode = new DOMParser().parseFromString(source, 'image/svg+xml'); // SVG 문서 변환
            const svg = documentNode.documentElement; // SVG 루트 선택
            svg.style.position = 'fixed'; // 화면 밖 측정 위치
            svg.style.left = '-1000px'; // 화면 밖 가로 위치
            svg.style.width = '160px'; // 측정 너비
            svg.style.height = '160px'; // 측정 높이
            document.body.appendChild(document.importNode(svg, true)); // 측정용 SVG 추가
            const mountedSvg = document.body.lastElementChild; // 추가된 SVG 선택
            const symbol = mountedSvg.querySelector('#role-symbol'); // 역할 도형 묶음 선택
            if (!symbol) // 역할 도형 묶음 부재 확인
            {
                results.push(null); // 누락 결과 저장
            }
            else // 역할 도형 묶음 존재 확인
            {
                const box = symbol.getBBox(); // 실제 도형 경계 측정
                results.push({ centerX: box.x + box.width / 2, centerY: box.y + box.height / 2, maxSize: Math.max(box.width, box.height) }); // 중심과 최대 크기 저장
            }
            mountedSvg.remove(); // 측정용 SVG 제거
        }
        return results; // 역할별 경계 반환
    }); // 역할 그림 경계 수집 종료
    assert.ok(bounds.every(Boolean), '역할 도형 묶음 누락'); // 역할 도형 묶음 존재 확인
    assert.ok(bounds.every((box) => Math.abs(box.centerX - 80) <= 4 && Math.abs(box.centerY - 80) <= 4), '중심 좌표: ' + JSON.stringify(bounds)); // 정중앙 배치 확인
    assert.ok(bounds.every((box) => box.maxSize >= 120 && box.maxSize <= 145), '최대 크기: ' + bounds.map((box) => box.maxSize).join(', ')); // 시각 크기 범위 확인
    await page.close(); // 검증 탭 정리
}); // 역할 그림 균형 검증 종료

test('역할 그림은 그라데이션과 그림자가 없는 평면 SVG로 표시', async () => // 평면 그림 검증
{
    const page = await openHome(); // 소개 화면 준비
    const sources = await page.$$eval('.role-card img', (images) => images.map((image) => image.src)); // 역할 그림 주소 수집
    assert.equal(sources.length, 3); // 역할 그림 세 개 확인
    const sourceTexts = {}; // 역할별 SVG 원문 보관
    for (const source of sources) // 역할 그림 순회
    {
        const sourceText = await page.evaluate(async (url) => await (await fetch(url)).text(), source); // SVG 원문 조회
        assert.doesNotMatch(sourceText, /gradient|filter|shadow/i); // 입체 효과 부재 확인
        sourceTexts[source.split('/').pop()] = sourceText; // 파일명별 SVG 원문 저장
    } // 역할 그림 순회 종료
    assert.match(sourceTexts['admin.svg'], /id="admin-crown-on-shield"/); // 방패에 씌운 왕관 확인
    assert.match(sourceTexts['editor.svg'], /id="editor-empty-canvas"/); // 빈 편집 네모 확인
    assert.doesNotMatch(sourceTexts['editor.svg'], /id="editor-inner-detail"/); // 편집 네모 내부 흔적 부재 확인
    await page.close(); // 검증 탭 정리
}); // 평면 그림 검증 종료

test('관리자 왕관의 하단 띠에 보석 세 개를 선명하게 표시', async () => // 왕관 디테일 검증
{
    const page = await openHome(); // 소개 화면 준비
    const jewels = await page.evaluate(async () => // 왕관 보석 표시값 수집
    {
        const source = await (await fetch('assets/roles/admin.svg')).text(); // 관리자 SVG 원문 조회
        const documentNode = new DOMParser().parseFromString(source, 'image/svg+xml'); // SVG 문서 변환
        const svg = document.importNode(documentNode.documentElement, true); // 측정용 SVG 복사
        svg.style.position = 'fixed'; // 화면 밖 측정 위치
        svg.style.left = '-1000px'; // 화면 밖 가로 위치
        svg.style.width = '160px'; // 측정 너비
        svg.style.height = '160px'; // 측정 높이
        document.body.appendChild(svg); // 측정용 SVG 추가
        const values = [...svg.querySelectorAll('#admin-crown-details [data-crown-jewel]')].map((jewel) => // 보석별 표시값 변환
        {
            const box = jewel.getBBox(); // 보석 실제 경계 측정
            const style = getComputedStyle(jewel); // 보석 계산 스타일 조회
            return { width: box.width, height: box.height, fill: style.fill, opacity: Number(style.opacity) }; // 보석 표시값 반환
        }); // 보석별 표시값 변환 종료
        svg.remove(); // 측정용 SVG 제거
        return values; // 보석 표시값 반환
    }); // 왕관 보석 표시값 수집 종료
    assert.equal(jewels.length, 3); // 보석 세 개 확인
    assert.ok(jewels.every((jewel) => jewel.width >= 6 && jewel.height >= 6), '보석 크기: ' + JSON.stringify(jewels)); // 작은 화면 식별 크기 확인
    assert.ok(jewels.every((jewel) => jewel.fill !== 'none' && jewel.opacity === 1), '보석 표시: ' + JSON.stringify(jewels)); // 단색 보석 표시 확인
    await page.close(); // 검증 탭 정리
}); // 왕관 디테일 검증 종료

test('작업실 제목 앞의 역할 그림과 이름을 현재 권한에 맞게 변경', async () => // 작업실 역할 표시 검증
{
    const page = await openHome(); // 소개 화면 준비
    const identities = await page.evaluate(() => // 역할별 표시값 수집
    {
        return ['admin', 'editor', 'viewer'].map((role) => // 역할별 표시 변경
        {
            window.setWorkspaceRoleIdentity(role); // 작업실 역할 표시 갱신
            const image = document.querySelector('#ws-role-icon'); // 역할 그림 탐색
            const label = document.querySelector('#ws-role-label'); // 역할 이름 탐색
            return { role, source: image?.getAttribute('src'), alt: image?.getAttribute('alt'), label: label?.textContent }; // 역할 표시값 반환
        }); // 역할별 표시 변경 종료
    }); // 역할별 표시값 수집 종료
    assert.deepEqual(identities, [ // 역할별 기대값 비교
        { role: 'admin', source: 'assets/roles/admin.svg', alt: '관리자 역할', label: '관리자' }, // 관리자 표시 기대값
        { role: 'editor', source: 'assets/roles/editor.svg', alt: '편집자 역할', label: '편집자' }, // 편집자 표시 기대값
        { role: 'viewer', source: 'assets/roles/viewer.svg', alt: '열람자 역할', label: '열람자' }, // 열람자 표시 기대값
    ]); // 역할별 기대값 비교 종료
    await page.close(); // 검증 탭 정리
}); // 작업실 역할 표시 검증 종료

test('넓은 화면에서 역할 카드를 같은 높이의 가로 3열로 배치', async () => // 역할 카드 배치 검증
{
    const page = await openHome(); // 소개 화면 준비
    const layout = await page.$eval('.role-list', (list) => // 역할 목록 배치 측정
    {
        const cards = [...list.querySelectorAll('.role-card')]; // 역할 카드 수집
        const style = getComputedStyle(list); // 역할 목록 계산 스타일
        return { columns: style.gridTemplateColumns.split(' ').filter(Boolean).length, tops: cards.map((card) => Math.round(card.getBoundingClientRect().top)), heights: cards.map((card) => Math.round(card.getBoundingClientRect().height)) }; // 배치 측정값 반환
    }); // 역할 목록 배치 측정 종료
    assert.equal(layout.columns, 3); // 세 열 확인
    assert.equal(new Set(layout.tops).size, 1); // 같은 시작 높이 확인
    assert.equal(new Set(layout.heights).size, 1); // 같은 카드 높이 확인
    await page.close(); // 검증 탭 정리
}); // 역할 카드 배치 검증 종료

test('인앱 브라우저 너비에서도 역할 카드를 가로 3열로 유지', async () => // 좁은 데스크톱 배치 검증
{
    const page = await openHome(700, 900); // 인앱 브라우저 크기 준비
    const columns = await page.$eval('.role-list', (list) => getComputedStyle(list).gridTemplateColumns.split(' ').filter(Boolean).length); // 계산된 열 개수 수집
    assert.equal(columns, 3); // 인앱 화면 세 열 확인
    await page.close(); // 검증 탭 정리
}); // 좁은 데스크톱 배치 검증 종료

test('기능 카드의 이전·다음 화살표를 캐러셀 무대 수직 중앙에 배치', async () => // 화살표 중앙 정렬 검증
{
    const page = await openHome(); // 소개 화면 준비
    const offsets = await page.$eval('.carousel-stage', (stage) => // 화살표 중심 차이 측정
    {
        const stageRect = stage.getBoundingClientRect(); // 캐러셀 무대 영역
        const stageCenter = stageRect.top + stageRect.height / 2; // 캐러셀 무대 중심
        return [...stage.querySelectorAll('.carousel-arrow')].map((arrow) => // 화살표별 중심 차이 계산
        {
            const arrowRect = arrow.getBoundingClientRect(); // 화살표 영역
            return Math.abs(arrowRect.top + arrowRect.height / 2 - stageCenter); // 수직 중심 오차 반환
        }); // 화살표별 중심 차이 계산 종료
    }); // 화살표 중심 차이 측정 종료
    assert.equal(offsets.length, 2); // 화살표 두 개 확인
    assert.ok(offsets.every((offset) => offset <= 1), '화살표 중심 오차: ' + offsets.join(', ')); // 한 픽셀 이내 중앙 확인
    await page.close(); // 검증 탭 정리
}); // 화살표 중앙 정렬 검증 종료
