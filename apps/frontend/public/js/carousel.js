// 카드 넘겨 보기(소개 페이지의 기능 카드): 좌우 화살표·아래 점·키보드로 한 장씩 넘긴다
// 가로 스크롤 스냅 위에 얹은 것이라 터치 화면에서는 손가락으로 밀어도 넘어가고, 스크립트가 없어도 가로로 스크롤해 볼 수 있다
'use strict';

const Carousel = {
    ARRIVED: 2, // 목표 위치와 이만큼(픽셀) 안으로 들어오면 도착한 것으로 봄
}; // 카드 넘겨 보기 모듈

// root(.carousel) 안의 .carousel-track 을 넘겨 보기로 만든다. 점은 카드 수만큼 자동으로 만든다
Carousel.mount = (root) =>
{
    const track = root.querySelector('.carousel-track'); // 카드가 가로로 놓인 스크롤 영역
    const slides = [...track.children]; // 카드 목록
    const dotBox = root.querySelector('.carousel-dots'); // 아래 점이 들어갈 자리
    const counter = root.querySelector('.carousel-count'); // "1 / 6" 표시(없을 수 있음)
    const state = { index: 0, moving: false }; // 지금 가리키는 카드, 화살표·점으로 넘기는 중인지
    const dots = []; // 점 버튼 목록

    function offsetOf(i)
    {
        return slides[i].offsetLeft - slides[0].offsetLeft; // i번째 카드가 맨 앞에 오는 스크롤 위치
    }

    function paint()
    {
        dots.forEach((dot, i) =>
        {
            dot.classList.toggle('active', i === state.index); // 지금 카드의 점만 길게
            dot.setAttribute('aria-current', i === state.index ? 'true' : 'false'); // 화면 낭독기용 현재 표시
        });
        if (counter)
        {
            counter.textContent = (state.index + 1) + ' / ' + slides.length; // 몇 번째 카드인지
        }
    }

    // 스크롤 위치에서 가장 가까운 카드를 찾아 점·숫자를 맞춘다(손가락이나 스크롤 막대로 넘긴 경우)
    function sync()
    {
        let nearest = 0; // 가장 가까운 카드
        for (let i = 1; i < slides.length; i++)
        {
            if (Math.abs(offsetOf(i) - track.scrollLeft) < Math.abs(offsetOf(nearest) - track.scrollLeft))
            {
                nearest = i; // 더 가까운 카드
            }
        }
        if (nearest !== state.index)
        {
            state.index = nearest; // 보이는 카드 갱신
            paint(); // 점·숫자 갱신
        }
    }

    // i번째 카드로 넘긴다. 범위를 벗어나면 반대쪽 끝으로 돈다(마지막에서 다음을 누르면 처음으로)
    function go(i)
    {
        state.index = (i + slides.length) % slides.length; // 처음과 끝을 이어 붙임
        state.moving = true; // 도착할 때까지는 스크롤 위치로 점을 다시 계산하지 않음(넘어가는 동안 점이 지나온 카드를 가리키는 것 방지)
        paint(); // 누른 즉시 점·숫자부터 바꿈
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; // 움직임 줄이기 설정
        track.scrollTo({ left: offsetOf(state.index), behavior: reduce ? 'auto' : 'smooth' }); // 카드 위치로 스크롤
    }

    slides.forEach((slide, i) =>
    {
        const dot = document.createElement('button'); // 점 버튼
        dot.type = 'button'; // 제출 방지
        dot.className = 'carousel-dot'; // 모양
        dot.setAttribute('aria-label', (i + 1) + '번째 카드 보기'); // 화면 낭독기용 이름
        dot.addEventListener('click', () => go(i)); // 그 카드로 이동
        dotBox.appendChild(dot); // 점 추가
        dots.push(dot); // 목록에 기억
        slide.setAttribute('role', 'group'); // 카드 한 장
        slide.setAttribute('aria-roledescription', '카드'); // 역할 설명
        slide.setAttribute('aria-label', (i + 1) + ' / ' + slides.length); // 몇 번째인지
    });

    root.querySelector('.carousel-arrow.prev').addEventListener('click', () => go(state.index - 1)); // 왼쪽 화살표
    root.querySelector('.carousel-arrow.next').addEventListener('click', () => go(state.index + 1)); // 오른쪽 화살표
    root.addEventListener('keydown', (e) =>
    {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
        {
            e.preventDefault(); // 브라우저의 기본 가로 스크롤 대신 한 장씩
            go(state.index + (e.key === 'ArrowRight' ? 1 : -1)); // 방향키로 넘기기
        }
    });
    track.addEventListener('scroll', () =>
    {
        if (state.moving)
        {
            state.moving = Math.abs(track.scrollLeft - offsetOf(state.index)) > Carousel.ARRIVED; // 목표 카드에 닿으면 넘기기 끝
            return; // 넘어가는 중에는 가리키는 카드를 바꾸지 않음
        }
        sync(); // 직접 밀어서 넘긴 경우 점이 따라감
    }, { passive: true });
    for (const type of ['pointerdown', 'touchstart', 'wheel'])
    {
        track.addEventListener(type, () => { state.moving = false; }, { passive: true }); // 넘어가는 중에 직접 밀기 시작하면 그때부터는 손을 따라감
    }
    track.addEventListener('scrollend', () =>
    {
        if (state.moving && Math.abs(track.scrollLeft - offsetOf(state.index)) > Carousel.ARRIVED)
        {
            return; // 앞서 넘기던 스크롤이 끝났다는 알림이 뒤늦게 온 것: 지금은 다음 카드로 가는 중이므로 무시
        }
        state.moving = false; // 스크롤이 멈춤
        sync(); // 실제로 멈춘 카드와 맞춤
    });
    window.addEventListener('resize', () => track.scrollTo({ left: offsetOf(state.index), behavior: 'auto' })); // 창 크기가 바뀌어도 보던 카드 유지

    paint(); // 첫 상태 표시
    return { go, state }; // 바깥에서 넘기거나 상태를 볼 수 있게
};

for (const root of document.querySelectorAll('.carousel'))
{
    root.carousel = Carousel.mount(root); // 문서에 있는 넘겨 보기를 모두 연결
}

window.Carousel = Carousel; // 전역 노출
