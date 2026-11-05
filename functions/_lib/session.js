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

export const createSessionCookie = async (secret, email) => {
    const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
    const payload = toBase64Url(encoder.encode(JSON.stringify({email, exp: expires})));
    const signature = await sign(secret, payload);
    return `${COOKIE_NAME}=${payload}.${signature}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
};

// Returns the signed-in email, or null if the cookie is missing, forged, or expired.
export const readSession = async (secret, request) => {
    if (!secret) return null;
    const cookies = request.headers.get('Cookie') || '';
    const match = cookies.split(';')
        .map(c => c.trim())
        .find(c => c.startsWith(`${COOKIE_NAME}=`));
    if (!match) return null;

    const [payload, signature] = match.slice(COOKIE_NAME.length + 1).split('.');
    if (!payload || !signature) return null;
    if (!timingSafeEqual(signature, await sign(secret, payload))) return null;

    try {
        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
        const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0))));
        if (typeof data.exp !== 'number' || data.exp < Date.now() / 1000) return null;
        return data.email;
    } catch (e) {
        return null;
    }
};
