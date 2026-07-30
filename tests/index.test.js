import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    exec: {
        exec: vi.fn(),
        getExecOutput: vi.fn(),
    },
    fs: {
        existsSync: vi.fn(),
        readFileSync: vi.fn(),
    },
    github: {
        getOctokit: vi.fn(),
        context: {
            repo: {
                owner: 'the-owner',
                repo: 'the-repo',
            },
            sha: 'deadbeef',
        },
    },
    core: {
        getInput: vi.fn(),
        getBooleanInput: vi.fn(),
        info: vi.fn(),
        setOutput: vi.fn(),
        warning: vi.fn(),
    },
}));

vi.mock('@actions/core', () => mocks.core);
vi.mock('@actions/exec', () => mocks.exec);
vi.mock('@actions/github', () => mocks.github);
vi.mock('fs', () => ({
    default: mocks.fs,
    ...mocks.fs,
}));

const { core, exec, fs, github } = mocks;
const action = (await import('../src/index.js')).default;

describe('determinePhpVersionFromPhpConfig', () => {
    test('php version can be determined from php-config', async () => {
        exec.getExecOutput.mockResolvedValue({
            stdout: "8.3.10-whatever\n",
            exitCode: 0,
        });

        expect(await action.determinePhpVersionFromPhpConfig())
            .toBe('8.3');
    });
});

