// 보드 캔버스 렌더링: 격자, 확정 객체, 미리보기, 커서, 뷰포트(확대·이동)
'use strict';

class BoardCanvas
{
    constructor(el)
    {
        this.el = el; // canvas 요소
        this.ctx = el.getContext('2d'); // 2D 컨텍스트
        this.view = { scale: 1, x: 0, y: 0 }; // 화면 좌표 = 월드 좌표 * scale + (x, y)
        this.objects = []; // 저장 완료 객체
        this.previews = new Map(); // 타인 미리보기 stroke_id → {points, style, at}
        this.pending = new Map(); // 저장 응답 대기 중인 내 객체 request_id → 초안
        this.cursors = new Map(); // 타인 커서 guest_id → {x, y, display_name, color, at}
        this.draft = null; // 지금 그리는 중인 내 초안
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

    setObjects(list)
    {
        this.objects = list.slice(); // 객체 목록 교체
        this.previews.clear(); // 미리보기 초기화
        this.pending.clear(); // 대기 초안 초기화
        this.cursors.clear(); // 커서 초기화
        this.draft = null; // 초안 초기화
        this.invalidate(); // 다시 그리기
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
        ctx.restore(); // 뷰포트 변환 끝
        for (const c of this.cursors.values())
        {
            this.drawCursor(ctx, c); // 타인 커서(화면 좌표)
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
        ctx.globalAlpha = alpha; // 투명도
        const style = o.style || {}; // 스타일
        if (o.type === 'stroke')
        {
            const points = (o.payload && o.payload.points) || []; // 획 좌표
            if (points.length === 0)
            {
                return;
            }
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
        ctx.globalAlpha = 1; // 투명도 복원
    }

    drawCursor(ctx, c)
    {
        const sx = c.x * this.view.scale + this.view.x; // 화면 X
        const sy = c.y * this.view.scale + this.view.y; // 화면 Y
        ctx.fillStyle = c.color; // 커서 색
        ctx.beginPath(); // 화살표 경로
        ctx.moveTo(sx, sy); // 꼭짓점
        ctx.lineTo(sx + 12, sy + 5); // 오른쪽 아래
        ctx.lineTo(sx + 5, sy + 12); // 왼쪽 아래
        ctx.closePath(); // 닫기
        ctx.fill(); // 화살표 채우기
        ctx.font = '12px sans-serif'; // 이름 글꼴
        const label = c.display_name || ''; // 이름
        const w = ctx.measureText(label).width + 10; // 라벨 너비
        ctx.fillRect(sx + 12, sy + 12, w, 18); // 라벨 배경
        ctx.fillStyle = '#fff'; // 글자 색
        ctx.fillText(label, sx + 17, sy + 25); // 이름 표시
    }
}

window.BoardCanvas = BoardCanvas; // 전역 노출
