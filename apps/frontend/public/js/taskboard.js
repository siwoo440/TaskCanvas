// 업무 현황판: 공유 업무를 상태별 세 열에 카드로 보여 주고, 카드를 끌어 다른 열에 놓으면 상태 변경을 요청한다
// 마감 표시 계산(dueInfo)은 보드의 업무 블럭(canvas.js)도 함께 쓴다
'use strict';

const TaskBoard = {
    STATUSES: ['todo', 'doing', 'done'], // 열 순서
    LABELS: { todo: '할 일', doing: '진행 중', done: '완료' }, // 열 이름
    SOON_DAYS: 3, // 마감이 이 일수 안으로 다가오면 임박으로 표시
    DRAG_START: 6, // 이만큼(화면 픽셀) 움직여야 끌기로 봄. 그보다 적으면 클릭
}; // 업무 현황판 모듈

// 'YYYY-MM-DD' 를 이 PC 의 날짜(자정)로 바꾼다. 형식이 다르면 null
TaskBoard.parseDate = (text) =>
{
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? ''); // 날짜 형식
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; // 지역 시간 자정
};

// 업무의 마감 상태: none(마감 없음) · closed(완료한 업무) · overdue(지남) · today(오늘) · soon(임박) · later(여유)
// label 은 카드와 블럭에 적을 짧은 글, days 는 오늘부터 마감까지 남은 날 수(지났으면 음수)
TaskBoard.dueInfo = (task, now = new Date()) =>
{
    const due = task ? TaskBoard.parseDate(task.due_at) : null; // 마감일
    if (!due)
    {
        return { state: 'none', label: '', days: null }; // 마감 없음
    }
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // 오늘 자정
    const days = Math.round((due - today) / 86400000); // 남은 날 수(서머타임이 있어도 하루 단위로 맞춤)
    const short = task.due_at.slice(5); // MM-DD
    if (task.status === 'done')
    {
        return { state: 'closed', label: '마감 ' + short, days }; // 끝낸 업무는 지났어도 경고하지 않음
    }
    if (days < 0)
    {
        return { state: 'overdue', label: -days + '일 지남', days }; // 마감 지남
    }
    if (days === 0)
    {
        return { state: 'today', label: '오늘 마감', days }; // 오늘이 마감
    }
    if (days <= TaskBoard.SOON_DAYS)
    {
        return { state: 'soon', label: 'D-' + days, days }; // 마감 임박
    }
    return { state: 'later', label: '마감 ' + short, days }; // 아직 여유 있음
};

// 한 열 안의 순서: 마감이 이른 것부터, 마감 없는 업무는 뒤로, 같으면 만든 순서
TaskBoard.compare = (a, b) =>
{
    const da = a.due_at ?? '9999-99-99'; // 마감 없는 업무는 맨 뒤
    const db = b.due_at ?? '9999-99-99'; // 비교 대상도 같은 규칙
    return da < db ? -1 : da > db ? 1 : a.task_id - b.task_id;
};