describe ('determineExtensionNameFromComposerJson', () => {
    test('composer.json does not exist', async () => {
        await expect(action.determineExtensionNameFromComposerJson())
            .rejects
            .toThrow('composer.json not found. This does not appear to be a PIE package.');
    });

    test('composer.json has type other than php-ext or php-ext-zend', async () => {
        fs.existsSync.mockReturnValue(true);

        // jq -r ".type" composer.json
        exec.getExecOutput.mockResolvedValue({
            stdout: "library\n",
            exitCode: 0,
        });

        await expect(action.determineExtensionNameFromComposerJson())
            .rejects
            .toThrow('composer.json type must be "php-ext" or "php-ext-zend", but "library" was found.');
    });

    test('composer.json has valid php-ext.extension-name with ext- prefix defined', async () => {
        fs.existsSync.mockReturnValue(true);
        exec.getExecOutput.mockImplementation((command, args) => {
            // jq -r ".type" composer.json
            if (args.includes('.type')) {
                return Promise.resolve({ stdout: "php-ext\n", exitCode: 0 });
            }

            // jq -r '."php-ext"."extension-name"' composer.json
            if (args.includes('."php-ext"."extension-name"')) {
                return Promise.resolve({ stdout: "ext-test_ext\n", exitCode: 0 });
            }

            return Promise.reject(new Error('Test did not define command: ' + command + ' with args: ' + args));
        });

        expect(await action.determineExtensionNameFromComposerJson())
            .toBe('test_ext');
    });

    test('composer.json has valid php-ext.extension-name defined', async () => {
        fs.existsSync.mockReturnValue(true);
        exec.getExecOutput.mockImplementation((command, args) => {
            // jq -r ".type" composer.json
            if (args.includes('.type')) {
                return Promise.resolve({ stdout: "php-ext\n", exitCode: 0 });
            }

            // jq -r '."php-ext"."extension-name"' composer.json
            if (args.includes('."php-ext"."extension-name"')) {
                return Promise.resolve({ stdout: "test_ext\n", exitCode: 0 });
            }

            return Promise.reject(new Error('Test did not define command: ' + command + ' with args: ' + args));
        });

        expect(await action.determineExtensionNameFromComposerJson())
            .toBe('test_ext');
    });

    test('composer.json has invalid php-ext.extension-name defined', async () => {
        fs.existsSync.mockReturnValue(true);
        exec.getExecOutput.mockImplementation((command, args) => {
            // jq -r ".type" composer.json
            if (args.includes('.type')) {
                return Promise.resolve({ stdout: "php-ext\n", exitCode: 0 });
            }

            // jq -r '."php-ext"."extension-name"' composer.json
            if (args.includes('."php-ext"."extension-name"')) {
                return Promise.resolve({ stdout: "invalid-ext-name\n", exitCode: 0 });
            }

            return Promise.reject(new Error('Test did not define command: ' + command + ' with args: ' + args));
        });

        await expect(action.determineExtensionNameFromComposerJson())
            .rejects
            .toThrow('Invalid extension name: "invalid-ext-name" - must be alphanumeric/underscores only.');
    });

    test('composer.json has no php-ext.extension-name defined, but package name is valid', async () => {
        fs.existsSync.mockReturnValue(true);
        exec.getExecOutput.mockImplementation((command, args) => {
            // jq -r ".type" composer.json
            if (args.includes('.type')) {
                return Promise.resolve({ stdout: "php-ext\n", exitCode: 0 });
            }

            // jq -r '."php-ext"."extension-name"' composer.json
            if (args.includes('."php-ext"."extension-name"')) {
                return Promise.resolve({ stdout: "\n", exitCode: 0 });
            }

            // jq -r '.name' composer.json
            if (args.includes('.name')) {
                return Promise.resolve({ stdout: "foo/bar\n", exitCode: 0 });
            }

            return Promise.reject(new Error('Test did not define command: ' + command + ' with args: ' + args));
        });

        expect(await action.determineExtensionNameFromComposerJson())
            .toBe('bar');
    });

    test('composer.json has no php-ext.extension-name or package name defined', async () => {
        fs.existsSync.mockReturnValue(true);
        exec.getExecOutput.mockImplementation((command, args) => {
            // jq -r ".type" composer.json
            if (args.includes('.type')) {
                return Promise.resolve({ stdout: "php-ext\n", exitCode: 0 });
            }

            // jq -r '."php-ext"."extension-name"' composer.json
            if (args.includes('."php-ext"."extension-name"')) {
                return Promise.resolve({ stdout: "\n", exitCode: 0 });
            }

            // jq -r '.name' composer.json
            if (args.includes('.name')) {
                return Promise.resolve({ stdout: "\n", exitCode: 0 });
            }

            return Promise.reject(new Error('Test did not define command: ' + command + ' with args: ' + args));
        });

        await expect(action.determineExtensionNameFromComposerJson())
            .rejects
            .toThrow('Could not determine extension name: both .\"php-ext\".\"extension-name\" and .name are missing in composer.json');
    });

    test('composer.json has no php-ext.extension-name defined, and package name is invalid', async () => {
        fs.existsSync.mockReturnValue(true);
        exec.getExecOutput.mockImplementation((command, args) => {
            // jq -r ".type" composer.json
            if (args.includes('.type')) {
                return Promise.resolve({ stdout: "php-ext\n", exitCode: 0 });
            }

            // jq -r '."php-ext"."extension-name"' composer.json
            if (args.includes('."php-ext"."extension-name"')) {
                return Promise.resolve({ stdout: "\n", exitCode: 0 });
            }

            // jq -r '.name' composer.json
            if (args.includes('.name')) {
                return Promise.resolve({ stdout: "foo/invalid-ext-name\n", exitCode: 0 });
            }

            return Promise.reject(new Error('Test did not define command: ' + command + ' with args: ' + args));
        });

        await expect(action.determineExtensionNameFromComposerJson())
            .rejects
            .toThrow('Invalid extension name: "invalid-ext-name" - must be alphanumeric/underscores only.');
    });
});

describe('determineArchitecture', () => {
    const originalArch = process.arch;

    afterEach(() => {
        Object.defineProperty(process, 'arch', {
            value: originalArch,
            configurable: true
        });
    });

    test('x64', async () => {
        Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
        expect(await action.determineArchitecture()).toBe('x86_64');
    });

    test('arm64', async () => {
        Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
        expect(await action.determineArchitecture()).toBe('arm64');
    });

    test('ia32', async () => {
        Object.defineProperty(process, 'arch', { value: 'ia32', configurable: true });
        expect(await action.determineArchitecture()).toBe('x86');
    });

    test('unsupported architecture', async () => {
        Object.defineProperty(process, 'arch', { value: 'bloop', configurable: true });
        await expect(action.determineArchitecture())
            .rejects
            .toThrow('Unsupported architecture: bloop');
    });
});

