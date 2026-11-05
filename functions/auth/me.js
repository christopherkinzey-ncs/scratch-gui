import {readSession} from '../_lib/session.js';

// Returns the signed-in user's name/email so the GUI can display who is logged in.
export async function onRequest (context) {
    const {request, env} = context;
    const session = await readSession(env.SESSION_SECRET, request);

    if (!session) {
        return new Response(JSON.stringify({error: 'Not signed in'}), {
            status: 401,
            headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}
        });
    }

    return new Response(JSON.stringify(session), {
        headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}
    });
}
