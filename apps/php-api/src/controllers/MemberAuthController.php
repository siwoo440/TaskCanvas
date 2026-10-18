<?php // 회원가입·로그인·로그아웃 HTTP 처리
declare(strict_types=1); // 엄격한 자료형 검사

final class MemberAuthController // 회원 인증 API
{ // 인증 API 시작
    private function attempt(Request $request): int // 비밀번호 검사 전 요청 제한
    { // 시도 기록 시작
        Auth::requireMutationHeader($request); // 요청 위조 방어 헤더 검사
        Throttle::check($request->clientIp()); // 기존 IP별 제한 검사
        Throttle::record($request->clientIp(), false); // 잘못된 입력도 요청 횟수에 포함
        return Database::lastId(); // 성공 시 갱신할 시도 번호
    } // 시도 기록 끝

    private function succeeded(int $attemptId): void // 성공한 인증 시도 기록
    { // 성공 기록 시작
        Database::run('UPDATE join_attempts SET succeeded = 1 WHERE attempt_id = ?', [$attemptId]); // 같은 시도 행만 갱신
    } // 성공 기록 끝

    private function loginId(Request $request): string // 로그인 ID 정리
    { // ID 검사 시작
        $id = strtolower($request->string('login_id', 40)); // 공백 제거와 영문 소문자 통일
        if (preg_match('/\A[a-z0-9][a-z0-9._-]{2,39}\z/D', $id) !== 1) // 허용 문자와 길이 검사
        { // ID 오류 시작
            throw new ApiException(400, 'INVALID_LOGIN_ID', '로그인 ID는 영문·숫자로 시작하는 3~40자의 영문·숫자·점·밑줄·하이픈으로 입력하세요.'); // 입력 안내
        } // ID 오류 끝
        return $id; // 정리된 로그인 ID
    } // ID 검사 끝

    private function password(Request $request, bool $register): string // 공백을 보존한 비밀번호 검사
    { // 비밀번호 입력 검사 시작
        $password = $request->json()['password'] ?? null; // 원문 비밀번호
        if (!is_string($password) || $password === '' || strlen($password) > 72 || str_contains($password, "\0")) // 자료형과 해시 입력 한도 검사
        { // 비밀번호 형식 오류 시작
            throw new ApiException(400, 'INVALID_PASSWORD', '비밀번호를 확인하세요. 영문 기준 최대 72자까지 사용할 수 있습니다.'); // 안전한 입력 안내
        } // 비밀번호 형식 오류 끝
        if ($register && mb_strlen($password) < 8) // 가입 시 최소 글자 수
        { // 짧은 비밀번호 처리 시작
            throw new ApiException(400, 'INVALID_PASSWORD', '비밀번호는 8자 이상 입력하세요.'); // 길이 안내
        } // 짧은 비밀번호 처리 끝
        return $password; // 가공하지 않은 비밀번호
    } // 비밀번호 입력 검사 끝