describe('determineOperatingSystem', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
        Object.defineProperty(process, 'platform', {
            value: originalPlatform,
            configurable: true
        });
    });

    test('linux', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        expect(await action.determineOperatingSystem()).toBe('linux');
    });

    test('darwin', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
        expect(await action.determineOperatingSystem()).toBe('darwin');
    });

    test('win32', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        await expect(action.determineOperatingSystem())
            .rejects
            .toThrow('Unsupported operating system: win32');
    });
});

describe('determineLibcFlavour', () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
        exec.getExecOutput.mockReset();
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', {
            value: originalPlatform,
            configurable: true
        });
    });

    test('osx uses bsdlibc', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
        await expect(action.determineLibcFlavour()).resolves.toBe('bsdlibc');
    });

    test('musl detected', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        exec.getExecOutput.mockResolvedValue({ stdout: 'musl libc (1.2.4)\n', exitCode: 0 });
        await expect(action.determineLibcFlavour()).resolves.toBe('musl');
    });

    test('otherwise glibc', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        exec.getExecOutput.mockResolvedValue({ stdout: 'ldd (GNU libc) 2.31\n', exitCode: 0 });
        await expect(action.determineLibcFlavour()).resolves.toBe('glibc');
    });
});

describe('determinePhpBinary', () => {
    test('php binary is returned', async () => {
        exec.getExecOutput.mockResolvedValue({
            stdout: "/path/to/php\n",
            exitCode: 0,
        });
        await expect(action.determinePhpBinary()).resolves.toBe('/path/to/php');
    });

    test('php binary being NONE returns just php', async () => {
        exec.getExecOutput.mockResolvedValue({
            stdout: "NONE\n",
            exitCode: 0,
        });
        await expect(action.determinePhpBinary()).resolves.toBe('php');
    });
});

describe('determinePhpDebugMode', () => {
    test('debug mode', async () => {
        exec.getExecOutput.mockResolvedValue({
            stdout: "-debug\n",
            exitCode: 0,
        });
        await expect(action.determinePhpDebugMode()).resolves.toBe('-debug');
    });
    test('non debug mode', async () => {
        exec.getExecOutput.mockResolvedValue({
            stdout: "\n",
            exitCode: 0,
        });
        await expect(action.determinePhpDebugMode()).resolves.toBe('');
    });
});

describe('determineZendThreadSafeMode', () => {
    test('zts mode', async () => {
        exec.getExecOutput.mockResolvedValue({
            stdout: "-zts\n",
            exitCode: 0,
        });
        await expect(action.determineZendThreadSafeMode()).resolves.toBe('-zts');
    });

    test('nts mode', async () => {
        exec.getExecOutput.mockResolvedValue({
            stdout: "\n",
            exitCode: 0,
        });
        await expect(action.determineZendThreadSafeMode()).resolves.toBe('');
    });
});

describe('buildExtension', () => {
    test('builds the extension with configure params and default build path', async () => {
        core.getInput.mockImplementation((name) => {
            if (name === 'configure-flags') return '--enable-test --with-foo=/foo/bar';
            if (name === 'build-path') return '.';
            return '';
        });

        await action.buildExtension();

        expect(exec.exec).toHaveBeenCalledWith('phpize', [], {});
        expect(exec.exec).toHaveBeenCalledWith('./configure', ['--enable-test', '--with-foo=/foo/bar'], {});
        expect(exec.exec).toHaveBeenCalledWith('make', [], {});
    });

    test('builds the extension with custom build path', async () => {
        core.getInput.mockImplementation((name) => {
            if (name === 'configure-flags') return '--enable-test';
            if (name === 'build-path') return 'some/ext/path';
            return '';
        });

        await action.buildExtension();

        expect(exec.exec).toHaveBeenCalledWith('phpize', [], { cwd: 'some/ext/path' });
        expect(exec.exec).toHaveBeenCalledWith('./configure', ['--enable-test'], { cwd: 'some/ext/path' });
        expect(exec.exec).toHaveBeenCalledWith('make', [], { cwd: 'some/ext/path' });
    });
});

