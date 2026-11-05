import {readSession} from './_lib/session.js';

export async function onRequest (context) {
    const {request, env} = context;
    const url = new URL(request.url);

    // Allow static assets (JS, CSS, images) and auth routes to bypass the check
    if (
        url.pathname.startsWith('/auth/') ||
        url.pathname.match(/\.(js|css|png|jpg|ico|svg|mp3|wav|woff|woff2)$/)
    ) {
        return context.next();
    }

    // Allow requests carrying a valid signed session cookie
    if (await readSession(env.SESSION_SECRET, request)) {
        return context.next();
    }

    // Redirect unauthenticated users to Google OAuth login
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: `${url.origin}/auth/callback`,
        response_type: 'code',
        scope: 'email profile',
        hd: env.SCHOOL_DOMAIN
    })}`;

    return Response.redirect(googleAuthUrl, 302);
}
