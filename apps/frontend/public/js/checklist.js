// 업무 체크리스트: 업무의 세부 항목을 보여 주고 추가·체크·이름 변경·삭제를 요청한다(보드의 업무 패널과 작업실의 업무 대화상자가 함께 씀)
// 진행률 계산(progress)은 현황판 카드(taskboard.js)와 보드의 업무 블럭(canvas.js)도 함께 쓴다
'use strict';

const Checklist = {
    MAX_ITEMS: 30, // 업무 하나에 둘 수 있는 항목 수(서버와 같은 값)
    MAX_TITLE: 120, // 항목 이름 길이(서버와 같은 값)
}; // 체크리스트 모듈

// 업무의 진행률: total(항목 수) · done(끝낸 수) · ratio(0~1) · label("2/5")
Checklist.progress = (task) =>
{
    const items = task && Array.isArray(task.checklist) ? task.checklist : []; // 세부 항목(없는 업무는 빈 목록)
    const done = items.filter((i) => i.done).length; // 끝낸 항목 수
    return { total: items.length, done, ratio: items.length === 0 ? 0 : done / items.length, label: done + '/' + items.length };
};

// root 요소에 체크리스트를 만든다. options 의 네 함수는 서버에 저장을 요청하고 Promise 를 돌려준다:
// onAdd(task, title) 항목 추가 · onToggle(task, item, done) 체크·해제 · onRename(task, item, title) 이름 변경 · onDelete(task, item) 삭제
Checklist.mount = (root, options) =>
{
    const view = { task: null, editable: false, adding: false }; // 보여 주는 업무, 바꿀 수 있는지, 추가 요청이 진행 중인지
    const rows = new Map(); // item_id → 그 항목의 줄(li)

    const head = document.createElement('div'); // 제목 줄
    const title = document.createElement('h3'); // "체크리스트"
    const bar = document.createElement('span'); // 진행 막대
    const fill = document.createElement('i'); // 막대의 채워진 부분
    const count = document.createElement('span'); // "2/5"
    const list = document.createElement('ul'); // 항목 목록
    const empty = document.createElement('p'); // 항목이 없을 때의 안내
    const addRow = document.createElement('div'); // 추가 줄
    const addInput = document.createElement('input'); // 새 항목 이름
    const addBtn = document.createElement('button'); // 추가 버튼
    const error = document.createElement('p'); // 오류 안내

    root.innerHTML = ''; // 초기화
    root.classList.add('checklist'); // 스타일
    head.className = 'cl-head'; // 제목 줄
    title.textContent = '체크리스트'; // 제목
    bar.className = 'cl-bar'; // 진행 막대
    bar.appendChild(fill); // 채워진 부분
    count.className = 'cl-count'; // 숫자
    head.append(title, bar, count); // 제목 줄 구성
    list.className = 'cl-list'; // 목록
    empty.className = 'cl-empty muted small'; // 흐린 안내
    addRow.className = 'cl-add'; // 추가 줄
    addInput.type = 'text'; // 한 줄 입력
    addInput.maxLength = Checklist.MAX_TITLE; // 길이 제한
    addInput.setAttribute('aria-label', '새 체크리스트 항목'); // 화면 낭독기용 이름
    addBtn.type = 'button'; // 대화상자 안에서도 제출로 처리되지 않게
    addBtn.textContent = '추가'; // 버튼 글
    addRow.append(addInput, addBtn); // 추가 줄 구성
    error.className = 'error small'; // 오류 글
    error.setAttribute('role', 'alert'); // 바로 읽어 주기
    root.append(head, list, empty, addRow, error); // 전체 구성

    function items()
    {
        return view.task && Array.isArray(view.task.checklist) ? view.task.checklist : []; // 지금 업무의 항목
    }

    function find(itemId)
    {
        return items().find((i) => i.item_id === itemId) ?? null; // 번호로 항목 찾기(그 사이 지워졌으면 null)
    }

    // 저장을 요청하고, 실패하면 이유를 보여 준 뒤 서버 기준의 모습으로 되돌린다(성공하면 app 이 새 업무로 다시 그림)
    async function send(action)
    {
        error.textContent = ''; // 이전 오류 지움
        try
        {
            await action(); // 저장 요청
        }
        catch (err)
        {
            error.textContent = err.message; // 실패 안내
            paint(); // 먼저 바꿔 보인 체크 표시·이름을 원래대로
        }
    }

    function row(item)
    {
        const li = document.createElement('li'); // 항목 줄
        const box = document.createElement('input'); // 체크 상자
        const text = document.createElement('input'); // 항목 이름(바로 고칠 수 있음)
        const del = document.createElement('button'); // 삭제 버튼
        const id = item.item_id; // 이 줄의 항목 번호
        li.className = 'cl-item'; // 스타일
        box.type = 'checkbox'; // 체크 상자
        box.className = 'cl-box'; // 스타일
        text.type = 'text'; // 한 줄 입력
        text.className = 'cl-title'; // 스타일
        text.maxLength = Checklist.MAX_TITLE; // 길이 제한
        del.type = 'button'; // 제출 방지
        del.className = 'cl-del'; // 스타일
        del.textContent = '×'; // 삭제 표시
        del.title = '항목 삭제'; // 설명
        del.setAttribute('aria-label', '항목 삭제'); // 화면 낭독기용 이름
        li.append(box, text, del); // 줄 구성
        box.addEventListener('change', () =>
        {
            const now = find(id); // 지금의 항목
            if (now)
            {
                send(() => options.onToggle(view.task, now, box.checked)); // 체크·해제 저장
            }
        });
        text.addEventListener('keydown', (e) =>
        {
            if (e.key === 'Enter')
            {
                e.preventDefault(); // 대화상자 안에서 Enter 가 "저장" 버튼으로 가지 않게
                text.blur(); // 입력을 마침(아래 change 가 저장)
            }
        });
        text.addEventListener('change', () =>
        {
            const now = find(id); // 지금의 항목
            const next = text.value.trim(); // 고친 이름
            if (!now)
            {
                return; // 그 사이 지워진 항목
            }
            if (next === '' || next === now.title)
            {
                text.value = now.title; // 비웠거나 그대로면 원래 이름으로
                return;
            }
            send(() => options.onRename(view.task, now, next)); // 이름 저장
        });
        del.addEventListener('click', () =>
        {
            const now = find(id); // 지금의 항목
            if (now)
            {
                send(() => options.onDelete(view.task, now)); // 삭제 저장
            }
        });
        return li;
    }

    function paint()
    {
        const shown = items(); // 그릴 항목
        const p = Checklist.progress(view.task); // 진행률
        const full = shown.length >= Checklist.MAX_ITEMS; // 더 넣을 수 없는지
        count.textContent = p.total === 0 ? '' : p.label; // "2/5"
        bar.hidden = p.total === 0; // 항목이 없으면 막대도 숨김
        bar.classList.toggle('full', p.total > 0 && p.done === p.total); // 모두 끝내면 초록
        fill.style.width = Math.round(p.ratio * 100) + '%'; // 채워진 길이
        const keep = new Set(shown.map((i) => i.item_id)); // 남아 있는 항목 번호
        for (const [id, li] of rows)
        {
            if (!keep.has(id))
            {
                li.remove(); // 지워진 항목의 줄 제거
                rows.delete(id);
            }
        }
        shown.forEach((item, index) =>
        {
            let li = rows.get(item.item_id); // 이미 있는 줄
            if (!li)
            {
                li = row(item); // 새 항목의 줄
                rows.set(item.item_id, li);
            }
            if (list.children[index] !== li)
            {
                list.insertBefore(li, list.children[index] ?? null); // 제자리에 있는 줄은 옮기지 않음(입력 중인 칸이 초점을 잃지 않게)
            }
            const [box, text, del] = li.children; // 줄의 세 요소
            box.checked = item.done; // 체크 여부
            box.disabled = !view.editable; // 열람자는 바꿀 수 없음
            if (document.activeElement !== text)
            {
                text.value = item.title; // 이름(지금 고치는 중인 칸은 건드리지 않음)
            }
            text.readOnly = !view.editable; // 열람자는 고칠 수 없음
            del.hidden = !view.editable; // 열람자에게는 삭제 버튼을 보이지 않음
            li.classList.toggle('done', item.done); // 끝낸 항목은 흐리게 줄 그음
        });
        empty.hidden = shown.length > 0; // 항목이 있으면 안내 숨김
        empty.textContent = view.editable ? '아직 항목이 없습니다. 아래에 적고 Enter 를 누르면 추가됩니다.' : '항목이 없습니다.'; // 빈 목록 안내
        addRow.hidden = !view.editable; // 열람자에게는 추가 줄을 보이지 않음
        addInput.disabled = full; // 가득 차면 입력 막음
        addBtn.disabled = full; // 버튼도 막음
        addInput.placeholder = full ? '항목은 ' + Checklist.MAX_ITEMS + '개까지 둘 수 있습니다' : '세부 항목 추가'; // 입력 안내
    }

    function add()
    {
        const text = addInput.value.trim(); // 새 항목 이름
        if (text === '' || !view.task || !view.editable || view.adding)
        {
            return; // 빈 이름·대상 없음·권한 없음·앞선 추가가 진행 중
        }
        view.adding = true; // Enter 를 연달아 눌러도 한 번만 추가
        send(async () =>
        {
            try
            {
                await options.onAdd(view.task, text); // 추가 저장
                addInput.value = ''; // 다음 항목을 이어서 적을 수 있게 비움
            }
            finally
            {
                view.adding = false; // 다음 추가 허용
            }
        });
    }

    addBtn.addEventListener('click', add); // 추가 버튼
    addInput.addEventListener('keydown', (e) =>
    {
        if (e.key === 'Enter')
        {
            e.preventDefault(); // 대화상자 안에서 Enter 가 "저장" 버튼으로 가지 않게
            add(); // Enter 로 추가
        }
    });

    // 업무와 편집 가능 여부를 받아 다시 그린다. 다른 업무로 바뀌면 적던 글과 오류 안내를 비운다
    view.render = (task, editable) =>
    {
        if (!view.task || !task || view.task.task_id !== task.task_id)
        {
            addInput.value = ''; // 다른 업무의 입력이 남지 않게
            error.textContent = ''; // 이전 업무의 오류 지움
        }
        view.task = task; // 보여 줄 업무
        view.editable = editable; // 편집 가능 여부
        paint(); // 그리기
    };

    return view;
};

window.Checklist = Checklist; // 전역 노출
