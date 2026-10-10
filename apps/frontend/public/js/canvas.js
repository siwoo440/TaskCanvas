// 보드 캔버스 렌더링: 격자, 확정 객체, 미리보기, 커서, 선택·잠금 표시, 뷰포트(확대·이동)
'use strict';

class BoardCanvas
{
    constructor(el)
    {
        this.el = el; // canvas 요소
        this.ctx = el.getContext('2d'); // 2D 컨텍스트
        this.view = { scale: 1, x: 0, y: 0 }; // 화면 좌표 = 월드 좌표 * scale + (x, y)
        this.objects = []; // 저장 완료 객체
        this.previews = new Map(); // 타인 펜 미리보기 stroke_id → {points, style, at}
        this.pending = new Map(); // 저장 응답 대기 중인 내 객체 request_id → 초안
        this.cursors = new Map(); // 타인 커서 guest_id → {x, y, display_name, color, at}
        this.locks = new Map(); // 타인 잠금 object_id → {display_name, color}
        this.moves = new Map(); // 이동·크기 조절 중 상태 object_id → {x, y, width?, height?} (내 드래그·타인 미리보기)
        this.selectedIds = new Set(); // 선택한 객체 ID 집합(다중 선택)
        this.selectedLinkId = null; // 선택한 연결선 ID
        this.links = []; // 연결선 목록 {link_id, from_object_id, to_object_id, label}
        this.linkDraft = null; // 연결선 드래그 중 {from, to:{x,y}}
        this.marquee = null; // 영역 선택 사각형 {x, y, width, height}
        this.draft = null; // 지금 그리는 중인 내 초안
        this.images = new Map(); // 이미지 캐시 url → {img, failed}
        this.tasks = new Map(); // 공유 업무 원본 task_id → task (app 이 채움)
        this.editingId = null; // 글을 편집 중인 메모 ID(입력 요소가 위에 겹치므로 캔버스에는 글을 그리지 않음)
        this.wrapCache = new Map(); // 메모 줄바꿈 결과 object_id → {key, lines}
        this.afterRender = null; // 렌더 후 콜백(영상 오버레이 동기화)
        this.frame = 0; // 예약된 애니메이션 프레임
        this.resize = this.resize.bind(this); // 크기 변경 핸들러
        new ResizeObserver(this.resize).observe(el.parentElement); // 부모 크기 추적
        this.resize(); // 초기 크기 적용
        setInterval(() => this.prune(), 1000); // 오래된 커서·미리보기 정리
    }

    resize()
    {
        const dpr = window.devicePixelRatio || 1; // 고해상도 배율
        const rect = this.el.parentElement.getBoundingClientRect(); // 표시 영역
        this.el.width = Math.max(1, Math.round(rect.width * dpr)); // 실제 픽셀 너비
        this.el.height = Math.max(1, Math.round(rect.height * dpr)); // 실제 픽셀 높이
        this.dpr = dpr; // 배율 저장
        this.invalidate(); // 다시 그리기
    }

    toWorld(sx, sy)
    {
        return { x: (sx - this.view.x) / this.view.scale, y: (sy - this.view.y) / this.view.scale }; // 화면 → 월드
    }

    toScreen(wx, wy)
    {
        return { x: wx * this.view.scale + this.view.x, y: wy * this.view.scale + this.view.y }; // 월드 → 화면
    }

    zoomAt(sx, sy, factor)
    {
        const next = Math.min(8, Math.max(0.1, this.view.scale * factor)); // 배율 범위 제한
        const ratio = next / this.view.scale; // 실제 변화율
        this.view.x = sx - (sx - this.view.x) * ratio; // 커서 기준 X 보정
        this.view.y = sy - (sy - this.view.y) * ratio; // 커서 기준 Y 보정
        this.view.scale = next; // 배율 적용
        this.invalidate(); // 다시 그리기
    }

    panBy(dx, dy)
    {
        this.view.x += dx; // X 이동
        this.view.y += dy; // Y 이동
        this.invalidate(); // 다시 그리기
    }

    fitAll()
    {
        const width = this.el.width / this.dpr; // 표시 너비
        const height = this.el.height / this.dpr; // 표시 높이
        if (this.objects.length === 0)
        {
            this.view = { scale: 1, x: 0, y: 0 }; // 객체 없으면 초기화
            return this.invalidate();
        }
        let minX = Infinity; // 최소 X
        let minY = Infinity; // 최소 Y
        let maxX = -Infinity; // 최대 X
        let maxY = -Infinity; // 최대 Y
        for (const o of this.objects)
        {
            minX = Math.min(minX, o.x); // 최소 X 갱신
            minY = Math.min(minY, o.y); // 최소 Y 갱신
            maxX = Math.max(maxX, o.x + o.width); // 최대 X 갱신
            maxY = Math.max(maxY, o.y + o.height); // 최대 Y 갱신
        }
        const scale = Math.min(8, Math.max(0.1, 0.9 * Math.min(width / Math.max(1, maxX - minX), height / Math.max(1, maxY - minY)))); // 여백 10% 포함 배율
        this.view = { scale, x: (width - (minX + maxX) * scale) / 2, y: (height - (minY + maxY) * scale) / 2 }; // 중앙 정렬
        this.invalidate(); // 다시 그리기
    }

    reset()
    {
        this.setObjects([]); // 객체 비움
        this.locks.clear(); // 잠금 비움
        this.cursors.clear(); // 커서 비움
        this.selectedIds.clear(); // 선택 해제
        this.selectedLinkId = null; // 연결선 선택 해제
        this.links = []; // 연결선 비움
        this.linkDraft = null; // 연결선 초안 비움
        this.marquee = null; // 영역 선택 비움
        this.view = { scale: 1, x: 0, y: 0 }; // 뷰포트 초기화
        this.invalidate(); // 다시 그리기
    }

