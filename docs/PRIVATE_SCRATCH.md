# Private Scratch (School-Restricted Scratch GUI): Implementation Guide

## 1. Overview

This repository is a fork of the open-source `scratchfoundation/scratch-gui`, deployed as a private Scratch editor for a school. It differs from upstream in three ways:

1. **Access gate.** Only users who sign in with a verified Google account on the school's domain can load the site.
2. **Identity display.** The menu bar shows the signed-in user's name.
3. **Google Drive storage.** The File menu has "Save to Google Drive" and "Load from Google Drive". Each student gets a personal subfolder inside a shared "Scratch Submissions" folder, and teachers can browse all of them.

The Scratch editor itself (blocks, VM, renderer and so on) is unchanged. The additions are:

| Area | Files |
|---|---|
| Server-side auth (Cloudflare Pages Functions) | `functions/_middleware.js`, `functions/_lib/session.js`, `functions/auth/callback.js`, `functions/auth/me.js` |
| Client-side UI and Drive integration | `src/components/menu-bar/menu-bar.jsx`, `src/lib/google-drive.js` |
| Google script loading | `src/playground/index.ejs` |
| Build and deploy tweaks | `webpack.config.js`, `static/_routes.json`, `.gitignore` |

## 2. Architecture

```
Browser ──► Cloudflare Pages
              │
              ├─ functions/_middleware.js   (runs on every request)
              │     ├─ /auth/* and static asset extensions → pass through
              │     ├─ valid signed cookie                 → serve the site
              │     └─ otherwise                           → 302 to Google OAuth
              │
              ├─ /auth/callback   (Google redirects back here)
              │     exchange code → fetch profile → check domain → set cookie → 302 /
              │
              └─ /auth/me         (JSON: who is signed in)

Browser (after sign-in)
   Scratch GUI (static build)
     ├─ GET /auth/me                → show name in menu bar
     └─ Google Identity Services + Picker + Drive REST API
         (separate, browser-side OAuth token, used only for Drive)
```

There are two independent Google sign-ins:

- **Site gate** (server side). It uses an authorization-code flow and a signed session cookie. It decides whether you can see the site at all.
- **Drive access** (client side). It uses a Google Identity Services token flow, which is a popup that asks for Drive permission. It is only used for Save and Load. The two do not share tokens.

## 3. Server-side authentication (Cloudflare Pages Functions)

### 3.1 `functions/_middleware.js`: the gatekeeper

`onRequest` runs before every request. Its logic, in order:

1. **Bypass.** Requests to `/auth/*`, or whose path ends in `js, css, png, jpg, ico, svg, mp3, wav, woff, woff2`, go straight to `context.next()`. This lets the login flow and static assets load without a cookie.
2. **Session check.** `readSession(env.SESSION_SECRET, request)` is called. If it returns a user, the request continues.
3. **Redirect to Google.** Otherwise it generates a random `state` value and returns a 302 to `https://accounts.google.com/o/oauth2/v2/auth` with:
   - `client_id` = `env.GOOGLE_CLIENT_ID`
   - `redirect_uri` = `<origin>/auth/callback`
   - `response_type=code`
   - `scope=email profile`
   - `hd` = `env.SCHOOL_DOMAIN`. This is only a UI hint that pre-selects the school domain. It is not a security control, because the real check is in the callback.
   - `state` = the random value. The same value is set in a short-lived `scratch_oauth_state` cookie (see 3.3).

### 3.2 `functions/auth/callback.js`: completing login

1. Reads `code` from the query string. If it is missing, it returns 400.
2. **State check.** The `state` query parameter must match the `scratch_oauth_state` cookie (constant-time compare). If either is missing or they differ, it returns 400 "Login session expired or invalid" and clears the cookie. This stops a login that was started somewhere else (login CSRF) from being completed in the student's browser.
3. POSTs to `https://oauth2.googleapis.com/token` with `code`, `client_id`, `client_secret`, `redirect_uri` and `grant_type=authorization_code`. If there is no `access_token`, it returns 401.
4. Calls `https://www.googleapis.com/oauth2/v3/userinfo` with the access token to get the profile.
5. **Domain check.** All three of these must be true, otherwise it returns 403 "Access Denied":
   - `SCHOOL_DOMAIN` is configured.
   - `profile.email_verified === true`.
   - The lower-cased email ends with `@<SCHOOL_DOMAIN>`.
6. On success it returns 302 to `/` with two `Set-Cookie` headers: the new session cookie from `createSessionCookie(secret, email, name)` and an expired `scratch_oauth_state` cookie.

### 3.3 `functions/_lib/session.js`: stateless signed cookie

No database or KV store is used. The session lives entirely in the cookie.