describe('findRelease', () => {
    let octokit;

    beforeEach(() => {
        octokit = {
            rest: {
                repos: {
                    listReleases: vi.fn(),
                },
            },
        };
    });

    test('returns matching release including drafts', async () => {
        octokit.rest.repos.listReleases.mockResolvedValue({
            data: [{ id: 123, tag_name: '1.0.0', name: 'Release 1.0.0', draft: true }],
        });

        const release = await action.findRelease(octokit, 'the-owner', 'the-repo', '1.0.0');

        expect(octokit.rest.repos.listReleases).toHaveBeenCalledWith({
            owner: 'the-owner',
            repo: 'the-repo',
        });
        expect(release).toEqual({ id: 123, tag_name: '1.0.0', name: 'Release 1.0.0', draft: true });
    });

    test('returns undefined when no release matches the tag', async () => {
        octokit.rest.repos.listReleases.mockResolvedValue({ data: [] });

        expect(await action.findRelease(octokit, 'the-owner', 'the-repo', '1.0.0'))
            .toBeUndefined();
    });
});

describe('sleep', () => {
    test('resolves after the given delay', async () => {
        vi.useFakeTimers();
        try {
            const resolved = vi.fn();
            action.sleep(1000).then(resolved);

            await vi.advanceTimersByTimeAsync(999);
            expect(resolved).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1);
            expect(resolved).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('getReleaseNotesFromTag', () => {
    let octokit;

    beforeEach(() => {
        octokit = {
            rest: {
                git: {
                    getRef: vi.fn(),
                    getTag: vi.fn(),
                    getCommit: vi.fn(),
                },
            },
        };
    });

    test('returns the annotated tag message', async () => {
        octokit.rest.git.getRef.mockResolvedValue({ data: { object: { type: 'tag', sha: 'tag-sha' } } });
        octokit.rest.git.getTag.mockResolvedValue({ data: { message: 'Annotated tag message' } });

        expect(await action.getReleaseNotesFromTag(octokit, 'the-owner', 'the-repo', '1.0.0'))
            .toBe('Annotated tag message');
        expect(octokit.rest.git.getRef).toHaveBeenCalledWith({ owner: 'the-owner', repo: 'the-repo', ref: 'tags/1.0.0' });
        expect(octokit.rest.git.getTag).toHaveBeenCalledWith({ owner: 'the-owner', repo: 'the-repo', tag_sha: 'tag-sha' });
        expect(octokit.rest.git.getCommit).not.toHaveBeenCalled();
    });

    test('falls back to the commit message for a lightweight (unannotated) tag', async () => {
        octokit.rest.git.getRef.mockResolvedValue({ data: { object: { type: 'commit', sha: 'commit-sha' } } });
        octokit.rest.git.getCommit.mockResolvedValue({ data: { message: 'Commit message' } });

        expect(await action.getReleaseNotesFromTag(octokit, 'the-owner', 'the-repo', '1.0.0'))
            .toBe('Commit message');
        expect(octokit.rest.git.getCommit).toHaveBeenCalledWith({ owner: 'the-owner', repo: 'the-repo', commit_sha: 'commit-sha' });
        expect(octokit.rest.git.getTag).not.toHaveBeenCalled();
    });

    test('returns an empty string when the tag does not exist yet', async () => {
        const notFoundError = new Error('Not Found');
        notFoundError.status = 404;
        octokit.rest.git.getRef.mockRejectedValue(notFoundError);

        expect(await action.getReleaseNotesFromTag(octokit, 'the-owner', 'the-repo', '1.0.0'))
            .toBe('');
    });

    test('rethrows unexpected errors', async () => {
        const unexpectedError = new Error('Something else went wrong');
        unexpectedError.status = 500;
        octokit.rest.git.getRef.mockRejectedValue(unexpectedError);

        await expect(action.getReleaseNotesFromTag(octokit, 'the-owner', 'the-repo', '1.0.0'))
            .rejects
            .toThrow('Something else went wrong');
    });
});

describe('deleteReleaseLock', () => {
    test('logs a warning and does not throw when deletion fails', async () => {
        const octokit = { rest: { git: { deleteRef: vi.fn().mockRejectedValue(new Error('boom')) } } };

        await expect(action.deleteReleaseLock(octokit, 'the-owner', 'the-repo', '1.0.0'))
            .resolves
            .toBeUndefined();

        expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });
});

describe('createRelease', () => {
    let octokit;

    beforeEach(() => {
        octokit = {
            rest: {
                repos: {
                    listReleases: vi.fn(),
                    createRelease: vi.fn(),
                },
                git: {
                    createRef: vi.fn(),
                    deleteRef: vi.fn(),
                },
            },
        };
        github.getOctokit.mockReturnValue(octokit);
        core.getInput.mockReturnValue('fake-token');
        vi.spyOn(action, 'sleep').mockReset().mockResolvedValue();
        vi.spyOn(action, 'getReleaseNotesFromTag').mockReset().mockResolvedValue('');
    });

    test('does nothing when a release already exists for the tag', async () => {
        octokit.rest.repos.listReleases.mockResolvedValue({
            data: [{ id: 123, tag_name: '1.0.0', name: 'Release 1.0.0' }],
        });

        await action.createRelease('1.0.0');

        expect(octokit.rest.git.createRef).not.toHaveBeenCalled();
        expect(octokit.rest.repos.createRelease).not.toHaveBeenCalled();
    });

    test('acquires the lock and creates the release, leaving the lock ref in place', async () => {
        octokit.rest.repos.listReleases.mockResolvedValue({ data: [] });
        octokit.rest.git.createRef.mockResolvedValue({});
        octokit.rest.repos.createRelease.mockResolvedValue({
            data: { id: 456, tag_name: '1.0.0', name: '1.0.0' },
        });

        await action.createRelease('1.0.0');

        expect(octokit.rest.git.createRef).toHaveBeenCalledWith({
            owner: 'the-owner',
            repo: 'the-repo',
            ref: 'refs/pie-release-lock/1.0.0',
            sha: 'deadbeef',
        });
        expect(octokit.rest.repos.createRelease).toHaveBeenCalledWith({
            owner: 'the-owner',
            repo: 'the-repo',
            tag_name: '1.0.0',
            name: '1.0.0',
            draft: true,
            generate_release_notes: true,
        });
    });

    test('uses the tag/commit message as release notes when available', async () => {
        octokit.rest.repos.listReleases.mockResolvedValue({ data: [] });
        octokit.rest.git.createRef.mockResolvedValue({});
        octokit.rest.repos.createRelease.mockResolvedValue({
            data: { id: 456, tag_name: '1.0.0', name: '1.0.0' },
        });
        action.getReleaseNotesFromTag.mockResolvedValue('Notes from the tag');

        await action.createRelease('1.0.0');

        expect(octokit.rest.repos.createRelease).toHaveBeenCalledWith({
            owner: 'the-owner',
            repo: 'the-repo',
            tag_name: '1.0.0',
            name: '1.0.0',
            draft: true,
            body: 'Notes from the tag',
        });
    });

    test('releases the lock and rethrows when release creation fails and no release was actually created', async () => {
        octokit.rest.repos.listReleases.mockResolvedValue({ data: [] });
        octokit.rest.git.createRef.mockResolvedValue({});
        octokit.rest.git.deleteRef.mockResolvedValue({});
        octokit.rest.repos.createRelease.mockRejectedValue(new Error('API is down'));

        await expect(action.createRelease('1.0.0'))
            .rejects
            .toThrow('API is down');

        expect(octokit.rest.git.deleteRef).toHaveBeenCalledWith({
            owner: 'the-owner',
            repo: 'the-repo',
            ref: 'pie-release-lock/1.0.0',
        });
    });

    test('leaves the lock in place and rethrows when release creation fails but the release exists anyway', async () => {
        octokit.rest.repos.listReleases
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [{ id: 999, tag_name: '1.0.0', name: '1.0.0' }] });
        octokit.rest.git.createRef.mockResolvedValue({});
        octokit.rest.repos.createRelease.mockRejectedValue(new Error('Timed out waiting for response'));

        await expect(action.createRelease('1.0.0'))
            .rejects
            .toThrow('Timed out waiting for response');

        expect(octokit.rest.git.deleteRef).not.toHaveBeenCalled();
    });

    test('when lock is already held (TOCTOU race), polls until the release created by another job appears', async () => {
        octokit.rest.repos.listReleases
            .mockResolvedValueOnce({ data: [] }) // initial search
            .mockResolvedValueOnce({ data: [] }) // first poll: not yet created by the winning job
            .mockResolvedValueOnce({ data: [{ id: 789, tag_name: '1.0.0', name: '1.0.0' }] }); // second poll: found

        const conflictError = new Error('Reference already exists');
        conflictError.status = 422;
        octokit.rest.git.createRef.mockRejectedValue(conflictError);

        await action.createRelease('1.0.0');

        expect(octokit.rest.repos.createRelease).not.toHaveBeenCalled();
        expect(action.sleep).toHaveBeenCalledTimes(2);
    });

    test('throws if it times out waiting for another job to finish creating the release', async () => {
        octokit.rest.repos.listReleases.mockResolvedValue({ data: [] });

        const conflictError = new Error('Reference already exists');
        conflictError.status = 422;
        octokit.rest.git.createRef.mockRejectedValue(conflictError);

        await expect(action.createRelease('1.0.0'))
            .rejects
            .toThrow('Timed out waiting for release to be created for tag: 1.0.0');

        expect(octokit.rest.repos.createRelease).not.toHaveBeenCalled();
    });

    test('rethrows unexpected errors from lock acquisition', async () => {
        octokit.rest.repos.listReleases.mockResolvedValue({ data: [] });

        const unexpectedError = new Error('Something else went wrong');
        unexpectedError.status = 500;
        octokit.rest.git.createRef.mockRejectedValue(unexpectedError);

        await expect(action.createRelease('1.0.0'))
            .rejects
            .toThrow('Something else went wrong');

        expect(octokit.rest.repos.createRelease).not.toHaveBeenCalled();
    });
});

describe('uploadReleaseAsset', () => {
    let octokit;

    beforeEach(() => {
        octokit = {
            rest: {
                repos: {
                    listReleases: vi.fn(),
                    uploadReleaseAsset: vi.fn(),
                },
            },
        };
        github.getOctokit.mockReturnValue(octokit);
        core.getInput.mockReturnValue('fake-token');
        vi.spyOn(action, 'sleep').mockReset().mockResolvedValue();
    });

    test('successfully uploads asset', async () => {
        octokit.rest.repos.listReleases.mockResolvedValue({
            data: [
                {
                    id: 123,
                    tag_name: '1.0.0',
                    name: 'Release 1.0.0',
                },
            ],
        });
        fs.readFileSync.mockReturnValue('release-asset-fake-data');

        await action.uploadReleaseAsset('1.0.0', 'release-asset.zip');

        expect(github.getOctokit).toHaveBeenCalledWith('fake-token');
        expect(octokit.rest.repos.listReleases).toHaveBeenCalledWith({
            owner: 'the-owner',
            repo: 'the-repo',
        });
        expect(octokit.rest.repos.uploadReleaseAsset).toHaveBeenCalledWith({
            owner: 'the-owner',
            repo: 'the-repo',
            release_id: 123,
            name: 'release-asset.zip',
            data: 'release-asset-fake-data',
        });
    });

    test('throws error when there are no releases', async () => {
        octokit.rest.repos.listReleases.mockResolvedValue({data: []});

        await expect(action.uploadReleaseAsset('1.0.0', 'release-asset.zip'))
            .rejects
            .toThrow('No release found for tag: 1.0.0');

        expect(action.sleep).toHaveBeenCalledTimes(10);
    });

    test('retries and finds the release if it is not immediately visible after creation', async () => {
        octokit.rest.repos.listReleases
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [{ id: 123, tag_name: '1.0.0', name: 'Release 1.0.0' }] });
        fs.readFileSync.mockReturnValue('release-asset-fake-data');

        await action.uploadReleaseAsset('1.0.0', 'release-asset.zip');

        expect(action.sleep).toHaveBeenCalledTimes(2);
        expect(octokit.rest.repos.uploadReleaseAsset).toHaveBeenCalledWith({
            owner: 'the-owner',
            repo: 'the-repo',
            release_id: 123,
            name: 'release-asset.zip',
            data: 'release-asset-fake-data',
        });
    });

    test('throws error when release not found', async () => {
        octokit.rest.repos.listReleases.mockResolvedValue({
            data: [
                {
                    id: 123,
                    tag_name: '1.0.0',
                    name: 'Release 1.0.0',
                },
            ],
        });

        await expect(action.uploadReleaseAsset('1.1.0', 'release-asset.zip'))
            .rejects
            .toThrow('No release found for tag: 1.1.0');
    });
});