// root 요소에 현황판을 만든다. options: onMove(task, status) 카드를 다른 열에 놓음, onOpen(task) 카드를 누름
TaskBoard.mount = (root, options) =>
{
    const board = { tasks: [], editable: false, drag: null, suppressClick: false, stale: false }; // 현황판 상태(stale: 끄는 동안 미뤄 둔 다시 그리기가 있음)
    const lists = new Map(); // status → 카드 목록 요소
    const counts = new Map(); // status → 개수 표시 요소

    root.innerHTML = ''; // 초기화
    for (const status of TaskBoard.STATUSES)
    {
        const col = document.createElement('section'); // 열
        const head = document.createElement('h3'); // 열 제목
        const count = document.createElement('span'); // 개수
        const list = document.createElement('ul'); // 카드 목록
        col.className = 'tb-col ' + status; // 상태별 색
        col.dataset.status = status; // 놓을 때 읽는 상태 값
        head.textContent = TaskBoard.LABELS[status]; // 열 이름
        count.className = 'count'; // 흐린 숫자
        head.appendChild(count); // 제목 옆 개수
        list.className = 'tb-list'; // 카드 목록
        col.append(head, list); // 열 구성
        root.appendChild(col); // 현황판에 추가
        lists.set(status, list); // 목록 기억
        counts.set(status, count); // 개수 요소 기억
    }

    function card(task)
    {
        const li = document.createElement('li'); // 목록 항목
        const btn = document.createElement(board.editable ? 'button' : 'div'); // 카드(바꿀 수 있으면 키보드로도 열 수 있게 버튼, 아니면 글만)
        const title = document.createElement('strong'); // 제목
        const meta = document.createElement('span'); // 담당자
        const due = TaskBoard.dueInfo(task); // 마감 상태
        btn.className = 'tb-card' + (board.editable ? ' draggable' : ''); // 바꿀 수 있을 때만 끌 수 있음
        btn.dataset.taskId = String(task.task_id); // 업무 ID
        if (board.editable)
        {
            btn.type = 'button'; // 제출 방지
            btn.title = '끌어서 상태 변경, 눌러서 수정'; // 사용법
        }
        title.textContent = task.title; // 서버 값은 textContent 로만 표시
        meta.className = 'tb-meta'; // 보조 글자
        meta.textContent = task.assignee_name ? '담당 ' + task.assignee_name : '담당자 없음'; // 담당자
        btn.append(title, meta); // 카드 구성
        if (due.state !== 'none')
        {
            const tag = document.createElement('span'); // 마감 표시
            tag.className = 'tb-due ' + due.state; // 상태별 색
            tag.textContent = due.label; // 짧은 글
            tag.title = '마감 ' + task.due_at; // 정확한 날짜
            btn.appendChild(tag); // 카드에 추가
        }
        li.appendChild(btn); // 항목 구성
        return li;
    }

    function paint()
    {
        for (const status of TaskBoard.STATUSES)
        {
            const list = lists.get(status); // 이 열의 목록
            const tasks = board.tasks.filter((t) => t.status === status).sort(TaskBoard.compare); // 이 열의 업무
            list.innerHTML = ''; // 초기화
            counts.get(status).textContent = String(tasks.length); // 개수
            for (const task of tasks)
            {
                list.appendChild(card(task)); // 카드 추가
            }
            if (tasks.length === 0)
            {
                const empty = document.createElement('li'); // 빈 안내
                empty.className = 'tb-empty'; // 흐린 글자
                empty.textContent = '없음'; // 문구
                list.appendChild(empty); // 추가
            }
        }
    }

    function columnAt(x, y)
    {
        const el = document.elementFromPoint(x, y); // 포인터 아래 요소(끌려 다니는 카드는 pointer-events 가 없어 걸리지 않음)
        return el ? el.closest('.tb-col') : null; // 그 요소가 속한 열
    }

    // 끌기를 끝내고 화면을 정리한다. 끄는 동안 미뤄 둔 다시 그리기가 있으면 여기서 그린다(afterClick: 이어지는 클릭이 처리된 뒤에 그림)
    function endDrag(afterClick = false)
    {
        const drag = board.drag; // 진행 중이던 끌기
        board.drag = null; // 끌기 종료
        if (!drag)
        {
            return;
        }
        if (drag.ghost)
        {
            drag.ghost.remove(); // 따라다니던 카드 제거
        }
        drag.source.classList.remove('dragging'); // 원래 카드 표시 복원
        for (const col of root.querySelectorAll('.tb-col.drop-target'))
        {
            col.classList.remove('drop-target'); // 놓을 열 강조 해제
        }
        if (board.stale)
        {
            board.stale = false; // 미뤄 둔 다시 그리기 처리
            if (afterClick)
            {
                setTimeout(paint, 0); // 누르기만 한 경우: 카드가 바뀌기 전에 클릭이 먼저 처리되게 함
            }
            else
            {
                paint(); // 끄는 동안 바뀐 내용 반영
            }
        }
    }

    root.addEventListener('pointerdown', (e) =>
    {
        const source = e.target.closest('.tb-card'); // 누른 카드
        if (!source || !board.editable || e.button !== 0 || board.drag)
        {
            return; // 카드가 아니거나 편집 불가·보조 버튼·이미 끄는 중
        }
        const task = board.tasks.find((t) => String(t.task_id) === source.dataset.taskId); // 카드의 업무
        if (!task)
        {
            return;
        }
        board.drag = { task, source, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, ghost: null, target: null }; // 끌기 후보(아직 움직이지 않음)
        source.setPointerCapture(e.pointerId); // 카드 밖으로 나가도 이동·놓기 이벤트를 계속 받음
    });

    root.addEventListener('pointermove', (e) =>
    {
        const drag = board.drag; // 진행 중인 끌기
        if (!drag || e.pointerId !== drag.pointerId)
        {
            return;
        }
        if (!drag.ghost)
        {
            if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < TaskBoard.DRAG_START)
            {
                return; // 아직 클릭 범위
            }
            const rect = drag.source.getBoundingClientRect(); // 원래 카드 위치
            drag.offsetX = drag.startX - rect.left; // 카드 안에서 잡은 위치
            drag.offsetY = drag.startY - rect.top; // 세로 방향도 같음
            drag.ghost = drag.source.cloneNode(true); // 포인터를 따라다닐 카드
            drag.ghost.classList.add('tb-ghost'); // 떠 있는 모양
            drag.ghost.style.width = rect.width + 'px'; // 원래 폭 유지
            document.body.appendChild(drag.ghost); // 화면 맨 위에 표시
            drag.source.classList.add('dragging'); // 원래 자리는 흐리게
        }
        drag.ghost.style.left = e.clientX - drag.offsetX + 'px'; // 포인터 따라 이동
        drag.ghost.style.top = e.clientY - drag.offsetY + 'px'; // 세로 위치
        const col = columnAt(e.clientX, e.clientY); // 포인터 아래 열
        if (col !== drag.target)
        {
            if (drag.target)
            {
                drag.target.classList.remove('drop-target'); // 이전 열 강조 해제
            }
            drag.target = col; // 놓을 열
            if (col && col.dataset.status !== drag.task.status)
            {
                col.classList.add('drop-target'); // 상태가 바뀌는 열만 강조
            }
        }
    });

    root.addEventListener('pointerup', (e) =>
    {
        const drag = board.drag; // 진행 중인 끌기
        if (!drag || e.pointerId !== drag.pointerId)
        {
            return;
        }
        const moved = drag.ghost !== null; // 실제로 끌었는지
        const status = moved && drag.target ? drag.target.dataset.status : null; // 놓은 열의 상태
        endDrag(!moved); // 화면 정리
        if (moved)
        {
            board.suppressClick = true; // 끌기 뒤에 이어지는 클릭은 카드 열기로 보지 않음
            setTimeout(() => { board.suppressClick = false; }, 0); // 이번 입력의 클릭만 막음
            const latest = board.tasks.find((t) => t.task_id === drag.task.task_id); // 끄는 동안 다른 사람이 바꿨을 수 있으므로 지금의 업무 기준
            if (status && latest && board.editable && status !== latest.status)
            {
                options.onMove(latest, status); // 상태 변경 요청
            }
        }
    });

    root.addEventListener('pointercancel', () => endDrag()); // 터치 스크롤 등으로 끌기가 끊기면 원래대로

    root.addEventListener('click', (e) =>
    {
        const source = e.target.closest('.tb-card'); // 누른 카드
        if (!source || board.suppressClick)
        {
            return; // 카드가 아니거나 방금 끌어서 놓은 직후
        }
        const task = board.tasks.find((t) => String(t.task_id) === source.dataset.taskId); // 카드의 업무
        if (task && board.editable)
        {
            options.onOpen(task); // 수정 대화상자(키보드의 Enter·Space 도 여기로 옴)
        }
    });

    // 업무 목록과 편집 가능 여부를 받아 다시 그린다. 카드를 누르거나 끄는 중이면 그리기를 미뤘다가 끝난 뒤에 그린다
    board.render = (tasks, editable) =>
    {
        board.tasks = tasks; // 업무 목록
        board.editable = editable; // 편집 가능 여부
        if (board.drag)
        {
            board.stale = true; // 지금 그리면 끌던 카드가 사라져 끌기가 끊기므로 미룸(다른 사람의 변경이 들어와도 끌기는 유지)
            return;
        }
        paint(); // 카드 그리기
    };

    return board;
};

window.TaskBoard = TaskBoard; // 전역 노출