- **Cookie name:** `scratch_session`
- **Lifetime:** 12 hours (`SESSION_SECONDS`)
- **Format:** `base64url(JSON payload).base64url(HMAC-SHA256 signature)`
- **Payload:** `{email, name, exp}`, where `exp` is a Unix timestamp in seconds.
- **Attributes:** `Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=43200`
- **Signing:** HMAC-SHA256 through the Web Crypto API, keyed with `SESSION_SECRET`.

`readSession(secret, request)` returns `{email, name}` or `null`. It:

1. Returns `null` if no secret is configured.
2. Finds the cookie and splits it into payload and signature.
3. Recomputes the signature and compares it in constant time (`timingSafeEqual`).
4. Decodes the payload and rejects it if `exp` is missing, not a number, or in the past.

Changing `SESSION_SECRET` invalidates every existing session. Sessions can't be revoked individually. They simply expire after 12 hours.

**OAuth state cookie.** The same file also holds the login-CSRF helpers: `createOAuthState`, `createOAuthStateCookie`, `clearOAuthStateCookie` and `verifyOAuthState`. The cookie is `scratch_oauth_state`, holds 32 random bytes (base64url), lives 10 minutes, and is `Path=/auth/callback; Secure; HttpOnly; SameSite=Lax`. It is only sent to the callback, and `SameSite=Lax` still allows it on the top-level redirect back from Google.

### 3.4 `functions/auth/me.js`: identity endpoint

`GET /auth/me` returns `{email, name}` as JSON with `Cache-Control: no-store`. If there is no valid session it returns 401 `{"error":"Not signed in"}`. Because `/auth/*` bypasses the middleware, the endpoint does its own session check.

## 4. Client-side changes

### 4.1 Signed-in name in the menu bar (`menu-bar.jsx`)

In `componentDidMount`, the component calls `fetch('/auth/me', {credentials: 'same-origin'})`. On success it stores `user.name || user.email` in `this.state.accountName`, and the render shows it in the menu bar. Failures are swallowed on purpose, so local dev (`npm start`), where `/auth/me` doesn't exist, shows no name and no error. An `unmounted` flag prevents setting state after unmount.

### 4.2 Google Drive integration (`menu-bar.jsx`)

Google scripts are loaded in `src/playground/index.ejs`: `apis.google.com/js/api.js` (gapi, used for Picker) and `accounts.google.com/gsi/client` (Identity Services).

**`getGoogleToken(callback)`** uses `google.accounts.oauth2.initTokenClient` with the Drive OAuth client ID (`DRIVE_CLIENT_ID`, see below). It requests the scopes `drive.file`, `drive.readonly` and `userinfo.email`. `drive.readonly` is needed so the picker can open `.sb3` files that were uploaded to Drive outside this app. The access token goes to the callback. Errors and cancellation show an `alert`.

**`src/lib/google-drive.js`** holds the shared Drive configuration and helpers used by both handlers: `DRIVE_CLIENT_ID`, `DRIVE_MASTER_FOLDER_ID`, `DRIVE_SCOPES`, `DRIVE_FOLDER_MIME_TYPE`, `escapeDriveQueryValue` and `studentFolderQuery`. The student-folder search query is built only through `studentFolderQuery`, which escapes single quotes and backslashes so an email can't break out of the quoted string in the Drive `q` parameter. Unit tests are in `test/unit/util/google-drive.test.js`.

**Folder model:**

```
Scratch Submissions            (DRIVE_MASTER_FOLDER_ID)
 ├─ student1@school.org/       (one subfolder per student, named by email)
 │    └─ My Project.sb3
 └─ student2@school.org/
```

**`handleSaveToGoogleDrive`:**

1. Gets a token, then reads the student's email from the userinfo endpoint.
2. Searches the master folder for a subfolder named with that email. If none exists, it creates one.
3. Prompts for a project name (default is the current project title). Cancel aborts.
4. Calls `vm.saveProjectSb3()` and uploads the result as `<name>.sb3` to the student's subfolder with a multipart POST (`uploadType=multipart`, `supportsAllDrives=true`).
5. Shows a success or failure alert.

**`handleLoadFromGoogleDrive`:**

1. Gets a token, reads the email, and looks up the student's subfolder. It falls back to the master folder if none exists.
2. Opens a Google Picker with two views:
   - "My Folder": the student's own folder. It has no MIME filter, because Drive labels uploaded `.sb3` files inconsistently (zip, octet-stream and so on).
   - "Scratch Submissions": the master folder with subfolders visible. Teachers use it to browse every student.
3. After a pick, it downloads the file with `alt=media` and calls `vm.loadProject(buffer)`.

Permissions are enforced by Google Drive sharing, not by this app. The Picker and API only show what the signed-in Google account can already access. So teachers need access to the master folder, and students need write access to it.

## 5. Build and deployment

