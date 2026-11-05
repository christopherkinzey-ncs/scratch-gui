import {escapeDriveQueryValue, studentFolderQuery} from '../../../src/lib/google-drive';

describe('google-drive helpers', () => {
    test('escapeDriveQueryValue leaves ordinary values alone', () => {
        expect(escapeDriveQueryValue('student@school.org')).toBe('student@school.org');
    });

    test('escapeDriveQueryValue escapes single quotes and backslashes', () => {
        expect(escapeDriveQueryValue('o\'brien@school.org')).toBe('o\\\'brien@school.org');
        expect(escapeDriveQueryValue('a\\b')).toBe('a\\\\b');
    });

    test('studentFolderQuery cannot be broken out of by a quote in the email', () => {
        const query = studentFolderQuery('MASTER', 'x\' or name != \'');
        expect(query).toBe(
            '\'MASTER\' in parents and name = \'x\\\' or name != \\\'\' and ' +
            'mimeType = \'application/vnd.google-apps.folder\' and trashed = false'
        );
    });
});
