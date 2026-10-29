export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Allow static assets (JS, CSS, images) and auth routes to bypass the check
  if (
    url.pathname.startsWith('/auth/') || 
    url.pathname.match(/\.(js|css|png|jpg|ico|svg|mp3|wav|woff|woff2)$/)
  ) {
    return context.next();
  }

  // Check for authenticated session cookie
  const cookieHeader = request.headers.get('Cookie') || '';
  if (cookieHeader.includes('scratch_school_auth=authenticated')) {
    return context.next();
  }

  // Redirect unauthenticated users to Google OAuth login
  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${env.GOOGLE_CLIENT_ID}&` +
    `redirect_uri=https://${url.hostname}/auth/callback&` +
    `response_type=code&` +
    `scope=email profile&` +
    `hd=${env.SCHOOL_DOMAIN}`;

  return Response.redirect(googleAuthUrl, 302);
}