- **Platform:** Cloudflare Pages. The `functions/` directory is picked up automatically and gives file-based routing (`/auth/callback`, `/auth/me`) plus the global `_middleware.js`.
- **Build:** `npm run build` runs webpack and outputs the site to `build/`. `NODE_ENV=production` or `BUILD_MODE=dist` also builds the `dist/` library.
- **Webpack customizations:**
  - `output.publicPath` is `/`, and chunks are written to `chunks/`.
  - `extension-worker.js` is copied to the site root, because scratch-vm loads it from `/`.
  - `scratch-storage`'s `fetch-worker.*.js` is copied to `chunks/`, because the prebuilt bundle expects it there.
- **`static/_routes.json`:** controls which paths invoke Functions. The `/*` include with the `/chunks/*`, `/static/*`, `/*.js`, `/*.css` and `/*.json` excludes keeps asset requests from invoking the middleware. Cloudflare Pages only reads this file from the **root of the build output**, so `webpack.config.js` copies `static/_routes.json` to `build/_routes.json` (and skips it in the `static/` copy). The Pages project's build output directory must be `build`. Note that once the file is in effect, everything under `/static/*` (favicon, micro:bit hex) and the excluded extensions is served without a login. None of it is secret, since it is open-source Scratch assets. See section 8 for how to verify it.
- **Drive build-time settings:** `webpack.config.js` injects `process.env.DRIVE_CLIENT_ID` and `process.env.DRIVE_MASTER_FOLDER_ID` into the bundle (via `DefinePlugin`). If those variables are set when the build runs, they win. Otherwise the defaults in `webpack.config.js` (`DEFAULT_DRIVE_CLIENT_ID`, `DEFAULT_DRIVE_MASTER_FOLDER_ID`) are used, which are the school's current values. These are the only places the IDs are defined.

### Required environment variables (Cloudflare Pages → Settings → Variables and Secrets)

**Required** (read by the Functions in `functions/`; the site gate does not work without them):

| Type | Name | Purpose |
|---|---|---|
| Text | `GOOGLE_CLIENT_ID` | OAuth client ID for the site-gate login. Used in `_middleware.js` and `auth/callback.js`. In the current deployment this is the same OAuth client as the default Drive client ID in `webpack.config.js`. |
| Secret | `GOOGLE_CLIENT_SECRET` | OAuth client secret, used in `auth/callback.js` for the code-to-token exchange. Must be an encrypted secret. |
| Text | `SCHOOL_DOMAIN` | Allowed email domain, for example `school.org`, without `@`. Used for the `hd` hint and the domain check. If it is empty, every login is rejected. |
| Secret | `SESSION_SECRET` | Long random string used to sign session cookies. Generate it with, for example, `openssl rand -base64 48`. If it is missing, no session is ever valid. Changing it signs everyone out. |

**Optional build settings:**

| Type | Name | Purpose |
|---|---|---|
| Text | `NODE_VERSION` | Node version used by the Cloudflare Pages build (`npm run build`). It is not read by the code. The repo's `.nvmrc` says `v20`, which the CI workflows use. Set `NODE_VERSION` to match (for example `20`), or remove it so the build follows `.nvmrc`. An older value such as `18.17.1` may build today but drifts from CI. |
| Text | `DRIVE_CLIENT_ID` | Overrides the OAuth client used for the Drive popup. Leave unset to use the default in `webpack.config.js`. It is read at build time and baked into the bundle, so changing it requires a new deployment. |
| Text | `DRIVE_MASTER_FOLDER_ID` | Overrides the "Scratch Submissions" Drive folder ID. Leave unset to use the default in `webpack.config.js`. Also build-time only. |

**Not used:** `REACT_APP_GOOGLE_API_KEY`. Nothing in the repo reads it. `webpack.config.js` only injects `GA_ID`, `GTM_ID`, `GTM_ENV_AUTH`, `DEBUG`, `DRIVE_CLIENT_ID` and `DRIVE_MASTER_FOLDER_ID`, there is no `REACT_APP_*` handling, and the Picker setup in `menu-bar.jsx` never calls `setDeveloperKey`. It is a leftover and can be deleted. If the Picker ever needs a developer key, it must be wired into the build explicitly, because a `REACT_APP_` prefix has no effect in this webpack setup.

`GA_ID`, `GTM_ID` and `GTM_ENV_AUTH` are upstream build-time options for analytics. They are not set here and are not needed.

All four required variables must be defined for the Production environment, and for Preview too if preview deployments should be gated.

### Google Cloud Console setup