describe('extensionDetails', () => {
    test('extension details are returned', async () => {
        core.getInput.mockReturnValue('1.2.3');

        vi.spyOn(action, 'determinePhpBinary').mockResolvedValue('/usr/bin/php');
        vi.spyOn(action, 'determineExtensionNameFromComposerJson').mockResolvedValue('foo');
        vi.spyOn(action, 'determinePhpVersionFromPhpConfig').mockResolvedValue('8.1');
        vi.spyOn(action, 'determineArchitecture').mockResolvedValue('x86_64');
        vi.spyOn(action, 'determineOperatingSystem').mockResolvedValue('linux');
        vi.spyOn(action, 'determineLibcFlavour').mockResolvedValue('glibc');
        vi.spyOn(action, 'determinePhpDebugMode').mockResolvedValue('');
        vi.spyOn(action, 'determineZendThreadSafeMode').mockResolvedValue('');

        expect(await action.extensionDetails())
            .toEqual({
                releaseTag: '1.2.3',
                extSoFile: 'foo.so',
                extPackageName: 'php_foo-1.2.3_php8.1-x86_64-linux-glibc.zip',
            });
    });

    test('extension details are returned for debug/zts', async () => {
        core.getInput.mockReturnValue('1.2.3');

        vi.spyOn(action, 'determinePhpBinary').mockResolvedValue('/usr/bin/php');
        vi.spyOn(action, 'determineExtensionNameFromComposerJson').mockResolvedValue('foo');
        vi.spyOn(action, 'determinePhpVersionFromPhpConfig').mockResolvedValue('8.1');
        vi.spyOn(action, 'determineArchitecture').mockResolvedValue('x86_64');
        vi.spyOn(action, 'determineOperatingSystem').mockResolvedValue('linux');
        vi.spyOn(action, 'determineLibcFlavour').mockResolvedValue('glibc');
        vi.spyOn(action, 'determinePhpDebugMode').mockResolvedValue('-debug');
        vi.spyOn(action, 'determineZendThreadSafeMode').mockResolvedValue('-zts');

        expect(await action.extensionDetails())
            .toEqual({
                releaseTag: '1.2.3',
                extSoFile: 'foo.so',
                extPackageName: 'php_foo-1.2.3_php8.1-x86_64-linux-glibc-debug-zts.zip',
            });
    });
});

