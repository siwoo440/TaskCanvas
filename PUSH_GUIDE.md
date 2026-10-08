# GitHub 최초 커밋 업로드 안내

---

## 현재 상황

GitHub 저장소: https://github.com/siwoo440/TaskCanvas

파일 생성·커밋을 GitHub 연결에서 시도했지만 `403 Resource not accessible by integration` 오류로 차단되었습니다. **이 패키지는 로컬 Git 최초 커밋을 생성한 결과이며, 아직 원격 저장소에 업로드된 것이 아닙니다.**

---

## 가장 간단한 방법: Git 번들 업로드

`TaskCanvas_initial.bundle` 파일을 다운로드한 뒤 Windows PowerShell에서 다음 명령을 사용합니다.

```powershell
git clone -b main .\TaskCanvas_initial.bundle TaskCanvas
cd TaskCanvas
git remote set-url origin https://github.com/siwoo440/TaskCanvas.git
git push -u origin main
```

- GitHub 인증을 요청하면 본인의 Git Credential Manager / 계정 로그인을 이용합니다.
- **원격 저장소가 아직 비어 있을 때** 적용하는 안내입니다. 이미 커밋이 있다면 먼저 원격 변경 사항을 확인해야 합니다.
- 번들은 `.git` 기록까지 포함한 **로컬 최초 커밋 1개**입니다. 이미지와 PPT도 Git 객체 안에 포함됩니다.

---

## ZIP에서 직접 업로드

`TaskCanvas_initial_repository.zip`을 압축 해제한 뒤 폴더 안에서:

```powershell
git init -b main
git add .
git commit -m "chore: initialize TaskCanvas planning and project assets"
git remote add origin https://github.com/siwoo440/TaskCanvas.git
git push -u origin main
```

이 방법은 새 커밋을 직접 만들며 Git 사용자의 이름·이메일 설정이 필요할 수 있습니다.

---

## GitHub 연결 오류 해결

GitHub 쪽 ChatGPT 연결 앱이 해당 저장소에 **Contents 쓰기 권한**을 갖고 있는지, 저장소 접근 범위가 `TaskCanvas`를 포함하는지 확인해야 합니다. 연결을 다시 승인하더라도 앱 자체에 쓰기 권한이 없으면 직접 `git push`가 필요합니다.
