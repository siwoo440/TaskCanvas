// 마우스·키보드 입력을 도구 동작으로 변환 (선택·이동·크기 조절, 연결선, 펜, 사각형, 원, 화면 이동, 확대)
'use strict';

function attachTools(canvas, options)
{
    const el = canvas.el; // canvas 요소
    let drag = null; // 진행 중인 드래그 {mode, ...}
    let spaceHeld = false; // Space 키 상태
    let lastCursorAt = 0; // 커서 전송 시각
    let previewTimer = 0; // 미리보기 전송 타이머

    function position(e)
    {
        const rect = el.getBoundingClientRect(); // 캔버스 위치
        return { sx: e.clientX - rect.left, sy: e.clientY - rect.top }; // 화면 좌표
    }

    function snap(w, state)
    {
        return state.snap ? { x: Math.round(w.x / 10) * 10, y: Math.round(w.y / 10) * 10 } : w; // 격자 맞춤이 켜지면 10 단위로 반올림
    }

    function newStrokeId()
    {
        return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); // 임시 획 ID
    }

    function flushPreview()
    {
        previewTimer = 0; // 타이머 해제
        if (drag && drag.mode === 'pen' && drag.unsent.length > 0)
        {
            options.onStrokePreview(drag.draft.payload.stroke_id, drag.unsent, drag.draft.style); // 미전송 좌표 전송
            drag.unsent = []; // 전송 큐 비움
        }
    }

    function schedulePreview()
    {
        if (!previewTimer)
        {
            previewTimer = setTimeout(flushPreview, window.TC_CONFIG.previewIntervalMs); // 묶음 전송 예약
        }
    }

    function cancel()
    {
        if (drag && (drag.mode === 'pen' || drag.mode === 'shape'))
        {
            canvas.draft = null; // 초안 폐기
        }
        canvas.linkDraft = null; // 연결선 초안 폐기
        canvas.marquee = null; // 영역 선택 폐기
        canvas.invalidate(); // 다시 그리기
        drag = null; // 드래그 종료
    }

    el.addEventListener('pointerdown', (e) =>
    {
        const state = options.getState(); // 현재 도구·역할·스타일
        const { sx, sy } = position(e); // 화면 좌표
        const w = canvas.toWorld(sx, sy); // 월드 좌표
        el.setPointerCapture(e.pointerId); // 포인터 고정
        const panMode = state.tool === 'pan' || spaceHeld || e.button === 1 || !state.canEdit; // 이동 모드 조건
        if (panMode)
        {
            drag = { mode: 'pan', sx, sy }; // 이동 시작
            return;
        }
        if (e.button !== 0)
        {
            return; // 왼쪽 버튼만 그리기
        }
        if (state.tool === 'select')
        {
            const handle = e.shiftKey ? null : canvas.hitHandle(w.x, w.y); // 크기 조절 핸들(객체 판정보다 먼저)
            if (handle)
            {
                const started = options.onResizeDown(handle.object, handle.corner, w); // 잠금 요청 후 크기 조절 시작
                drag = started ? { mode: 'resize' } : null; // 크기 조절 시작 여부
                return;
            }
            const hit = canvas.hitTest(w.x, w.y); // 클릭한 객체
            if (!hit)
            {
                const link = canvas.hitTestLink(w.x, w.y); // 클릭한 연결선
                if (link)
                {
                    options.onLinkSelect(link); // 연결선 선택
                    return;
                }
                options.onSelectDown(null, w, e.shiftKey); // 빈 곳 → 선택 해제(Shift 면 유지)
                drag = { mode: 'marquee', origin: w }; // 영역 선택 시작
                canvas.marquee = { x: w.x, y: w.y, width: 0, height: 0 }; // 영역 표시
                return;
            }
            const started = options.onSelectDown(hit, w, e.shiftKey); // 선택·이동 시작(잠금 요청)
            drag = started ? { mode: 'move' } : null; // 이동 시작 여부
            return;
        }
        if (state.tool === 'link')
        {
            const hit = canvas.hitTest(w.x, w.y); // 출발 객체
            if (hit)
            {
                drag = { mode: 'link', from: hit }; // 연결선 드래그
                canvas.linkDraft = { from: hit, to: w }; // 고무줄 선
                canvas.invalidate(); // 다시 그리기
            }
            return;
        }
        if (state.tool === 'pen')
        {
            const draft = { type: 'stroke', payload: { stroke_id: newStrokeId(), points: [[w.x, w.y]] }, style: { color: state.style.color, width: state.style.width } }; // 획 초안
            drag = { mode: 'pen', draft, unsent: [[w.x, w.y]] }; // 펜 드래그
            canvas.draft = draft; // 초안 표시
            schedulePreview(); // 첫 좌표 전송 예약
        }
        else
        {
            const origin = snap(w, state); // 시작점(격자 맞춤 반영)
            const draft = { type: state.tool, x: origin.x, y: origin.y, width: 0, height: 0, style: { stroke: state.style.color, width: state.style.width, fill: state.style.fill } }; // 도형 초안
            drag = { mode: 'shape', origin, draft }; // 도형 드래그
            canvas.draft = draft; // 초안 표시
        }
        canvas.invalidate(); // 다시 그리기
    });

    el.addEventListener('pointermove', (e) =>
    {
        const { sx, sy } = position(e); // 화면 좌표
        const w = canvas.toWorld(sx, sy); // 월드 좌표
        const now = Date.now(); // 현재 시각
        if (now - lastCursorAt >= window.TC_CONFIG.cursorIntervalMs)
        {
            lastCursorAt = now; // 전송 시각 갱신
            options.onCursor(w.x, w.y); // 커서 위치 공유
        }
        if (!drag)
        {
            const handle = options.getState().tool === 'select' ? canvas.hitHandle(w.x, w.y) : null; // 핸들 위 여부
            el.style.cursor = handle ? (handle.corner === 'nw' || handle.corner === 'se' ? 'nwse-resize' : 'nesw-resize') : ''; // 대각선 커서 표시
            return;
        }
        if (drag.mode === 'pan')
        {
            canvas.panBy(sx - drag.sx, sy - drag.sy); // 화면 이동
            drag.sx = sx; // 기준 X 갱신
            drag.sy = sy; // 기준 Y 갱신
        }
        else if (drag.mode === 'move')
        {
            options.onSelectMove(w); // 객체 이동 중
        }
        else if (drag.mode === 'resize')
        {
            options.onResizeMove(w, e.shiftKey); // 크기 조절 중(Shift: 비율 유지)
        }
        else if (drag.mode === 'marquee')
        {
            canvas.marquee = { x: Math.min(drag.origin.x, w.x), y: Math.min(drag.origin.y, w.y), width: Math.abs(w.x - drag.origin.x), height: Math.abs(w.y - drag.origin.y) }; // 영역 갱신
            canvas.invalidate(); // 다시 그리기
        }
        else if (drag.mode === 'link')
        {
            canvas.linkDraft = { from: drag.from, to: w }; // 고무줄 끝점 갱신
            canvas.invalidate(); // 다시 그리기
        }
        else if (drag.mode === 'pen')
        {
            drag.draft.payload.points.push([w.x, w.y]); // 좌표 추가
            drag.unsent.push([w.x, w.y]); // 전송 큐 추가
            schedulePreview(); // 전송 예약
            canvas.invalidate(); // 다시 그리기
        }
        else if (drag.mode === 'shape')
        {
            const p = snap(w, options.getState()); // 현재 점(격자 맞춤 반영)
            drag.draft.x = Math.min(drag.origin.x, p.x); // 왼쪽 위 X
            drag.draft.y = Math.min(drag.origin.y, p.y); // 왼쪽 위 Y
            drag.draft.width = Math.abs(p.x - drag.origin.x); // 너비
            drag.draft.height = Math.abs(p.y - drag.origin.y); // 높이
            canvas.invalidate(); // 다시 그리기
        }
    });

    el.addEventListener('pointerup', (e) =>
    {
        if (!drag)
        {
            return;
        }
        const finished = drag; // 완료된 드래그
        drag = null; // 드래그 종료
        if (finished.mode === 'move' || finished.mode === 'resize')
        {
            options.onSelectUp(); // 객체 이동·크기 조절 확정
            return;
        }
        if (finished.mode === 'marquee')
        {
            const m = canvas.marquee; // 영역
            canvas.marquee = null; // 영역 표시 해제
            canvas.invalidate(); // 다시 그리기
            if (m && (m.width > 2 || m.height > 2))
            {
                options.onMarquee(m, e.shiftKey); // 영역 안 객체 선택
            }
            return;
        }
        if (finished.mode === 'link')
        {
            const { sx, sy } = position(e); // 화면 좌표
            const w = canvas.toWorld(sx, sy); // 월드 좌표
            const target = canvas.hitTest(w.x, w.y); // 도착 객체
            canvas.linkDraft = null; // 고무줄 해제
            canvas.invalidate(); // 다시 그리기
            if (target && target.object_id !== finished.from.object_id)
            {
                options.onLinkCreate(finished.from, target); // 연결선 생성
            }
            return;
        }
        canvas.draft = null; // 초안 표시 해제
        if (finished.mode === 'pen')
        {
            flushPreview(); // 남은 미리보기 전송
            options.onStrokeCommit(finished.draft); // 획 확정
        }
        else if (finished.mode === 'shape')
        {
            if (finished.draft.width >= 2 && finished.draft.height >= 2)
            {
                options.onShapeCreate(finished.draft); // 도형 확정
            }
        }
        canvas.invalidate(); // 다시 그리기
    });

    el.addEventListener('pointercancel', () =>
    {
        if (drag && (drag.mode === 'move' || drag.mode === 'resize'))
        {
            options.onEscape(); // 이동·크기 조절 취소
        }
        cancel(); // 그리기 취소
    });
    el.addEventListener('wheel', (e) =>
    {
        e.preventDefault(); // 페이지 스크롤 방지
        const { sx, sy } = position(e); // 화면 좌표
        canvas.zoomAt(sx, sy, e.deltaY < 0 ? 1.1 : 1 / 1.1); // 휠 방향에 따른 확대·축소
    }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault()); // 우클릭 메뉴 방지

    window.addEventListener('keydown', (e) =>
    {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')
        {
            return; // 입력 중에는 무시
        }
        if (e.code === 'Space')
        {
            spaceHeld = true; // Space 누름
            e.preventDefault(); // 스크롤 방지
        }
        else if (e.key === 'Escape')
        {
            cancel(); // 그리기 취소
            options.onEscape(); // 이동 취소·선택 해제
        }
        else if (e.key === 'Delete' || e.key === 'Backspace')
        {
            e.preventDefault(); // 뒤로 가기 방지
            options.onDeleteKey(); // 선택 객체 삭제
        }
        else
        {
            const map = { v: 'select', l: 'link', p: 'pen', r: 'rect', o: 'ellipse', h: 'pan', t: 'task' }; // 단축키
            if (map[e.key.toLowerCase()])
            {
                options.onToolShortcut(map[e.key.toLowerCase()]); // 도구 전환
            }
        }
    });
    window.addEventListener('keyup', (e) =>
    {
        if (e.code === 'Space')
        {
            spaceHeld = false; // Space 해제
        }
    });
}

window.attachTools = attachTools; // 전역 노출
