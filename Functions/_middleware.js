export async function onRequest(context) {
    const { request, next } = context;
    const url = new URL(request.url);

    // 認証が不要なページ
    const publicPaths = ['/index.html'];
    if (publicPaths.includes(url.pathname)) {
        return next();
    }

    // セッショントークンの検証
    const token = request.headers.get('Authorization');
    if (!token) {
        return new Response('Unauthorized', { status: 401 });
    }

    // トークン検証のロジック
    if (token !== 'your_secret_token') {
        return new Response('Invalid Token', { status: 403 });
    }

    return next();
}