    setObjects(list)
    {
        this.objects = list.slice(); // 객체 목록 교체
        this.previews.clear(); // 미리보기 초기화
        this.pending.clear(); // 대기 초안 초기화
        this.moves.clear(); // 이동 미리보기 초기화
        this.draft = null; // 초안 초기화
        this.invalidate(); // 다시 그리기
    }

    setLocks(list)
    {
        this.locks.clear(); // 기존 잠금 비움
        for (const l of list || [])
        {
            this.locks.set(l.object_id, l); // 현재 잠금 등록
        }
        this.invalidate(); // 다시 그리기
    }

    findObject(id)
    {
        return this.objects.find((o) => o.object_id === id) ?? null; // ID 로 객체 조회
    }

    addObject(object)
    {
        if (this.objects.some((o) => o.object_id === object.object_id))
        {
            return; // 중복 수신 무시
        }
        this.objects.push(object); // 객체 추가
        const strokeId = object.payload && object.payload.stroke_id; // 연결된 미리보기 ID
        if (strokeId)
        {
            this.previews.delete(strokeId); // 확정된 미리보기 제거
        }
        this.invalidate(); // 다시 그리기
    }

    updateObject(object)
    {
        const index = this.objects.findIndex((o) => o.object_id === object.object_id); // 기존 위치
        if (index >= 0)
        {
            this.objects[index] = object; // 객체 교체
        }
        else
        {
            this.objects.push(object); // 없으면 추가
        }
        this.moves.delete(object.object_id); // 이동 미리보기 제거
        this.invalidate(); // 다시 그리기
    }

    removeObject(id)
    {
        this.objects = this.objects.filter((o) => o.object_id !== id); // 객체 제거
        this.moves.delete(id); // 이동 미리보기 제거
        this.locks.delete(id); // 잠금 표시 제거
        this.wrapCache.delete(id); // 메모 줄바꿈 캐시 제거
        this.selectedIds.delete(id); // 선택에서 제거
        this.removeLinksOf(id); // 연결된 연결선 제거(서버도 FK 로 함께 삭제)
        this.invalidate(); // 다시 그리기
    }

    applyPreview(data)
    {
        const entry = this.previews.get(data.stroke_id) ?? { points: [], style: data.style, guest_id: data.guest_id }; // 기존 또는 새 미리보기
        entry.points.push(...data.points_delta); // 좌표 추가
        entry.at = Date.now(); // 갱신 시각
        this.previews.set(data.stroke_id, entry); // 저장
        this.invalidate(); // 다시 그리기
    }

    setCursor(data)
    {
        this.cursors.set(data.guest_id, { ...data, at: Date.now() }); // 커서 갱신
        this.invalidate(); // 다시 그리기
    }

    removeCursorsExcept(guestIds)
    {
        for (const id of [...this.cursors.keys()])
        {
            if (!guestIds.includes(id))
            {
                this.cursors.delete(id); // 퇴장한 참여자의 커서 제거
            }
        }
        this.invalidate(); // 다시 그리기
    }

    prune()
    {
        const now = Date.now(); // 현재 시각
        let changed = false; // 변경 여부
        for (const [id, c] of this.cursors)
        {
            if (now - c.at > 5000)
            {
                this.cursors.delete(id); // 5초 이상 멈춘 커서 제거
                changed = true;
            }
        }
        for (const [id, p] of this.previews)
        {
            if (now - p.at > 15000)
            {
                this.previews.delete(id); // 확정되지 않은 오래된 미리보기 제거
                changed = true;
            }
        }
        if (changed)
        {
            this.invalidate(); // 다시 그리기
        }
    }

    // 현재 표시 위치(이동 미리보기 반영)
    displayPosition(o)
    {
        const mv = this.moves.get(o.object_id); // 이동 중 위치
        return mv ? { x: mv.x, y: mv.y } : { x: o.x, y: o.y }; // 미리보기 우선
    }

    // 현재 표시 사각형(이동·크기 조절 미리보기 반영)
    displayRect(o)
    {
        const mv = this.moves.get(o.object_id); // 이동·크기 조절 중 상태
        if (!mv)
        {
            return { x: o.x, y: o.y, width: o.width, height: o.height }; // 저장된 값
        }
        const resized = mv.width !== undefined && o.type !== 'stroke'; // 크기 조절 중 여부(획은 크기 변경 없음)
        return { x: mv.x, y: mv.y, width: resized ? mv.width : o.width, height: resized ? mv.height : o.height }; // 미리보기 우선
    }

    // 크기 조절 핸들: 하나만 선택한 도형·이미지·영상·업무 블럭의 네 모서리
    resizeTarget()
    {
        const o = this.primarySelected(); // 단일 선택 객체
        return o && BoardCanvas.RESIZABLE.includes(o.type) && !this.locks.has(o.object_id) ? o : null; // 타인 잠금·획은 제외
    }

    handlePoints(o)
    {
        const r = this.displayRect(o); // 표시 사각형
        return { nw: [r.x, r.y], ne: [r.x + r.width, r.y], se: [r.x + r.width, r.y + r.height], sw: [r.x, r.y + r.height] }; // 모서리 좌표
    }

    hitHandle(wx, wy)
    {
        const o = this.resizeTarget(); // 핸들을 가진 객체
        if (!o)
        {
            return null;
        }
        const tol = 8 / this.view.scale; // 화면 8px 허용 오차
        for (const [corner, [hx, hy]] of Object.entries(this.handlePoints(o)))
        {
            if (Math.abs(wx - hx) <= tol && Math.abs(wy - hy) <= tol)
            {
                return { object: o, corner }; // 잡힌 모서리
            }
        }
        return null; // 핸들 아님
    }

