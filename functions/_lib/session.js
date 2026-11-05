// Signed session cookie helpers (HMAC-SHA256 via Web Crypto; free on Cloudflare Pages).
// Requires the SESSION_SECRET environment variable (any long random string).

export const COOKIE_NAME = 'scratch_session';
export const SESSION_SECONDS = 12 * 60 * 60;

const encoder = new TextEncoder();

const toBase64Url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const importKey = secret => crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    {name: 'HMAC', hash: 'SHA-256'},
    false,
    ['sign']
);

const sign = async (secret, data) => {
    const key = await importKey(secret);
    return toBase64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
};

const timingSafeEqual = (a, b) => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
};

const getCookie = (request, name) => {
    const cookies = request.headers.get('Cookie') || '';
    const match = cookies.split(';')
        .map(c => c.trim())
        .find(c => c.startsWith(`${name}=`));
    return match ? match.slice(name.length + 1) : null;
};

// OAuth `state` protection against login CSRF: the value sent to Google must come back unchanged
// and match a short-lived cookie that only the browser that started the login holds.
export const STATE_COOKIE_NAME = 'scratch_oauth_state';
const STATE_SECONDS = 10 * 60;

// The cookie is only needed by the callback, so it is scoped to that path.
const stateCookie = (value, maxAge) =>
    `${STATE_COOKIE_NAME}=${value}; Path=/auth/callback; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

export const createOAuthState = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

export const createOAuthStateCookie = state => stateCookie(state, STATE_SECONDS);

export const clearOAuthStateCookie = () => stateCookie('', 0);

export const verifyOAuthState = (request, state) => {
    const expected = getCookie(request, STATE_COOKIE_NAME);
    return Boolean(state) && Boolean(expected) && timingSafeEqual(state, expected);
};

export const createSessionCookie = async (secret, email, name = '') => {
    const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
    const payload = toBase64Url(encoder.encode(JSON.stringify({email, name, exp: expires})));
    const signature = await sign(secret, payload);
    return `${COOKIE_NAME}=${payload}.${signature}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
};

// Returns {email, name} for the signed-in user, or null if the cookie is missing, forged, or expired.
// `name` is empty for sessions created before names were stored.
export const readSession = async (secret, request) => {
    if (!secret) return null;
    const cookie = getCookie(request, COOKIE_NAME);
    if (!cookie) return null;

    const [payload, signature] = cookie.split('.');
    if (!payload || !signature) return null;
    if (!timingSafeEqual(signature, await sign(secret, payload))) return null;

    try {
        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
        const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0))));
        if (typeof data.exp !== 'number' || data.exp < Date.now() / 1000) return null;
        return {email: data.email, name: data.name || ''};
    } catch (e) {
        return null;
    }
};