    public function register(Request $request): void // 신규 회원 생성
    { // 회원가입 시작
        $attemptId = $this->attempt($request); // 보호 헤더와 요청 제한
        $loginId = $this->loginId($request); // 로그인 ID 검증
        $name = $request->string('display_name', 60); // 회원 표시 이름
        if ($name === '' || preg_match('/\p{Cc}/u', $name) === 1) // 빈 이름과 유니코드 제어 문자 검사
        { // 이름 오류 시작
            throw new ApiException(400, 'INVALID_DISPLAY_NAME', '표시 이름을 1~60자로 입력하세요.'); // 이름 입력 안내
        } // 이름 오류 끝
        $password = $this->password($request, true); // 가입용 비밀번호 검사
        $confirmation = $request->json()['password_confirm'] ?? null; // 확인 비밀번호 원문
        if (!is_string($confirmation) || !hash_equals($password, $confirmation)) // 확인 입력 일치 검사
        { // 확인 불일치 시작
            throw new ApiException(400, 'PASSWORD_MISMATCH', '비밀번호 확인이 일치하지 않습니다.'); // 확인 입력 안내
        } // 확인 불일치 끝
        $hash = password_hash($password, PASSWORD_DEFAULT); // 비밀번호 단방향 해시
        $pdo = Database::pdo(); // 회원 저장용 연결
        $pdo->beginTransaction(); // 가입 저장 트랜잭션
        try // 중복과 동시 가입 처리
        { // 회원 저장 시작
            Database::run('INSERT INTO users (login_id, display_name, password_hash) VALUES (?, ?, ?)', [$loginId, $name, $hash]); // 비밀번호 평문 없는 회원 저장
            $userId = Database::lastId(); // 새 회원 번호
            $this->succeeded($attemptId); // 가입 성공 기록
            $pdo->commit(); // 회원 생성 확정
        } // 회원 저장 끝
        catch (PDOException $error) // DB 중복 제약 처리
        { // 저장 오류 처리 시작
            $pdo->rollBack(); // 가입 저장 되돌림
            if ((int) ($error->errorInfo[1] ?? 0) === 1062) // 동시 요청을 포함한 중복 ID
            { // 중복 ID 안내 시작
                throw new ApiException(409, 'LOGIN_ID_TAKEN', '이미 사용 중인 로그인 ID입니다.'); // 중복 안내
            } // 중복 ID 안내 끝
            throw $error; // 다른 DB 오류 전달
        } // 저장 오류 처리 끝
        catch (Throwable $error) // 그 외 저장 오류
        { // 예외 복구 시작
            $pdo->rollBack(); // 미완료 가입 복구
            throw $error; // 원인 전달
        } // 예외 복구 끝
        $user = Database::one('SELECT user_id, login_id, display_name, created_at FROM users WHERE user_id = ?', [$userId]); // 저장한 공개 회원 정보
        Response::ok(['user' => MemberAuth::publicUser($user)], 201); // 가입 완료 응답
    } // 회원가입 끝

    public function login(Request $request): void // 회원 로그인
    { // 로그인 시작
        $attemptId = $this->attempt($request); // 해시 검증 전 요청 횟수 기록
        $loginId = $this->loginId($request); // 로그인 ID 정리
        $password = $this->password($request, false); // 비밀번호 원문 검사
        $user = Database::one('SELECT user_id, login_id, display_name, password_hash, created_at FROM users WHERE login_id = ?', [$loginId]); // 회원 인증 정보
        if (!MemberAuth::verifyPassword($password, $user)) // 비밀번호 해시 검증
        { // 인증 거부 시작
            throw new ApiException(401, 'INVALID_CREDENTIALS', '로그인 ID 또는 비밀번호가 올바르지 않습니다.'); // 회원 존재 여부와 같은 오류
        } // 인증 거부 끝
        MemberAuth::issueSession($request, (int) $user['user_id']); // 새 세션 발급과 이전 세션 교체
        $this->succeeded($attemptId); // 로그인 성공 기록
        Response::ok(['user' => MemberAuth::publicUser($user)]); // 비밀값 없는 로그인 결과
    } // 로그인 끝

    public function me(Request $request): void // 로그인 상태 조회
    { // 상태 조회 시작
        $user = MemberAuth::currentUser($request); // 유효한 회원 세션
        if ($user === null) // 미인증 또는 만료·폐기
        { // 미인증 응답 시작
            throw new ApiException(401, 'UNAUTHORIZED', '로그인이 필요합니다.'); // 로그인 필요 안내
        } // 미인증 응답 끝
        Response::ok(['user' => MemberAuth::publicUser($user)]); // 현재 회원 정보
    } // 상태 조회 끝

    public function logout(Request $request): void // 현재 회원 로그아웃
    { // 로그아웃 처리 시작
        Auth::requireMutationHeader($request); // 요청 위조 방어
        MemberAuth::destroySession($request); // 회원 세션 폐기와 쿠키 제거
        Response::ok(['logged_out' => true]); // 반복 가능한 로그아웃 결과
    } // 로그아웃 처리 끝
} // 인증 API 끝
