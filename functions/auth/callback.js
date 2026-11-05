import {createSessionCookie} from '../_lib/session.js';

export async function onRequest (context) {
    const {request, env} = context;
    const url = new URL(request.url);
    const code = url.searchParams.get('code');

    if (!code) {
        return new Response('Authentication failed: Missing authorization code', {status: 400});
    }

    // Exchange OAuth authorization code for Google access tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: `${url.origin}/auth/callback`,
            grant_type: 'authorization_code'
        })
    });

    const tokens = await tokenResponse.json();

    if (!tokens.access_token) {
        return new Response('Authentication failed: Token exchange error', {status: 401});
    }

    // Fetch user profile from Google
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: {Authorization: `Bearer ${tokens.access_token}`}
    });
    const profile = await userResponse.json();

    const email = (profile.email || '').toLowerCase();
    const domain = (env.SCHOOL_DOMAIN || '').toLowerCase();
    const isSchoolAccount = Boolean(domain) &&
        profile.email_verified === true &&
        email.endsWith(`@${domain}`);

    if (!isSchoolAccount) {
        return new Response(`Access Denied: You must sign in with an official @${env.SCHOOL_DOMAIN} email address.`, {
            status: 403
        });
    }

    return new Response(null, {
        status: 302,
        headers: {
            Location: '/',
            'Set-Cookie': await createSessionCookie(env.SESSION_SECRET, email, profile.name || '')
        }
    });
}