    hitTest(wx, wy)
    {
        const tol = 4 / this.view.scale; // 화면 4px 허용 오차
        for (let i = this.objects.length - 1; i >= 0; i--)
        {
            const o = this.objects[i]; // 위에 그려진 객체부터
            const pos = this.displayPosition(o); // 표시 위치
            if (o.type === 'stroke')
            {
                const half = ((o.style && o.style.width) || 3) / 2 + tol; // 선 반경 + 오차
                if (wx < pos.x - half || wx > pos.x + o.width + half || wy < pos.y - half || wy > pos.y + o.height + half)
                {
                    continue; // 경계 밖
                }
                const dx = pos.x - o.x; // 이동량 X
                const dy = pos.y - o.y; // 이동량 Y
                const points = (o.payload && o.payload.points) || []; // 획 좌표
                for (let k = 0; k < points.length; k++)
                {
                    const a = [points[k][0] + dx, points[k][1] + dy]; // 현재 점
                    const b = k + 1 < points.length ? [points[k + 1][0] + dx, points[k + 1][1] + dy] : a; // 다음 점
                    if (BoardCanvas.segmentDistance(wx, wy, a, b) <= half)
                    {
                        return o; // 선 위
                    }
                }
            }
            else if (o.type === 'rect' || o.type === 'image' || o.type === 'video' || o.type === 'task' || o.type === 'note')
            {
                const r = this.displayRect(o); // 표시 사각형(크기 조절 중 반영)
                if (wx >= r.x - tol && wx <= r.x + r.width + tol && wy >= r.y - tol && wy <= r.y + r.height + tol)
                {
                    return o; // 경계 사각형 안(영상은 iframe 영역을 제외한 제목 막대만 캔버스에 도달)
                }
            }
            else if (o.type === 'ellipse')
            {
                const r = this.displayRect(o); // 표시 사각형(크기 조절 중 반영)
                const rx = r.width / 2 + tol; // 가로 반지름
                const ry = r.height / 2 + tol; // 세로 반지름
                const nx = (wx - (r.x + r.width / 2)) / rx; // 정규화 X
                const ny = (wy - (r.y + r.height / 2)) / ry; // 정규화 Y
                if (nx * nx + ny * ny <= 1)
                {
                    return o; // 타원 안
                }
            }
        }
        return null; // 맞은 객체 없음
    }

    imageFor(url)
    {
        let entry = this.images.get(url); // 캐시 항목
        if (!entry)
        {
            const img = new Image(); // 이미지 요소
            entry = { img, failed: false }; // 캐시 항목 생성
            img.onload = () => this.invalidate(); // 로드 후 다시 그리기
            img.onerror = () =>
            {
                entry.failed = true; // 실패 표시
                this.invalidate(); // 다시 그리기
            };
            img.src = url; // 로드 시작(같은 출처라 세션 쿠키 포함)
            this.images.set(url, entry); // 캐시 저장
        }
        return entry; // 캐시 항목
    }

    primarySelected()
    {
        return this.selectedIds.size === 1 ? this.findObject([...this.selectedIds][0]) : null; // 하나만 선택했을 때 그 객체
    }

    setLinks(list)
    {
        this.links = (list || []).slice(); // 연결선 목록 교체
        this.invalidate(); // 다시 그리기
    }

    addLink(link)
    {
        if (!this.links.some((l) => l.link_id === link.link_id))
        {
            this.links.push(link); // 연결선 추가
        }
        this.invalidate(); // 다시 그리기
    }

    updateLink(link)
    {
        const index = this.links.findIndex((l) => l.link_id === link.link_id); // 기존 위치
        if (index >= 0)
        {
            this.links[index] = link; // 교체
        }
        else
        {
            this.links.push(link); // 없으면 추가
        }
        this.invalidate(); // 다시 그리기
    }

    removeLink(linkId)
    {
        this.links = this.links.filter((l) => l.link_id !== linkId); // 연결선 제거
        if (this.selectedLinkId === linkId)
        {
            this.selectedLinkId = null; // 선택 해제
        }
        this.invalidate(); // 다시 그리기
    }

    removeLinksOf(objectId)
    {
        for (const l of this.links)
        {
            if ((l.from_object_id === objectId || l.to_object_id === objectId) && this.selectedLinkId === l.link_id)
            {
                this.selectedLinkId = null; // 삭제되는 연결선 선택 해제
            }
        }
        this.links = this.links.filter((l) => l.from_object_id !== objectId && l.to_object_id !== objectId); // 객체에 붙은 연결선 제거
    }

