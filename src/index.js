import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

async function determineExtensionNameFromComposerJson() {
    core.info("Detecting extension name from composer.json...");

    if (!fs.existsSync("composer.json")) {
        throw new Error("composer.json not found. This does not appear to be a PIE package.");
    }

    const type = (await exec.getExecOutput("jq", ["-r", ".type", "composer.json"], {
        ignoreReturnCode: true
    })).stdout.trim();
    if (type !== "php-ext" && type !== "php-ext-zend") {
        throw new Error(`composer.json type must be "php-ext" or "php-ext-zend", but "${type}" was found.`);
    }

    let extName = (await exec.getExecOutput("jq", ["-r", '."php-ext"."extension-name"', "composer.json"], {
        ignoreReturnCode: true
    })).stdout.trim();

    // If extension-name is not defined, fall back according to package name (without vendor prefix)
    // https://github.com/php/pie/blob/f9cb8d3034697dc5b4054614a25b0860c861e496/src/ExtensionName.php#L58
    if (extName === "null" || extName === "") {
        core.info(".php-ext.extension-name not found in composer.json, falling back to package name...");
        const packageName = (await exec.getExecOutput("jq", ["-r", ".name", "composer.json"], {
            ignoreReturnCode: true
        })).stdout.trim();

        if (packageName === "null" || packageName === "") {
            throw new Error("Could not determine extension name: both .\"php-ext\".\"extension-name\" and .name are missing in composer.json");
        }

        extName = packageName.split('/').pop();
    }

    // If the extension is prefixed with "ext-", strip it
    if (extName.startsWith("ext-")) {
        extName = extName.substring(4);
    }

    // Validate according to https://github.com/php/pie/blob/f9cb8d3034697dc5b4054614a25b0860c861e496/src/ExtensionName.php#L33
    if (!/^[A-Za-z][a-zA-Z0-9_]+$/.test(extName)) {
        throw new Error(`Invalid extension name: "${extName}" - must be alphanumeric/underscores only.`);
    }

    return extName;
}

async function buildExtension() {
    core.info("Building the extension...");
    const configureFlags = core.getInput("configure-flags").split(' ');
    const buildPath = core.getInput("build-path") || ".";
    const opts = buildPath !== "." ? { cwd: buildPath } : {};

    await exec.exec("phpize", [], opts);
    await exec.exec("./configure", configureFlags, opts);
    await exec.exec("make", [], opts);
}

async function determinePhpVersionFromPhpConfig() {
    core.info("Detecting php version...");
    return (await exec.getExecOutput("php-config", ["--version"]))
            .stdout
            .trim()
            .split('.')
            .slice(0, 2)
            .join('.');
}

async function determineArchitecture() {
    core.info("Detecting architecture...");
    const arch = process.arch;
    const map = {
        'x64': 'x86_64',
        'arm64': 'arm64',
        'ia32': 'x86'
    };

    if (!map[arch]) {
        throw new Error(`Unsupported architecture: ${arch}`);
    }

    return map[arch];
}

async function determineOperatingSystem() {
    core.info("Detecting operating system...");
    switch (process.platform) {
        case "linux":
        case "darwin":
            return process.platform;
        // aix|freebsd|openbsd|sunos|win32 not supported at this time
        default:
            throw new Error(`Unsupported operating system: ${process.platform}`);
    }
}

async function determineLibcFlavour() {
    core.info("Detecting libc flavour...");
    if (process.platform === "darwin") {
        return "bsdlibc";
    }

    const lddOutput = (await exec.getExecOutput("ldd", ["--version"], { ignoreReturnCode: true })).stdout;
    if (lddOutput.includes("musl")) {
        return "musl";
    }

    return "glibc";
}

async function determinePhpBinary() {
    core.info("Locating PHP binary...");
    const phpBinary = (await exec.getExecOutput("php-config", ["--php-binary"]))
        .stdout
        .trim();

    if (phpBinary === "NONE") {
        core.warning("php-config --php-binary returned NONE, will just use 'php' which... should work?");
        return "php";
    }

    return phpBinary;
}

async function determinePhpDebugMode(phpBinary) {
    core.info("Detecting Zend debug mode...");
    return (await exec.getExecOutput(
            phpBinary,
            ["-n", "-r", "echo PHP_DEBUG ? '-debug' : '';"],
        ))
        .stdout
        .trim();
}