- Create an OAuth 2.0 Web client. Its **Authorized redirect URI** must be exactly `https://<your-domain>/auth/callback`. Add the `*.pages.dev` preview URL too if you want previews to work.
- The Drive OAuth client (`DRIVE_CLIENT_ID`) needs the site's origin under **Authorized JavaScript origins**. Enable the Drive API and the Picker API for the project. Since `GOOGLE_CLIENT_ID` and the default Drive client ID are currently the same client, that one client needs both the redirect URI and the JavaScript origin configured.

### Local development

- `npm start` serves the plain GUI at `http://localhost:8601` with no auth. `/auth/me` returns 404 and the name is simply not shown.
- To test auth locally, run `wrangler pages dev build` with a `.dev.vars` file containing the four required variables above. `.dev.vars` and `.wrangler` are in `.gitignore`, so never commit them. Add `http://localhost:8788/auth/callback` as a redirect URI.

## 6. Request flow walkthrough

1. A student opens `https://<site>/`. The middleware finds no cookie, sets the `scratch_oauth_state` cookie and redirects to Google with the matching `state`.
2. The student signs in with their school account. Google redirects to `/auth/callback?code=…&state=…`.
3. The callback checks that `state` matches the cookie, exchanges the code and fetches the profile. It requires a verified email on `SCHOOL_DOMAIN`, then sets the `scratch_session` cookie, clears the state cookie and redirects to `/`.
4. Now the middleware passes the request through and the Scratch editor loads. Its JS, CSS and image requests skip the middleware (via `_routes.json` and the middleware's own extension bypass).
5. The menu bar calls `/auth/me` and shows the student's name.
6. When the student uses Save to Drive, a Google popup asks for Drive permission. The `.sb3` file is written to `Scratch Submissions/<email>/`.
7. After 12 hours the cookie expires and the flow restarts at step 1.

## 7. Security properties and design choices

- The session cookie is HttpOnly, Secure and SameSite=Lax, and its integrity is protected by HMAC with a constant-time compare.
- The OAuth `state` value is random per login attempt and bound to the browser by a short-lived, callback-scoped cookie, which prevents login CSRF.
- The domain restriction is enforced server-side on the verified email, not by the `hd` hint alone.
- Requests whose path ends in an asset extension, or that match the `_routes.json` excludes, skip the auth check. Anything served under such a path is publicly readable.
- Drive search queries escape user-controlled values (`escapeDriveQueryValue`).
- No server-side state is kept, so there is nothing to clean up, but sessions can't be revoked.

## 8. Verifying `_routes.json` after a deploy

`_routes.json` is only honored when it sits at the root of the build output. After deploying a build that includes it, check the following.

1. **Build output.** Run `npm run build` locally and confirm `build/_routes.json` exists and `build/static/_routes.json` does not.
2. **Pages setting.** In Cloudflare, go to Workers & Pages → your project → Settings → Builds and confirm the **Build output directory** is `build`.
3. **Build log.** In the deployment's build log, look for a line mentioning `_routes.json` being found or uploaded.
4. **Behavior test** from a terminal or a private window with no cookies. `/static/microbit/scratch-microbit-1.2.0.hex` is a good probe, because its extension is not in the middleware's bypass list, so only `_routes.json` can let it through:

   ```bash
   curl -I https://<site>/static/microbit/scratch-microbit-1.2.0.hex   # expect 200 (routes in effect)
   curl -I https://<site>/                                             # expect 302 to accounts.google.com (still gated)
   curl -I https://<site>/auth/me                                      # expect 401 (Functions still run)
   ```

   A `302` on the first request means `_routes.json` is not being applied, so the middleware is still running for `/static/*`. The second and third requests are controls that prove the gate and Functions still work.

## 9. Known limitations

- **Scope of access.** `drive.readonly` lets the app read any file the user can access, not just app-created files. It was added deliberately so the picker can open externally uploaded `.sb3` files.
- **Upstream status.** The upstream `scratch-gui` repo is being archived in favour of the `scratchfoundation/scratch-editor` mono-repo, so future upstream merges will need to come from there.
- **Limited test coverage.** The Drive query helpers have unit tests (`test/unit/util/google-drive.test.js`). Nothing automated covers `functions/` or the Drive handlers in `menu-bar.jsx`.
- **Local login testing** requires `wrangler pages dev` and a Google OAuth client that allows the local redirect URI.

## 10. Change history (key commits)

- `9b2b726b3`: switched to an HMAC-signed session cookie and fixed the broken callback.
- `90bf14f18`: ignored local Cloudflare dev secrets.
- `525afac71`: deployed the fetch and extension workers.
- `1dbd53dc3`, `114d08d6b`: Drive picker now includes zip files and has no MIME filters.
- `3ae85b23e`: shows the signed-in user's name in the menu bar.
- Hardening pass (this change set): added the OAuth `state` check, moved `_routes.json` to the build root, escaped Drive query values, and centralized the Drive client ID and folder ID in `webpack.config.js` and `src/lib/google-drive.js`.