    // 연결선 양 끝점: 두 객체 중심을 잇되 각 객체의 경계 사각형 가장자리에서 시작·끝
    linkEndpoints(link)
    {
        const a = this.findObject(link.from_object_id); // 출발 객체
        const b = this.findObject(link.to_object_id); // 도착 객체
        if (!a || !b)
        {
            return null; // 끝 객체 없음
        }
        const ra = this.displayRect(a); // 출발 표시 사각형
        const rb = this.displayRect(b); // 도착 표시 사각형
        const ca = { x: ra.x + ra.width / 2, y: ra.y + ra.height / 2 }; // 출발 중심
        const cb = { x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 }; // 도착 중심
        const len = Math.hypot(cb.x - ca.x, cb.y - ca.y); // 중심 거리
        if (len < 1)
        {
            return null; // 겹침
        }
        const ux = (cb.x - ca.x) / len; // 방향 X
        const uy = (cb.y - ca.y) / len; // 방향 Y
        const clip = (c, w, h, dx, dy) =>
        {
            const t = Math.min(dx !== 0 ? (w / 2) / Math.abs(dx) : Infinity, dy !== 0 ? (h / 2) / Math.abs(dy) : Infinity); // 경계까지 거리
            return { x: c.x + dx * t, y: c.y + dy * t }; // 경계 위 점
        };
        const p1 = clip(ca, ra.width, ra.height, ux, uy); // 출발 가장자리
        const p2 = clip(cb, rb.width, rb.height, -ux, -uy); // 도착 가장자리
        return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, ux, uy }; // 선분과 방향
    }

    hitTestLink(wx, wy)
    {
        const tol = 6 / this.view.scale; // 화면 6px 허용 오차
        for (let i = this.links.length - 1; i >= 0; i--)
        {
            const e = this.linkEndpoints(this.links[i]); // 끝점
            if (e && BoardCanvas.segmentDistance(wx, wy, [e.x1, e.y1], [e.x2, e.y2]) <= tol)
            {
                return this.links[i]; // 선 위
            }
        }
        return null; // 맞은 연결선 없음
    }

    drawLink(ctx, link, selected)
    {
        const e = this.linkEndpoints(link); // 끝점
        if (!e)
        {
            return; // 그릴 수 없음
        }
        ctx.save(); // 스타일 시작
        ctx.strokeStyle = selected ? '#2563eb' : '#374151'; // 선 색
        ctx.fillStyle = ctx.strokeStyle; // 화살촉 색
        ctx.lineWidth = selected ? 3 : 2; // 선 굵기
        ctx.beginPath(); // 선 경로
        ctx.moveTo(e.x1, e.y1); // 시작
        ctx.lineTo(e.x2 - e.ux * 10, e.y2 - e.uy * 10); // 화살촉 앞까지
        ctx.stroke(); // 선
        ctx.beginPath(); // 화살촉 경로
        ctx.moveTo(e.x2, e.y2); // 끝점
        ctx.lineTo(e.x2 - e.ux * 14 - e.uy * 6, e.y2 - e.uy * 14 + e.ux * 6); // 한쪽 날개
        ctx.lineTo(e.x2 - e.ux * 14 + e.uy * 6, e.y2 - e.uy * 14 - e.ux * 6); // 다른 날개
        ctx.closePath(); // 닫기
        ctx.fill(); // 화살촉
        if (link.label)
        {
            const mx = (e.x1 + e.x2) / 2; // 중점 X
            const my = (e.y1 + e.y2) / 2; // 중점 Y
            ctx.font = '12px sans-serif'; // 라벨 글꼴
            const w = ctx.measureText(link.label).width + 10; // 라벨 너비
            ctx.fillStyle = '#ffffff'; // 라벨 배경
            ctx.fillRect(mx - w / 2, my - 10, w, 20); // 배경
            ctx.lineWidth = 1; // 테두리 굵기
            ctx.strokeRect(mx - w / 2, my - 10, w, 20); // 테두리
            ctx.fillStyle = selected ? '#2563eb' : '#374151'; // 글자 색
            ctx.fillText(link.label, mx - w / 2 + 5, my + 4); // 라벨
        }
        ctx.restore(); // 스타일 끝
    }

    // 메모 글 줄바꿈: 줄바꿈 문자로 나눈 뒤 폭에 맞춰 낱말 단위로, 낱말이 폭보다 길면 글자 단위로 자른다
    wrapText(text, maxWidth, size = BoardCanvas.NOTE.font)
    {
        const ctx = this.ctx; // 측정용 컨텍스트
        const lines = []; // 결과 줄
        ctx.save(); // 글꼴 설정 보존
        ctx.font = size + 'px sans-serif'; // 메모 글꼴(글자 크기에 따라 줄바꿈 위치가 달라짐)
        for (const paragraph of String(text).split('\n'))
        {
            let line = ''; // 현재 줄
            for (const token of paragraph.split(/(\s+)/))
            {
                if (token === '')
                {
                    continue; // 빈 조각
                }
                if (ctx.measureText(line + token).width <= maxWidth)
                {
                    line += token; // 줄에 그대로 추가
                    continue;
                }
                if (/^\s+$/.test(token))
                {
                    lines.push(line); // 줄 끝 공백은 버리고 줄바꿈
                    line = '';
                    continue;
                }
                if (line.trim() !== '')
                {
                    lines.push(line.trimEnd()); // 낱말이 들어가지 않으면 다음 줄로
                    line = '';
                }
                for (const ch of token)
                {
                    if (line !== '' && ctx.measureText(line + ch).width > maxWidth)
                    {
                        lines.push(line); // 폭보다 긴 낱말은 글자 단위로 자름
                        line = ch;
                    }
                    else
                    {
                        line += ch; // 글자 추가
                    }
                }
            }
            lines.push(line.trimEnd()); // 문단의 마지막 줄
        }
        ctx.restore(); // 글꼴 설정 복원
        return lines; // 줄 목록
    }

    noteLines(o)
    {
        const text = o.payload && typeof o.payload.text === 'string' ? o.payload.text : ''; // 메모 글
        const maxWidth = Math.max(10, o.width - BoardCanvas.NOTE.pad * 2); // 글이 들어갈 폭
        const size = BoardCanvas.noteFont(o).size; // 글자 크기
        const key = maxWidth + '|' + size + '|' + text; // 캐시 키(폭·글자 크기·글이 바뀌면 다시 계산)
        const cached = o.object_id !== undefined ? this.wrapCache.get(o.object_id) : null; // 캐시 조회
        if (cached && cached.key === key)
        {
            return cached.lines; // 캐시 사용
        }
        const lines = this.wrapText(text, maxWidth, size); // 줄바꿈 계산
        if (o.object_id !== undefined)
        {
            this.wrapCache.set(o.object_id, { key, lines }); // 캐시 저장
        }
        return lines; // 줄 목록
    }

    // 글이 모두 보이려면 필요한 메모 높이
    noteHeightFor(text, width, size = BoardCanvas.NOTE.font)
    {
        const n = BoardCanvas.NOTE; // 안쪽 여백
        const line = BoardCanvas.noteFont({ style: { size } }).line; // 이 글자 크기의 줄 높이
        return this.wrapText(text, Math.max(10, width - n.pad * 2), size).length * line + n.pad * 2; // 줄 수 × 줄 높이 + 위아래 여백
    }

    // 보드 전체를 PNG 로 내보내기: 모든 객체가 들어가는 범위를 흰 배경에 그린다(격자·커서·선택 표시는 제외, 영상은 자리 표시만)
    exportDataUrl(padding = 40, maxSide = 4096)
    {
        if (this.objects.length === 0)
        {
            return null; // 내보낼 객체 없음
        }
        let minX = Infinity; // 최소 X
        let minY = Infinity; // 최소 Y
        let maxX = -Infinity; // 최대 X
        let maxY = -Infinity; // 최대 Y
        for (const o of this.objects)
        {
            minX = Math.min(minX, o.x); // 최소 X 갱신
            minY = Math.min(minY, o.y); // 최소 Y 갱신
            maxX = Math.max(maxX, o.x + o.width); // 최대 X 갱신
            maxY = Math.max(maxY, o.y + o.height); // 최대 Y 갱신
        }
        const width = maxX - minX + padding * 2; // 그림 너비(여백 포함)
        const height = maxY - minY + padding * 2; // 그림 높이
        const scale = Math.min(1, maxSide / Math.max(width, height)); // 너무 큰 보드는 긴 변이 maxSide 가 되게 축소
        const off = document.createElement('canvas'); // 내보내기용 캔버스
        off.width = Math.max(1, Math.round(width * scale)); // 픽셀 너비
        off.height = Math.max(1, Math.round(height * scale)); // 픽셀 높이
        const ctx = off.getContext('2d'); // 내보내기용 컨텍스트
        ctx.fillStyle = '#ffffff'; // 흰 배경
        ctx.fillRect(0, 0, off.width, off.height); // 배경 채우기
        ctx.scale(scale, scale); // 축소 배율
        ctx.translate(padding - minX, padding - minY); // 객체 범위를 그림 안으로 이동
        const saved = { ctx: this.ctx, view: this.view, moves: this.moves, editingId: this.editingId }; // 화면용 상태 보관
        this.ctx = ctx; // 그리기·글 측정을 내보내기용 컨텍스트로
        this.view = { scale, x: 0, y: 0 }; // 선 굵기 보정용 배율
        this.moves = new Map(); // 이동 미리보기 제외
        this.editingId = null; // 편집 중인 메모도 글 포함
        try
        {
            for (const l of this.links)
            {
                this.drawLink(ctx, l, false); // 연결선
            }
            for (const o of this.objects)
            {
                this.drawObject(ctx, o); // 객체
            }
        }
        finally
        {
            this.ctx = saved.ctx; // 화면용 상태 복원
            this.view = saved.view;
            this.moves = saved.moves;
            this.editingId = saved.editingId;
        }
        return off.toDataURL('image/png'); // PNG 데이터 URL
    }

    static segmentDistance(px, py, a, b)
    {
        const vx = b[0] - a[0]; // 선분 벡터 X
        const vy = b[1] - a[1]; // 선분 벡터 Y
        const len2 = vx * vx + vy * vy; // 길이 제곱
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / len2)); // 투영 비율
        const cx = a[0] + t * vx; // 가장 가까운 점 X
        const cy = a[1] + t * vy; // 가장 가까운 점 Y
        return Math.hypot(px - cx, py - cy); // 거리
    }

    invalidate()
    {
        if (!this.frame)
        {
            this.frame = requestAnimationFrame(() => this.render()); // 프레임 예약
        }
    }

    render()
    {
        this.frame = 0; // 예약 해제
        const ctx = this.ctx; // 컨텍스트
        const width = this.el.width / this.dpr; // 표시 너비
        const height = this.el.height / this.dpr; // 표시 높이
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); // 배율 초기화
        ctx.clearRect(0, 0, width, height); // 화면 지우기
        this.drawGrid(ctx, width, height); // 격자
        ctx.save(); // 뷰포트 변환 시작
        ctx.translate(this.view.x, this.view.y); // 이동
        ctx.scale(this.view.scale, this.view.scale); // 확대
        for (const l of this.links)
        {
            this.drawLink(ctx, l, l.link_id === this.selectedLinkId); // 연결선(객체 아래)
        }
        for (const o of this.objects)
        {
            this.drawObject(ctx, o); // 확정 객체
        }
        for (const p of this.pending.values())
        {
            this.drawObject(ctx, p, 0.6); // 저장 대기 초안(반투명)
        }
        for (const p of this.previews.values())
        {
            this.drawObject(ctx, { type: 'stroke', payload: { points: p.points }, style: p.style }, 0.7); // 타인 미리보기
        }
        if (this.draft)
        {
            this.drawObject(ctx, this.draft); // 내 초안
        }
        if (this.linkDraft)
        {
            const a = this.linkDraft.from; // 출발 객체
            const pa = this.displayPosition(a); // 출발 위치
            ctx.save(); // 스타일 시작
            ctx.strokeStyle = '#2563eb'; // 고무줄 색
            ctx.lineWidth = 2 / this.view.scale; // 화면 기준 2px
            ctx.setLineDash([8 / this.view.scale, 6 / this.view.scale]); // 점선
            ctx.beginPath(); // 경로
            ctx.moveTo(pa.x + a.width / 2, pa.y + a.height / 2); // 출발 중심
            ctx.lineTo(this.linkDraft.to.x, this.linkDraft.to.y); // 현재 커서
            ctx.stroke(); // 고무줄 선
            ctx.restore(); // 스타일 끝
        }
        if (this.marquee)
        {
            const m = this.marquee; // 영역 선택
            ctx.save(); // 스타일 시작
            ctx.fillStyle = 'rgba(37, 99, 235, 0.08)'; // 영역 채우기
            ctx.strokeStyle = '#2563eb'; // 영역 테두리
            ctx.lineWidth = 1 / this.view.scale; // 화면 기준 1px
            ctx.setLineDash([6 / this.view.scale, 4 / this.view.scale]); // 점선
            ctx.fillRect(m.x, m.y, m.width, m.height); // 채우기
            ctx.strokeRect(m.x, m.y, m.width, m.height); // 테두리
            ctx.restore(); // 스타일 끝
        }
        for (const [id, lock] of this.locks)
        {
            const o = this.findObject(id); // 잠긴 객체
            if (o)
            {
                this.drawOutline(ctx, o, lock.color || '#999999'); // 타인 잠금 테두리
            }
        }
        for (const id of this.selectedIds)
        {
            const selected = this.findObject(id); // 선택 객체
            if (selected)
            {
                this.drawOutline(ctx, selected, '#2563eb'); // 선택 테두리
            }
        }
        const resizable = this.resizeTarget(); // 크기 조절 가능한 단일 선택 객체
        if (resizable)
        {
            const size = 8 / this.view.scale; // 화면 기준 8px 핸들
            ctx.save(); // 핸들 스타일 시작
            ctx.fillStyle = '#ffffff'; // 핸들 배경
            ctx.strokeStyle = '#2563eb'; // 핸들 테두리
            ctx.lineWidth = 1.5 / this.view.scale; // 화면 기준 1.5px
            for (const [hx, hy] of Object.values(this.handlePoints(resizable)))
            {
                ctx.fillRect(hx - size / 2, hy - size / 2, size, size); // 핸들 채우기
                ctx.strokeRect(hx - size / 2, hy - size / 2, size, size); // 핸들 테두리
            }
            ctx.restore(); // 핸들 스타일 끝
        }
        ctx.restore(); // 뷰포트 변환 끝
        for (const [id, lock] of this.locks)
        {
            const o = this.findObject(id); // 잠긴 객체
            if (o)
            {
                const pos = this.displayPosition(o); // 표시 위치
                const s = this.toScreen(pos.x, pos.y); // 화면 좌표
                this.drawLabel(ctx, s.x, s.y - 22, lock.display_name + ' 편집 중', lock.color || '#999999'); // 잠금 이름표
            }
        }
        for (const c of this.cursors.values())
        {
            this.drawCursor(ctx, c); // 타인 커서(화면 좌표)
        }
        if (this.afterRender)
        {
            this.afterRender(); // 영상 오버레이 위치 동기화
        }
    }

    drawGrid(ctx, width, height)
    {
        let step = 50; // 기본 격자 간격(월드)
        while (step * this.view.scale < 24)
        {
            step *= 2; // 축소 시 간격 확대
        }
        while (step * this.view.scale > 160)
        {
            step /= 2; // 확대 시 간격 축소
        }
        const screenStep = step * this.view.scale; // 화면 간격
        const startX = this.view.x % screenStep; // 첫 세로선
        const startY = this.view.y % screenStep; // 첫 가로선
        ctx.strokeStyle = '#e5e7eb'; // 격자 색
        ctx.lineWidth = 1; // 격자 굵기
        ctx.beginPath(); // 경로 시작
        for (let x = startX; x < width; x += screenStep)
        {
            ctx.moveTo(Math.round(x) + 0.5, 0); // 세로선 시작
            ctx.lineTo(Math.round(x) + 0.5, height); // 세로선 끝
        }
        for (let y = startY; y < height; y += screenStep)
        {
            ctx.moveTo(0, Math.round(y) + 0.5); // 가로선 시작
            ctx.lineTo(width, Math.round(y) + 0.5); // 가로선 끝
        }
        ctx.stroke(); // 격자 그리기
    }

    drawObject(ctx, o, alpha = 1)
    {
        const mv = o.object_id !== undefined ? this.moves.get(o.object_id) : null; // 이동·크기 조절 미리보기
        const resized = mv && mv.width !== undefined && o.type !== 'stroke'; // 크기 조절 중 여부
        if (resized)
        {
            o = { ...o, x: mv.x, y: mv.y, width: mv.width, height: mv.height }; // 미리보기 크기로 그릴 복사본
        }
        ctx.save(); // 객체 변환 시작
        if (mv && !resized)
        {
            ctx.translate(mv.x - o.x, mv.y - o.y); // 이동 중 위치로 평행 이동
        }
        ctx.globalAlpha = alpha; // 투명도
        const style = o.style || {}; // 스타일
        if (o.type === 'stroke')
        {
            const points = (o.payload && o.payload.points) || []; // 획 좌표
            if (points.length > 0)
            {
                ctx.strokeStyle = style.color || '#222222'; // 선 색
                ctx.lineWidth = style.width || 3; // 선 굵기
                ctx.lineCap = 'round'; // 끝 모양
                ctx.lineJoin = 'round'; // 꺾임 모양
                ctx.beginPath(); // 경로 시작
                ctx.moveTo(points[0][0], points[0][1]); // 첫 점
                for (let i = 1; i < points.length; i++)
                {
                    ctx.lineTo(points[i][0], points[i][1]); // 다음 점
                }
                if (points.length === 1)
                {
                    ctx.lineTo(points[0][0] + 0.01, points[0][1]); // 점 하나도 표시
                }
                ctx.stroke(); // 획 그리기
            }
        }
        else if (o.type === 'rect' || o.type === 'ellipse')
        {
            ctx.strokeStyle = style.stroke || '#222222'; // 테두리 색
            ctx.lineWidth = style.width || 2; // 테두리 굵기
            ctx.beginPath(); // 경로 시작
            if (o.type === 'rect')
            {
                ctx.rect(o.x, o.y, o.width, o.height); // 사각형
            }
            else
            {
                ctx.ellipse(o.x + o.width / 2, o.y + o.height / 2, o.width / 2, o.height / 2, 0, 0, Math.PI * 2); // 타원
            }
            if (style.fill)
            {
                ctx.fillStyle = style.fill; // 채우기 색
                ctx.fill(); // 채우기
            }
            ctx.stroke(); // 테두리
        }
        else if (o.type === 'image')
        {
            const entry = o.payload && o.payload.url ? this.imageFor(o.payload.url) : null; // 이미지 캐시
            if (entry && !entry.failed && entry.img.complete && entry.img.naturalWidth > 0)
            {
                ctx.drawImage(entry.img, o.x, o.y, o.width, o.height); // 이미지 그리기
            }
            else
            {
                ctx.fillStyle = entry && entry.failed ? '#fee2e2' : '#f3f4f6'; // 실패·로딩 배경
                ctx.fillRect(o.x, o.y, o.width, o.height); // 자리 표시
                ctx.strokeStyle = '#9ca3af'; // 테두리 색
                ctx.lineWidth = 1 / this.view.scale; // 화면 기준 1px
                ctx.strokeRect(o.x, o.y, o.width, o.height); // 테두리
                ctx.fillStyle = '#6b7280'; // 글자 색
                ctx.font = (12 / this.view.scale) + 'px sans-serif'; // 화면 기준 12px
                ctx.fillText(entry && entry.failed ? '이미지를 불러올 수 없음' : '이미지 불러오는 중…', o.x + 8 / this.view.scale, o.y + 20 / this.view.scale); // 안내 문구
            }
        }
        else if (o.type === 'video')
        {
            const bar = BoardCanvas.VIDEO_BAR; // 제목 막대 높이
            ctx.fillStyle = '#111827'; // 재생 영역 배경(iframe 이 위에 겹침)
            ctx.fillRect(o.x, o.y + bar, o.width, Math.max(0, o.height - bar)); // 재생 영역
            ctx.fillStyle = '#374151'; // 제목 막대 색
            ctx.fillRect(o.x, o.y, o.width, bar); // 제목 막대(선택·이동 손잡이)
            ctx.fillStyle = '#fff'; // 글자 색
            ctx.font = '13px sans-serif'; // 막대 글꼴(월드 단위, 확대 시 함께 커짐)
            const label = o.payload && o.payload.provider ? ({ youtube: 'YouTube', vimeo: 'Vimeo' }[o.payload.provider] ?? o.payload.provider) : '영상'; // 서비스 이름
            ctx.fillText('▶ ' + label + (o.payload && o.payload.source_url ? ' · ' + o.payload.source_url : ''), o.x + 8, o.y + bar - 9, o.width - 16); // 제목 표시
        }
        else if (o.type === 'task')
        {
            const task = this.tasks.get(o.task_id); // 업무 원본
            const colors = { todo: '#9ca3af', doing: '#2563eb', done: '#16a34a' }; // 상태 색
            const labels = { todo: '할 일', doing: '진행 중', done: '완료' }; // 상태 이름
            const accent = task ? (colors[task.status] ?? '#9ca3af') : '#9ca3af'; // 강조 색
            ctx.fillStyle = '#ffffff'; // 카드 배경
            ctx.fillRect(o.x, o.y, o.width, o.height); // 카드
            ctx.fillStyle = accent; // 상태 띠 색
            ctx.fillRect(o.x, o.y, 6, o.height); // 왼쪽 상태 띠
            ctx.strokeStyle = accent; // 테두리 색
            ctx.lineWidth = 1.5; // 테두리 굵기
            ctx.strokeRect(o.x, o.y, o.width, o.height); // 테두리
            const due = TaskBoard.dueInfo(task); // 마감 상태(작업실 현황판과 같은 기준)
            let tagWidth = 0; // 오른쪽 위 마감 표시가 차지하는 폭
            if (due.state === 'overdue' || due.state === 'today' || due.state === 'soon')
            {
                ctx.font = 'bold 11px sans-serif'; // 표시 글꼴
                tagWidth = Math.min(ctx.measureText(due.label).width + 12, Math.max(0, o.width - 28)); // 글 폭 + 여백(블럭이 좁으면 블럭 안으로)
                ctx.fillStyle = due.state === 'overdue' ? '#dc2626' : '#d97706'; // 지남은 빨강, 오늘·임박은 주황
                ctx.fillRect(o.x + o.width - tagWidth - 8, o.y + 9, tagWidth, 18); // 표시 배경
                ctx.fillStyle = '#ffffff'; // 표시 글자 색
                ctx.fillText(due.label, o.x + o.width - tagWidth - 2, o.y + 22, tagWidth - 12); // 지남 일수·오늘 마감·D-n
                tagWidth += 8; // 제목과의 간격
            }
            ctx.fillStyle = '#111827'; // 제목 색
            ctx.font = 'bold 15px sans-serif'; // 제목 글꼴
            ctx.fillText(task ? task.title : '업무 #' + o.task_id, o.x + 14, o.y + 24, Math.max(10, o.width - 24 - tagWidth)); // 제목(마감 표시와 겹치지 않게)
            ctx.font = '12px sans-serif'; // 본문 글꼴
            ctx.fillStyle = accent; // 상태 색
            ctx.fillText(task ? (labels[task.status] ?? task.status) : '불러오는 중…', o.x + 14, o.y + 46); // 상태
            ctx.fillStyle = '#6b7280'; // 보조 글자 색
            ctx.fillText((task && task.assignee_name ? '담당 ' + task.assignee_name : '담당자 없음') + (task && task.due_at ? ' · 마감 ' + task.due_at : ''), o.x + 14, o.y + 66, o.width - 24); // 담당·마감
            ctx.fillStyle = '#9ca3af'; // 안내 글자 색
            ctx.font = '11px sans-serif'; // 안내 글꼴
            ctx.fillText('공유 업무 #' + o.task_id, o.x + 14, o.y + o.height - 10); // 공유 표시
        }
        else if (o.type === 'note')
        {
            const n = BoardCanvas.NOTE; // 안쪽 여백
            const f = BoardCanvas.noteFont(o); // 글자 크기·줄 높이
            const text = o.payload && typeof o.payload.text === 'string' ? o.payload.text : ''; // 메모 글
            if (style.fill)
            {
                ctx.fillStyle = style.fill; // 배경 색
                ctx.fillRect(o.x, o.y, o.width, o.height); // 메모 배경
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.14)'; // 옅은 테두리
                ctx.lineWidth = 1; // 테두리 굵기
                ctx.strokeRect(o.x, o.y, o.width, o.height); // 테두리
            }
            else if (text === '')
            {
                ctx.strokeStyle = '#9ca3af'; // 빈 텍스트 상자 표시 색
                ctx.lineWidth = 1 / this.view.scale; // 화면 기준 1px
                ctx.setLineDash([4 / this.view.scale, 4 / this.view.scale]); // 점선
                ctx.strokeRect(o.x, o.y, o.width, o.height); // 배경 없는 빈 상자의 위치 표시
                ctx.setLineDash([]); // 점선 해제
            }
            if (this.editingId !== o.object_id)
            {
                ctx.beginPath(); // 글이 메모 밖으로 넘치지 않게 자르는 영역
                ctx.rect(o.x, o.y, o.width, o.height); // 메모 영역
                ctx.clip(); // 영역 밖 숨김
                ctx.font = f.size + 'px sans-serif'; // 메모 글꼴
                ctx.textBaseline = 'top'; // 위쪽 기준 배치
                if (text === '')
                {
                    ctx.fillStyle = '#9ca3af'; // 안내 글자 색
                    ctx.fillText('더블클릭해 입력', o.x + n.pad, o.y + n.pad + 3); // 빈 메모 안내
                }
                else
                {
                    ctx.fillStyle = style.color || '#222222'; // 글자 색
                    this.noteLines(o).forEach((line, i) => ctx.fillText(line, o.x + n.pad, o.y + n.pad + 3 + i * f.line)); // 줄마다 그리기
                }
            }
        }
        ctx.restore(); // 객체 변환 끝
    }

    drawOutline(ctx, o, color)
    {
        const r = this.displayRect(o); // 표시 사각형(이동·크기 조절 반영)
        const pad = 4 / this.view.scale; // 화면 4px 여백
        ctx.save(); // 테두리 스타일 시작
        ctx.strokeStyle = color; // 테두리 색
        ctx.lineWidth = 1.5 / this.view.scale; // 화면 기준 1.5px
        ctx.setLineDash([6 / this.view.scale, 4 / this.view.scale]); // 점선
        ctx.strokeRect(r.x - pad, r.y - pad, r.width + pad * 2, r.height + pad * 2); // 경계 사각형
        ctx.restore(); // 테두리 스타일 끝
    }

    drawLabel(ctx, sx, sy, text, color)
    {
        ctx.font = '12px sans-serif'; // 글꼴
        const w = ctx.measureText(text).width + 10; // 라벨 너비
        ctx.fillStyle = color; // 배경 색
        ctx.fillRect(sx, sy, w, 18); // 배경
        ctx.fillStyle = '#fff'; // 글자 색
        ctx.fillText(text, sx + 5, sy + 13); // 글자
    }

    drawCursor(ctx, c)
    {
        const s = this.toScreen(c.x, c.y); // 화면 좌표
        ctx.fillStyle = c.color; // 커서 색
        ctx.beginPath(); // 화살표 경로
        ctx.moveTo(s.x, s.y); // 꼭짓점
        ctx.lineTo(s.x + 12, s.y + 5); // 오른쪽 아래
        ctx.lineTo(s.x + 5, s.y + 12); // 왼쪽 아래
        ctx.closePath(); // 닫기
        ctx.fill(); // 화살표 채우기
        this.drawLabel(ctx, s.x + 12, s.y + 12, c.display_name || '', c.color); // 이름표
    }
}

BoardCanvas.VIDEO_BAR = 28; // 영상 카드 제목 막대 높이(월드 단위)
BoardCanvas.RESIZABLE = ['rect', 'ellipse', 'image', 'video', 'task', 'note']; // 크기 조절 핸들을 표시할 객체 유형
BoardCanvas.NOTE = { font: 16, line: 22, pad: 10 }; // 메모 기본 글자 크기·그때의 줄 높이·안쪽 여백(월드 단위)

// 메모 한 개의 글자 크기와 줄 높이. style.size 가 없으면(예전에 만든 메모) 기본 크기
BoardCanvas.noteFont = (o) =>
{
    const size = o && o.style && Number.isFinite(o.style.size) ? o.style.size : BoardCanvas.NOTE.font; // 글자 크기
    return { size, line: Math.round(size * BoardCanvas.NOTE.line / BoardCanvas.NOTE.font) }; // 줄 높이는 글자 크기에 비례
};

window.BoardCanvas = BoardCanvas; // 전역 노출