async function determineZendThreadSafeMode(phpBinary) {
    core.info("Detecting Zend thread safety mode...");
    return (await exec.getExecOutput(
            phpBinary,
            ["-n", "-r", "echo ZEND_THREAD_SAFE ? '-zts' : '';"],
        ))
        .stdout
        .trim();
}

async function findRelease(octokit, owner, repo, releaseTag) {
    const { data: releases } = await octokit.rest.repos.listReleases({
        owner,
        repo,
    });

    return releases.find(r => r.tag_name === releaseTag);
}

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const RELEASE_LOCK_POLL_INTERVAL_MS = 2000;
const RELEASE_LOCK_MAX_POLL_ATTEMPTS = 30;

// Simulate `--notes-from-tag` flag since the octokit API doesn't have an equivalent
async function getReleaseNotesFromTag(octokit, owner, repo, releaseTag) {
    let ref;
    try {
        ({ data: ref } = await octokit.rest.git.getRef({
            owner,
            repo,
            ref: `tags/${releaseTag}`,
        }));
    } catch (err) {
        if (err.status !== 404) {
            throw err;
        }
        return '';
    }

    if (ref.object.type === 'tag') {
        const { data: tagObject } = await octokit.rest.git.getTag({
            owner,
            repo,
            tag_sha: ref.object.sha,
        });
        return tagObject.message;
    }

    const { data: commit } = await octokit.rest.git.getCommit({
        owner,
        repo,
        commit_sha: ref.object.sha,
    });
    return commit.message;
}

async function deleteReleaseLock(octokit, owner, repo, releaseTag) {
    try {
        await octokit.rest.git.deleteRef({
            owner,
            repo,
            ref: `pie-release-lock/${releaseTag}`,
        });
    } catch (err) {
        core.warning(`Failed to release lock for tag: ${releaseTag} after a failed release creation: ${err.message}`);
    }
}

// Create the release, but use a ref locking approach to avoid TOCTOU race
// conditions that would result in multiple duplicate draft releases being
// created.
async function createRelease(releaseTag) {
    const githubToken = core.getInput("github-token");
    const octokit = github.getOctokit(githubToken);
    const { owner, repo } = github.context.repo;

    core.info(`Checking whether a release already exists for tag: ${releaseTag}...`);
    if (await action.findRelease(octokit, owner, repo, releaseTag)) {
        core.info(`Release already exists for tag: ${releaseTag}, skipping creation.`);
        return;
    }

    const lockRef = `refs/pie-release-lock/${releaseTag}`;
    core.info(`Release not found for tag: ${releaseTag}. Attempting to acquire lock (${lockRef}) to create it...`);

    let lockAcquired = false;
    try {
        await octokit.rest.git.createRef({
            owner,
            repo,
            ref: lockRef,
            sha: github.context.sha,
        });
        lockAcquired = true;
    } catch (err) {
        if (err.status !== 422) {
            throw err;
        }
        core.info("Lock is already held by another job, will wait for the release to be created...");
    }

    if (lockAcquired) {
        core.info(`Lock acquired, creating release for tag: ${releaseTag}...`);
        try {
            const notes = await action.getReleaseNotesFromTag(octokit, owner, repo, releaseTag);
            await octokit.rest.repos.createRelease({
                owner,
                repo,
                tag_name: releaseTag,
                name: releaseTag,
                draft: true,
                ...(notes ? { body: notes } : { generate_release_notes: true }),
            });
        } catch (err) {
            if (!(await action.findRelease(octokit, owner, repo, releaseTag))) {
                await action.deleteReleaseLock(octokit, owner, repo, releaseTag);
            }
            throw err;
        }

        core.info(`Release created for tag: ${releaseTag}.`);
        return;
    }

    for (let attempt = 1; attempt <= RELEASE_LOCK_MAX_POLL_ATTEMPTS; attempt++) {
        await action.sleep(RELEASE_LOCK_POLL_INTERVAL_MS);

        if (await action.findRelease(octokit, owner, repo, releaseTag)) {
            core.info(`Release for tag: ${releaseTag} has now been created by another job.`);
            return;
        }

        core.info(`Still waiting for release to be created for tag: ${releaseTag} (attempt ${attempt}/${RELEASE_LOCK_MAX_POLL_ATTEMPTS})...`);
    }

    throw new Error(`Timed out waiting for release to be created for tag: ${releaseTag}`);
}

