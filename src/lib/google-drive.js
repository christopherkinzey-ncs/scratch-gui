// Shared configuration and helpers for the Google Drive save/load menu items.
// Both values are injected at build time by webpack.config.js (see DefinePlugin).

// OAuth client used by Google Identity Services to request a Drive access token.
export const DRIVE_CLIENT_ID = process.env.DRIVE_CLIENT_ID;

// Drive folder ("Scratch Submissions") that holds one subfolder per student, named by email.
export const DRIVE_MASTER_FOLDER_ID = process.env.DRIVE_MASTER_FOLDER_ID;

// drive.readonly lets the picker open .sb3 files that were uploaded to Drive outside this app
export const DRIVE_SCOPES = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/userinfo.email'
].join(' ');

export const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

// Escape a value for use inside a single-quoted string in a Drive `q` search query.
export const escapeDriveQueryValue = value => String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\\\'');

// Query that finds a student's subfolder (named by email) directly inside the master folder.
export const studentFolderQuery = (masterFolderId, studentEmail) =>
    `'${escapeDriveQueryValue(masterFolderId)}' in parents and ` +
    `name = '${escapeDriveQueryValue(studentEmail)}' and ` +
    `mimeType = '${DRIVE_FOLDER_MIME_TYPE}' and trashed = false`;
