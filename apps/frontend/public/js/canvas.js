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
        this.moves = new Map(); // 이동 중 위치 object_id → {x, y} (내 드래그·타인 미리보기)
        this.selectedId = null; // 선택한 객체 ID
        this.draft = null; // 지금 그리는 중인 내 초안
        this.images = new Map(); // 이미지 캐시 url → {img, failed}
        this.tasks = new Map(); // 공유 업무 원본 task_id → task (app 이 채움)
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
        this.selectedId = null; // 선택 해제
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
        if (this.selectedId === id)
        {
            this.selectedId = null; // 선택 해제
        }
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
            else if (o.type === 'rect' || o.type === 'image' || o.type === 'video' || o.type === 'task')
            {
                if (wx >= pos.x - tol && wx <= pos.x + o.width + tol && wy >= pos.y - tol && wy <= pos.y + o.height + tol)
                {
                    return o; // 경계 사각형 안(영상은 iframe 영역을 제외한 제목 막대만 캔버스에 도달)
                }
            }
            else if (o.type === 'ellipse')
            {
                const rx = o.width / 2 + tol; // 가로 반지름
                const ry = o.height / 2 + tol; // 세로 반지름
                const nx = (wx - (pos.x + o.width / 2)) / rx; // 정규화 X
                const ny = (wy - (pos.y + o.height / 2)) / ry; // 정규화 Y
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
        for (const [id, lock] of this.locks)
        {
            const o = this.findObject(id); // 잠긴 객체
            if (o)
            {
                this.drawOutline(ctx, o, lock.color || '#999999'); // 타인 잠금 테두리
            }
        }
        const selected = this.selectedId !== null ? this.findObject(this.selectedId) : null; // 선택 객체
        if (selected)
        {
            this.drawOutline(ctx, selected, '#2563eb'); // 선택 테두리
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
        const mv = o.object_id !== undefined ? this.moves.get(o.object_id) : null; // 이동 미리보기
        ctx.save(); // 객체 변환 시작
        if (mv)
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
            ctx.fillStyle = '#111827'; // 제목 색
            ctx.font = 'bold 15px sans-serif'; // 제목 글꼴
            ctx.fillText(task ? task.title : '업무 #' + o.task_id, o.x + 14, o.y + 24, o.width - 24); // 제목
            ctx.font = '12px sans-serif'; // 본문 글꼴
            ctx.fillStyle = accent; // 상태 색
            ctx.fillText(task ? (labels[task.status] ?? task.status) : '불러오는 중…', o.x + 14, o.y + 46); // 상태
            ctx.fillStyle = '#6b7280'; // 보조 글자 색
            ctx.fillText((task && task.assignee_name ? '담당 ' + task.assignee_name : '담당자 없음') + (task && task.due_at ? ' · 마감 ' + task.due_at : ''), o.x + 14, o.y + 66, o.width - 24); // 담당·마감
            ctx.fillStyle = '#9ca3af'; // 안내 글자 색
            ctx.font = '11px sans-serif'; // 안내 글꼴
            ctx.fillText('공유 업무 #' + o.task_id, o.x + 14, o.y + o.height - 10); // 공유 표시
        }
        ctx.restore(); // 객체 변환 끝
    }

    drawOutline(ctx, o, color)
    {
        const pos = this.displayPosition(o); // 표시 위치
        const pad = 4 / this.view.scale; // 화면 4px 여백
        ctx.save(); // 테두리 스타일 시작
        ctx.strokeStyle = color; // 테두리 색
        ctx.lineWidth = 1.5 / this.view.scale; // 화면 기준 1.5px
        ctx.setLineDash([6 / this.view.scale, 4 / this.view.scale]); // 점선
        ctx.strokeRect(pos.x - pad, pos.y - pad, o.width + pad * 2, o.height + pad * 2); // 경계 사각형
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

window.BoardCanvas = BoardCanvas; // 전역 노출