const RELEASE_VISIBILITY_POLL_INTERVAL_MS = 1000;
const RELEASE_VISIBILITY_MAX_POLL_ATTEMPTS = 10;

async function uploadReleaseAsset(releaseTag, packageFilename) {
    core.info("Uploading release asset...");
    const githubToken = core.getInput("github-token");

    const octokit = github.getOctokit(githubToken);
    const { owner, repo } = github.context.repo;

    core.info(`Searching for release with tag: ${releaseTag} (including drafts)...`);
    let release = await action.findRelease(octokit, owner, repo, releaseTag);

    // A release that was just created (e.g. by createRelease) can take a moment to become
    // visible via listReleases, even to the job that just created it - so don't fail on
    // the first miss.
    for (let attempt = 1; !release && attempt <= RELEASE_VISIBILITY_MAX_POLL_ATTEMPTS; attempt++) {
        core.info(`Release not visible yet for tag: ${releaseTag}, retrying (attempt ${attempt}/${RELEASE_VISIBILITY_MAX_POLL_ATTEMPTS})...`);
        await action.sleep(RELEASE_VISIBILITY_POLL_INTERVAL_MS);
        release = await action.findRelease(octokit, owner, repo, releaseTag);
    }

    if (!release) {
        throw new Error(`No release found for tag: ${releaseTag}`);
    }

    core.info(`Found release ${release.name || release.tag_name} (ID: ${release.id})`);
    await octokit.rest.repos.uploadReleaseAsset({
        owner,
        repo,
        release_id: release.id,
        name: packageFilename,
        data: fs.readFileSync(path.resolve(packageFilename)),
    });

    core.info("Asset uploaded successfully!");
}

async function extensionDetails() {
    const releaseTag = core.getInput("release-tag");
    const phpBinary = await action.determinePhpBinary();
    const extName = await action.determineExtensionNameFromComposerJson();
    const phpMajorMinor = await action.determinePhpVersionFromPhpConfig();
    const arch = await action.determineArchitecture();
    const os = await action.determineOperatingSystem();
    const libcFlavour = await action.determineLibcFlavour();
    const zendDebug = await action.determinePhpDebugMode(phpBinary);
    const ztsMode = await action.determineZendThreadSafeMode(phpBinary);

    return {
        releaseTag: releaseTag,
        extSoFile: `${extName}.so`,
        extPackageName: `php_${extName}-${releaseTag}_php${phpMajorMinor}-${arch}-${os}-${libcFlavour}${zendDebug}${ztsMode}.zip`
    };
}

async function main() {
    const { releaseTag, extSoFile, extPackageName } = await action.extensionDetails();

    await action.buildExtension();

    const buildPath = core.getInput("build-path") || ".";
    const modulesDir = path.join(buildPath, "modules");
    await exec.exec("ls", ["-l", modulesDir]);

    await exec.exec("zip", ["-j", extPackageName, path.join(modulesDir, extSoFile)]);

    if (core.getBooleanInput("create-release")) {
        await action.createRelease(releaseTag);
    }

    await action.uploadReleaseAsset(releaseTag, extPackageName);

    core.setOutput("package-path", extPackageName);
}

const action = {
    determineExtensionNameFromComposerJson,
    buildExtension,
    determinePhpVersionFromPhpConfig,
    determineArchitecture,
    determineOperatingSystem,
    determineLibcFlavour,
    determinePhpBinary,
    determinePhpDebugMode,
    determineZendThreadSafeMode,
    findRelease,
    sleep,
    getReleaseNotesFromTag,
    deleteReleaseLock,
    createRelease,
    uploadReleaseAsset,
    extensionDetails,
    main,
};

export {
    determineExtensionNameFromComposerJson,
    buildExtension,
    determinePhpVersionFromPhpConfig,
    determineArchitecture,
    determineOperatingSystem,
    determineLibcFlavour,
    determinePhpBinary,
    determinePhpDebugMode,
    determineZendThreadSafeMode,
    findRelease,
    sleep,
    getReleaseNotesFromTag,
    deleteReleaseLock,
    createRelease,
    uploadReleaseAsset,
    extensionDetails,
    main,
};
export default action;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    action.main();
}
