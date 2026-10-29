export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return new Response('Authentication failed: Missing authorization code', { status: 400 });
  }

  // Exchange OAuth authorization code for Google access tokens
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `https://${url.hostname}/auth/callback`,
      grant_type: 'authorization_code',
    }),
  });

  const tokens = await tokenResponse.json();

  if (!tokens.access_token) {
    return new Response('Authentication failed: Token exchange error', { status: 401 });
  }

  // Fetch user profile from Google
  const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  const profile = await userResponse.json();

  // Enforce domain restriction for @norfolkchristian.org
  if (profile.hd === env.SCHOOL_DOMAIN || (profile.email && profile.email.endsWith(`@${env.SCHOOL_DOMAIN}`))) {
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/',
        'Set-Cookie': `scratch_school_auth=authenticated; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=86400`,
      },
    });
  }

  return new Response('Access Denied: You must sign in with an official @norfolkchristian.org email address.', { status: 403 });
}