describe('main', () => {
    beforeEach(() => {
        core.getBooleanInput.mockReturnValue(false);
    });

    test('main builds and uploads extension with default build path', async () => {
        vi.spyOn(action, 'extensionDetails').mockResolvedValue({
            releaseTag: '1.2.3',
            extSoFile: 'foo.so',
            extPackageName: 'php_foo-1.2.3_php8.1-x86_64-linux-glibc-debug-zts.zip',
        });
        vi.spyOn(action, 'buildExtension').mockResolvedValue();
        vi.spyOn(action, 'uploadReleaseAsset').mockResolvedValue();
        vi.spyOn(exec, 'exec').mockResolvedValue();
        core.getInput.mockImplementation((name) => {
            if (name === 'build-path') return '.';
            return '';
        });

        await action.main();

        expect(action.buildExtension).toHaveBeenCalled();
        expect(action.uploadReleaseAsset).toHaveBeenCalledWith('1.2.3', 'php_foo-1.2.3_php8.1-x86_64-linux-glibc-debug-zts.zip');
        expect(exec.exec).toHaveBeenCalledWith('ls', ['-l', 'modules']);
        expect(exec.exec).toHaveBeenCalledWith('zip', ['-j', 'php_foo-1.2.3_php8.1-x86_64-linux-glibc-debug-zts.zip', 'modules/foo.so']);
        expect(core.setOutput).toHaveBeenCalledWith('package-path', 'php_foo-1.2.3_php8.1-x86_64-linux-glibc-debug-zts.zip');
    });

    test('main builds and uploads extension with custom build path', async () => {
        vi.spyOn(action, 'extensionDetails').mockResolvedValue({
            releaseTag: '1.2.3',
            extSoFile: 'foo.so',
            extPackageName: 'php_foo-1.2.3_php8.1-x86_64-linux-glibc-debug-zts.zip',
        });
        vi.spyOn(action, 'buildExtension').mockResolvedValue();
        vi.spyOn(action, 'uploadReleaseAsset').mockResolvedValue();
        vi.spyOn(exec, 'exec').mockResolvedValue();
        core.getInput.mockImplementation((name) => {
            if (name === 'build-path') return 'src/php/ext/grpc';
            return '';
        });

        await action.main();

        expect(action.buildExtension).toHaveBeenCalled();
        expect(action.uploadReleaseAsset).toHaveBeenCalledWith('1.2.3', 'php_foo-1.2.3_php8.1-x86_64-linux-glibc-debug-zts.zip');
        expect(exec.exec).toHaveBeenCalledWith('ls', ['-l', 'src/php/ext/grpc/modules']);
        expect(exec.exec).toHaveBeenCalledWith('zip', ['-j', 'php_foo-1.2.3_php8.1-x86_64-linux-glibc-debug-zts.zip', 'src/php/ext/grpc/modules/foo.so']);
        expect(core.setOutput).toHaveBeenCalledWith('package-path', 'php_foo-1.2.3_php8.1-x86_64-linux-glibc-debug-zts.zip');
    });

    test('does not create a release when create-release is false', async () => {
        vi.spyOn(action, 'extensionDetails').mockResolvedValue({
            releaseTag: '1.2.3',
            extSoFile: 'foo.so',
            extPackageName: 'php_foo-1.2.3_php8.1-x86_64-linux-glibc-debug-zts.zip',
        });
        vi.spyOn(action, 'buildExtension').mockResolvedValue();
        vi.spyOn(action, 'createRelease').mockResolvedValue();
        vi.spyOn(action, 'uploadReleaseAsset').mockResolvedValue();
        vi.spyOn(exec, 'exec').mockResolvedValue();
        core.getInput.mockImplementation((name) => {
            if (name === 'build-path') return '.';
            return '';
        });
        core.getBooleanInput.mockReturnValue(false);

        await action.main();

        expect(action.createRelease).not.toHaveBeenCalled();
        expect(action.uploadReleaseAsset).toHaveBeenCalledWith('1.2.3', 'php_foo-1.2.3_php8.1-x86_64-linux-glibc-debug-zts.zip');
    });

    test('creates the release before uploading the asset when create-release is true', async () => {
        vi.spyOn(action, 'extensionDetails').mockResolvedValue({
            releaseTag: '1.2.3',
            extSoFile: 'foo.so',
            extPackageName: 'php_foo-1.2.3_php8.1-x86_64-linux-glibc-debug-zts.zip',
        });
        vi.spyOn(action, 'buildExtension').mockResolvedValue();
        vi.spyOn(action, 'createRelease').mockResolvedValue();
        vi.spyOn(action, 'uploadReleaseAsset').mockResolvedValue();
        vi.spyOn(exec, 'exec').mockResolvedValue();
        core.getInput.mockImplementation((name) => {
            if (name === 'build-path') return '.';
            return '';
        });
        core.getBooleanInput.mockImplementation((name) => name === 'create-release');

        await action.main();

        expect(action.createRelease).toHaveBeenCalledWith('1.2.3');
        expect(action.uploadReleaseAsset).toHaveBeenCalledWith('1.2.3', 'php_foo-1.2.3_php8.1-x86_64-linux-glibc-debug-zts.zip');
        expect(action.createRelease.mock.invocationCallOrder.at(-1))
            .toBeLessThan(action.uploadReleaseAsset.mock.invocationCallOrder.at(-1));
    });
});
