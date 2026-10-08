<?php
// 경로 패턴 기반 라우터
declare(strict_types=1);

final class Router
{
    private array $routes = []; // 등록된 라우트 목록

    public function add(string $method, string $pattern, array $handler): void
    {
        $regex = '#^' . preg_replace('#\{(\w+)\}#', '(?P<$1>\d+)', $pattern) . '$#'; // {id} 를 숫자 캡처로 변환
        $this->routes[] = [$method, $regex, $handler]; // 라우트 저장
    }

    public function dispatch(Request $request): void
    {
        $pathMatched = false; // 경로 일치 여부
        foreach ($this->routes as [$method, $regex, $handler])
        {
            if (!preg_match($regex, $request->path, $matches))
            {
                continue; // 경로 불일치
            }
            $pathMatched = true; // 경로 일치 기록
            if ($method !== $request->method)
            {
                continue; // 메서드 불일치
            }
            $request->params = array_map('intval', array_filter($matches, 'is_string', ARRAY_FILTER_USE_KEY)); // 경로 변수 정수화
            [$class, $action] = $handler; // 컨트롤러와 액션 분리
            (new $class())->$action($request); // 액션 실행
            return;
        }
        if ($pathMatched)
        {
            throw new ApiException(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 메서드입니다.'); // 메서드 오류
        }
        throw new ApiException(404, 'NOT_FOUND', '존재하지 않는 API 경로입니다.'); // 경로 없음
    }
}
