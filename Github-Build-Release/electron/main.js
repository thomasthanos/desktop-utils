const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, execFile } = require('child_process');


const baseEnv = { ...process.env };

const STRICT_SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_SELECTED_RELEASES = 50;
const MAX_AI_CONTEXT_LENGTH = 18000;
const DEEPSEEK_MODEL = 'deepseek-v4-flash';
const DEFAULT_AI_OUTPUT_TOKENS = 1400;
const AI_DIFF_EXCLUSIONS = [
    ':(exclude,glob)**/package-lock.json',
    ':(exclude,glob)**/yarn.lock',
    ':(exclude,glob)**/pnpm-lock.yaml',
    ':(exclude,glob)**/bun.lockb',
    ':(exclude,glob)**/dist/**',
    ':(exclude,glob)**/release/**'
];

let activeMutationJob = null;

const isDev = process.env.NODE_ENV === 'development';

// Some firewalls block QUIC/UDP traffic and cause Chromium requests to fail with
// ERR_QUIC_PROTOCOL_ERROR. Force HTTPS traffic through TCP for better reliability.
app.commandLine.appendSwitch('disable-quic');

// Override userData path: AppData/Roaming/ThomasThanos/GithubReleaseManager
const customUserData = path.join(app.getPath('appData'), 'ThomasThanos', 'GithubReleaseManager');
app.setPath('userData', customUserData);

let mainWindow;

// Config path για αποθήκευση API key
let configPath;
app.whenReady().then(() => {
    configPath = path.join(app.getPath('userData'), 'grm-config.json');
});

function readConfig() {
    try {
        if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        }
    } catch {
        // Invalid or unreadable config falls back to an empty configuration.
    }
    return {};
}

function writeConfig(data) {
    try {
        const current = readConfig();
        fs.writeFileSync(configPath, JSON.stringify({ ...current, ...data }, null, 2));
        return true;
    } catch { return false; }
}

function getBuildCommand(projectPath, overrideCommand) {
    if (overrideCommand && overrideCommand.trim()) return overrideCommand.trim();

    const pkgPath = path.join(projectPath, 'package.json');
    let buildCommand = null;

    try {
        const pkgRaw = fs.readFileSync(pkgPath, 'utf-8');
        const pkg = JSON.parse(pkgRaw);
        const scripts = pkg.scripts || {};

        // Prefer a build-only script. Publishing is controlled explicitly by
        // this app after the artifacts have been verified.
        if (scripts.build) {
            buildCommand = 'npm run build';
        } else if (scripts['build-all']) {
            buildCommand = 'npm run build-all';
        } else if (scripts['release']) {
            buildCommand = 'npm run release';
        }
    } catch {
        buildCommand = null;
    }

    return buildCommand;
}

function createCodedError(message, code = 'UNKNOWN_ERROR') {
    const error = new Error(message);
    error.code = code;
    return error;
}

function getErrorCode(error, fallback = 'UNKNOWN_ERROR') {
    return typeof error?.code === 'string' ? error.code : fallback;
}

function acquireMutationJob(jobName) {
    if (activeMutationJob) {
        throw createCodedError(
            `Another repository operation is already running (${activeMutationJob}).`,
            'JOB_IN_PROGRESS'
        );
    }
    activeMutationJob = jobName;
}

function releaseMutationJob(jobName) {
    if (activeMutationJob === jobName) {
        activeMutationJob = null;
    }
}

function resolveProjectDirectory(projectPath) {
    if (typeof projectPath !== 'string' || !projectPath.trim()) {
        throw createCodedError('Project path is required.', 'PROJECT_PATH_REQUIRED');
    }

    const resolvedPath = path.resolve(projectPath.trim());
    let stats;
    try {
        stats = fs.statSync(resolvedPath);
    } catch {
        throw createCodedError('The selected project folder does not exist.', 'PROJECT_NOT_FOUND');
    }

    if (!stats.isDirectory()) {
        throw createCodedError('The selected project path is not a folder.', 'INVALID_PROJECT_PATH');
    }

    return resolvedPath;
}

function parseStrictVersion(value, errorCode = 'INVALID_VERSION') {
    if (typeof value !== 'string' || !value.trim()) {
        throw createCodedError('A semantic version is required.', errorCode);
    }

    const trimmed = value.trim();
    const packageVersion = trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
    const match = STRICT_SEMVER_PATTERN.exec(packageVersion);

    if (!match) {
        throw createCodedError(
            `Invalid version "${trimmed}". Use strict major.minor.patch format (for example, v1.2.3).`,
            errorCode
        );
    }

    return {
        packageVersion,
        tagName: `v${packageVersion}`,
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3])
    };
}

function bumpPatchVersion(version) {
    const parsed = parseStrictVersion(version, 'INVALID_PROJECT_VERSION');
    if (!Number.isSafeInteger(parsed.patch + 1)) {
        throw createCodedError('The project patch version is too large to increment safely.', 'INVALID_PROJECT_VERSION');
    }
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

function readProjectPackage(projectPath) {
    const pkgPath = path.join(projectPath, 'package.json');
    let raw;
    let pkg;

    try {
        raw = fs.readFileSync(pkgPath, 'utf-8');
        pkg = JSON.parse(raw);
    } catch (error) {
        throw createCodedError(
            `Could not read a valid package.json: ${error.message}`,
            'INVALID_PACKAGE_JSON'
        );
    }

    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
        throw createCodedError('package.json must contain a JSON object.', 'INVALID_PACKAGE_JSON');
    }

    return { pkgPath, raw, pkg };
}

function serializeJsonLikeSource(value, source) {
    const indentMatch = source.match(/\n([\t ]+)\S/);
    const indent = indentMatch ? indentMatch[1] : '  ';
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const trailingNewline = /\r?\n$/.test(source);
    const serialized = JSON.stringify(value, null, indent).replace(/\n/g, newline);
    return trailingNewline ? `${serialized}${newline}` : serialized;
}

function writeFileAtomically(filePath, contents) {
    const tempPath = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
    );

    try {
        fs.writeFileSync(tempPath, contents, 'utf-8');
        fs.renameSync(tempPath, filePath);
    } finally {
        try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch {
            // Temporary-file cleanup is best effort.
        }
    }
}

function readPersistedVersionState(projectPath) {
    const { pkg } = readProjectPackage(projectPath);
    const lockPath = path.join(projectPath, 'package-lock.json');
    const state = {
        packageVersion: typeof pkg.version === 'string' ? pkg.version : null,
        lockPresent: fs.existsSync(lockPath),
        lockVersion: null,
        lockRootPresent: false,
        lockRootVersion: null
    };

    if (state.lockPresent) {
        let lock;
        try {
            lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
        } catch (error) {
            throw createCodedError(
                `Could not verify package-lock.json: ${error.message}`,
                'VERSION_PERSISTENCE_FAILED'
            );
        }
        state.lockVersion = typeof lock.version === 'string' ? lock.version : null;
        state.lockRootPresent = Boolean(lock.packages?.['']);
        state.lockRootVersion = typeof lock.packages?.['']?.version === 'string'
            ? lock.packages[''].version
            : null;
    }

    return state;
}

function assertPersistedProjectVersion(projectPath, expectedVersion) {
    const state = readPersistedVersionState(projectPath);
    const mismatches = [];

    if (state.packageVersion !== expectedVersion) {
        mismatches.push(`package.json=${state.packageVersion || 'missing'}`);
    }
    if (state.lockPresent && state.lockVersion !== expectedVersion) {
        mismatches.push(`package-lock.json=${state.lockVersion || 'missing'}`);
    }
    if (state.lockRootPresent && state.lockRootVersion !== expectedVersion) {
        mismatches.push(`package-lock root=${state.lockRootVersion || 'missing'}`);
    }

    if (mismatches.length) {
        throw createCodedError(
            `Version persistence check failed; expected ${expectedVersion}, found ${mismatches.join(', ')}.`,
            'VERSION_PERSISTENCE_FAILED'
        );
    }

    return state;
}

function updateProjectVersionFiles(projectPath, packageVersion) {
    const packageInfo = readProjectPackage(projectPath);
    const lockPath = path.join(projectPath, 'package-lock.json');
    const snapshot = {
        packagePath: packageInfo.pkgPath,
        packageRaw: packageInfo.raw,
        previousPackageVersion: packageInfo.pkg.version,
        appliedVersion: packageVersion,
        lockPath,
        lockRaw: null,
        lockHadVersion: false,
        previousLockVersion: undefined,
        lockRootHadVersion: false,
        previousLockRootVersion: undefined
    };

    let lockRaw = null;
    let lock = null;
    if (fs.existsSync(lockPath)) {
        try {
            lockRaw = fs.readFileSync(lockPath, 'utf-8');
            lock = JSON.parse(lockRaw);
            snapshot.lockRaw = lockRaw;
            snapshot.lockHadVersion = Object.prototype.hasOwnProperty.call(lock, 'version');
            snapshot.previousLockVersion = lock.version;
            snapshot.lockRootHadVersion = Boolean(
                lock.packages?.[''] && Object.prototype.hasOwnProperty.call(lock.packages[''], 'version')
            );
            snapshot.previousLockRootVersion = lock.packages?.['']?.version;
        } catch (error) {
            throw createCodedError(
                `Could not update version because package-lock.json is invalid: ${error.message}`,
                'INVALID_PACKAGE_LOCK'
            );
        }
    }

    packageInfo.pkg.version = packageVersion;
    if (lock && typeof lock === 'object') {
        lock.version = packageVersion;
        if (lock.packages?.[''] && typeof lock.packages[''] === 'object') {
            lock.packages[''].version = packageVersion;
        }
    }

    try {
        writeFileAtomically(
            packageInfo.pkgPath,
            serializeJsonLikeSource(packageInfo.pkg, packageInfo.raw)
        );
        if (lock) {
            writeFileAtomically(lockPath, serializeJsonLikeSource(lock, lockRaw));
        }

        assertPersistedProjectVersion(projectPath, packageVersion);
    } catch (error) {
        try {
            writeFileAtomically(packageInfo.pkgPath, snapshot.packageRaw);
            if (snapshot.lockRaw !== null) writeFileAtomically(lockPath, snapshot.lockRaw);
        } catch {
            // Preserve the original version-update error if rollback also fails here.
        }
        throw createCodedError(
            `Could not update project version: ${error.message}`,
            getErrorCode(error, 'VERSION_UPDATE_FAILED')
        );
    }

    return { ...snapshot, verifiedVersion: packageVersion };
}

function rollbackProjectVersionFiles(snapshot) {
    if (!snapshot) return;

    const currentPackageRaw = fs.readFileSync(snapshot.packagePath, 'utf-8');
    const currentPackage = JSON.parse(currentPackageRaw);
    if (
        currentPackage.version !== snapshot.appliedVersion &&
        currentPackage.version !== snapshot.previousPackageVersion
    ) {
        throw createCodedError(
            `package.json version changed to ${currentPackage.version} during the build; rollback was stopped to preserve that change.`,
            'VERSION_ROLLBACK_CONFLICT'
        );
    }
    currentPackage.version = snapshot.previousPackageVersion;

    let currentLockRaw = null;
    let currentLock = null;
    if (snapshot.lockRaw !== null) {
        if (!fs.existsSync(snapshot.lockPath)) {
            throw createCodedError(
                'package-lock.json was removed during the build; rollback was stopped to preserve the build output.',
                'VERSION_ROLLBACK_CONFLICT'
            );
        }
        currentLockRaw = fs.readFileSync(snapshot.lockPath, 'utf-8');
        currentLock = JSON.parse(currentLockRaw);

        const lockVersions = [
            currentLock.version,
            currentLock.packages?.['']?.version
        ].filter(value => value !== undefined);
        if (lockVersions.some(value => (
            value !== snapshot.appliedVersion &&
            value !== snapshot.previousLockVersion &&
            value !== snapshot.previousLockRootVersion
        ))) {
            throw createCodedError(
                'package-lock.json version changed independently during the build; rollback was stopped.',
                'VERSION_ROLLBACK_CONFLICT'
            );
        }

        if (snapshot.lockHadVersion) currentLock.version = snapshot.previousLockVersion;
        else delete currentLock.version;

        if (currentLock.packages?.['']) {
            if (snapshot.lockRootHadVersion) {
                currentLock.packages[''].version = snapshot.previousLockRootVersion;
            } else {
                delete currentLock.packages[''].version;
            }
        }
    }

    try {
        writeFileAtomically(
            snapshot.packagePath,
            serializeJsonLikeSource(currentPackage, currentPackageRaw)
        );
        if (currentLock) {
            writeFileAtomically(
                snapshot.lockPath,
                serializeJsonLikeSource(currentLock, currentLockRaw)
            );
        }
    } catch (error) {
        try {
            writeFileAtomically(snapshot.packagePath, currentPackageRaw);
            if (currentLockRaw !== null) writeFileAtomically(snapshot.lockPath, currentLockRaw);
        } catch {
            // Preserve the original rollback error.
        }
        throw error;
    }
}

function execCommand(command, options = {}) {
    return new Promise((resolve) => {
        exec(command, { env: baseEnv, ...options }, (error, stdout = '', stderr = '') => {
            resolve({ error, stdout, stderr });
        });
    });
}

function findArtifactDirectory(projectPath) {
    const ignoredDirectoryNames = new Set(['node_modules', '.git', '.cache']);
    const rootCandidates = [
        path.join(projectPath, 'release'),
        path.join(projectPath, 'dist')
    ];

    for (const candidate of rootCandidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
            return candidate;
        }
    }

    const queue = [{ dir: projectPath, depth: 0 }];
    const visited = new Set([projectPath]);

    while (queue.length > 0) {
        const { dir, depth } = queue.shift();
        if (depth >= 3) continue;

        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (ignoredDirectoryNames.has(entry.name.toLowerCase())) continue;
            const fullPath = path.join(dir, entry.name);
            const lowerName = entry.name.toLowerCase();

            if (lowerName === 'dist' || lowerName === 'release') {
                return fullPath;
            }
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (ignoredDirectoryNames.has(entry.name.toLowerCase())) continue;
            const fullPath = path.join(dir, entry.name);
            if (!visited.has(fullPath)) {
                visited.add(fullPath);
                queue.push({ dir: fullPath, depth: depth + 1 });
            }
        }
    }

    return null;
}

function truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) return text || '';
    return `${text.slice(0, maxLength)}\n\n[truncated: output too large]`;
}

function parseAiJson(raw) {
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
        title: parsed.title || '',
        notes: parsed.notes || raw
    };
}

function execFileCommand(file, args, options = {}) {
    return new Promise((resolve) => {
        execFile(file, args, { env: baseEnv, ...options }, (error, stdout = '', stderr = '') => {
            resolve({ error, stdout, stderr });
        });
    });
}

async function readResponseJson(response) {
    const text = await response.text();
    if (!text) return {};

    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

function getAiNetworkErrorMessage(error) {
    const firewallHint = 'Could not reach DeepSeek. Check your internet connection or allow this app in Bitdefender/firewall, then try again.';
    const code = error?.cause?.code || error?.code;
    if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT') {
        return firewallHint;
    }

    if (error?.message === 'fetch failed') {
        return firewallHint;
    }

    return error?.message || 'AI request failed.';
}

async function callDeepseek({
    apiKey,
    systemPrompt,
    userPrompt,
    maxOutputTokens = DEFAULT_AI_OUTPUT_TOKENS
}) {
    let response;
    try {
        response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: DEEPSEEK_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                thinking: { type: 'disabled' },
                max_tokens: maxOutputTokens,
                response_format: { type: 'json_object' }
            })
        });
    } catch (err) {
        throw new Error(getAiNetworkErrorMessage(err));
    }

    const data = await readResponseJson(response);
    if (!response.ok) {
        const detail = data.error?.message || data.message || data.raw;
        throw new Error(detail || `DeepSeek API request failed with status ${response.status}.`);
    }

    const choice = data?.choices?.[0];
    if (choice?.finish_reason === 'length') {
        throw new Error('AI output reached the low-cost limit. Select fewer releases or use a smaller commit range.');
    }

    const raw = choice?.message?.content?.trim() || '';
    if (!raw) {
        throw new Error('Empty response from AI model');
    }

    const usage = {
        promptTokens: data?.usage?.prompt_tokens || 0,
        completionTokens: data?.usage?.completion_tokens || 0,
        totalTokens: data?.usage?.total_tokens || 0,
        cacheHitTokens: data?.usage?.prompt_cache_hit_tokens || 0
    };

    try {
        return { ...parseAiJson(raw), usage, model: data?.model || DEEPSEEK_MODEL };
    } catch {
        return { title: '', notes: raw, usage, model: data?.model || DEEPSEEK_MODEL };
    }
}

async function getGhStatus() {
    const versionResult = await execCommand('gh --version');
    if (versionResult.error) {
        return { installed: false, loggedIn: false };
    }

    const authResult = await execCommand('gh auth status');
    const output = `${authResult.stdout}\n${authResult.stderr}`;
    const loggedIn = !authResult.error && /logged in/i.test(output);

    return { installed: true, loggedIn };
}

async function installGhCliIfMissing() {
    if (process.platform !== 'win32') {
        return {
            success: false,
            error: 'Automatic GitHub CLI install is currently enabled only on Windows.'
        };
    }

    const installCommand = 'winget install --id GitHub.cli -e --source winget --accept-source-agreements --accept-package-agreements';
    const result = await execCommand(installCommand, { timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 });

    if (result.error) {
        return {
            success: false,
            error: (result.stderr || result.stdout || result.error.message || 'Failed to install GitHub CLI').trim()
        };
    }

    return { success: true };
}

function openGhAuthTerminal() {
    try {
        if (process.platform === 'win32') {
            exec('start "" cmd /k "gh auth login"', { env: baseEnv });
            return true;
        }

        if (process.platform === 'darwin') {
            exec(`osascript -e 'tell application "Terminal" to do script "gh auth login"'`, { env: baseEnv });
            return true;
        }

        if (process.platform === 'linux') {
            exec('x-terminal-emulator -e bash -lc "gh auth login; exec bash"', { env: baseEnv });
            return true;
        }
    } catch (err) {
        console.error('Could not open gh auth terminal:', err);
    }

    return false;
}

async function collectGitChanges(projectPath) {
    const statusResult = await execFileCommand(
        'git',
        ['status', '--short', '--untracked-files=all'],
        { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 }
    );
    if (statusResult.error) {
        throw createCodedError('The selected folder is not a valid Git repository.', 'INVALID_REPOSITORY');
    }

    const statusText = statusResult.stdout.trim();

    if (!statusText) {
        const headResult = await execFileCommand(
            'git',
            [
                'show',
                '--root',
                '--no-ext-diff',
                '--no-color',
                '--format=fuller',
                '--stat',
                '--patch',
                'HEAD',
                '--',
                ...AI_DIFF_EXCLUSIONS
            ],
            { cwd: projectPath, maxBuffer: 15 * 1024 * 1024 }
        );

        if (headResult.error || !headResult.stdout.trim()) {
            throw createCodedError('Commit not found. The repository has no readable HEAD commit.', 'COMMIT_NOT_FOUND');
        }

        return {
            source: 'head',
            filesChanged: '',
            statusText: '',
            stagedDiff: '',
            unstagedDiff: '',
            recentCommits: '',
            headDiff: truncateText(headResult.stdout.trim(), 12000)
        };
    }

    const [stagedFilesResult, unstagedFilesResult, stagedDiffResult, unstagedDiffResult] = await Promise.all([
        execFileCommand('git', ['diff', '--cached', '--name-status', '--'], { cwd: projectPath }),
        execFileCommand('git', ['diff', '--name-status', '--'], { cwd: projectPath }),
        execFileCommand(
            'git',
            ['diff', '--cached', '--no-color', '--unified=1', '--', ...AI_DIFF_EXCLUSIONS],
            { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 }
        ),
        execFileCommand(
            'git',
            ['diff', '--no-color', '--unified=1', '--', ...AI_DIFF_EXCLUSIONS],
            { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 }
        )
    ]);

    for (const result of [stagedFilesResult, unstagedFilesResult, stagedDiffResult, unstagedDiffResult]) {
        if (result.error) {
            throw createCodedError('Could not read the current Git working tree.', 'GIT_DIFF_FAILED');
        }
    }

    const filesChanged = [
        ...stagedFilesResult.stdout.split('\n'),
        ...unstagedFilesResult.stdout.split('\n'),
        ...statusText
            .split('\n')
            .filter(line => line.startsWith('??'))
            .map(line => line.slice(3))
    ]
        .map(line => line.trim())
        .filter(Boolean);

    const filesChangedUnique = [...new Set(filesChanged)];
    const stagedDiff = stagedDiffResult.stdout.trim();
    const unstagedDiff = unstagedDiffResult.stdout.trim();

    return {
        source: 'working-tree',
        filesChanged: truncateText(filesChangedUnique.join('\n'), 2500),
        statusText: truncateText(statusText, 2000),
        stagedDiff: truncateText(stagedDiff, 6000),
        unstagedDiff: truncateText(unstagedDiff, 6000),
        recentCommits: '',
        headDiff: ''
    };
}

async function getCommitList(projectPath) {
    const verifyResult = await execFileCommand(
        'git',
        ['rev-parse', '--is-inside-work-tree'],
        { cwd: projectPath }
    );
    if (verifyResult.error) {
        throw createCodedError('The selected folder is not a valid Git repository.', 'INVALID_REPOSITORY');
    }

    const result = await execFileCommand(
        'git',
        ['log', '--format=%H|%s|%ai', '-n', '100', 'HEAD'],
        { cwd: projectPath, maxBuffer: 5 * 1024 * 1024 }
    );

    if (result.error) {
        throw createCodedError('Commit not found. The repository has no readable HEAD commit.', 'COMMIT_NOT_FOUND');
    }

    const lines = result.stdout.trim().split('\n').filter(Boolean);
    const commits = lines.map(line => {
        const parts = line.split('|');
        const hash = parts[0] || '';
        const date = parts[parts.length - 1] || '';
        // Message may contain '|' so rejoin the middle parts
        const message = parts.slice(1, parts.length - 1).join('|') || '';
        return {
            hash: hash.trim(),
            shortHash: hash.trim().substring(0, 7),
            message: message.trim(),
            date: date.trim()
        };
    }).filter(c => c.hash);

    if (!commits.length) {
        throw createCodedError('Commit not found. The repository has no commits.', 'COMMIT_NOT_FOUND');
    }

    return commits;
}

async function resolveCommitHash(projectPath, value) {
    if (typeof value !== 'string' || !/^[0-9a-fA-F]{4,40}$/.test(value.trim())) {
        throw createCodedError('Commit not found. Enter a valid Git commit hash.', 'COMMIT_NOT_FOUND');
    }

    const ref = `${value.trim()}^{commit}`;
    const result = await execFileCommand(
        'git',
        ['rev-parse', '--verify', ref],
        { cwd: projectPath, maxBuffer: 1024 * 1024 }
    );

    const resolvedHash = result.stdout.trim();
    if (result.error || !/^[0-9a-fA-F]{40}$/.test(resolvedHash)) {
        throw createCodedError(`Commit not found: ${value.trim().substring(0, 7)}`, 'COMMIT_NOT_FOUND');
    }

    return resolvedHash;
}

async function collectGitChangesFromRange(projectPath, fromHash, toHash) {
    const resolvedFrom = await resolveCommitHash(projectPath, fromHash);
    const resolvedTo = await resolveCommitHash(projectPath, toHash);

    if (resolvedFrom === resolvedTo) {
        throw createCodedError('From and To commits must be different.', 'INVALID_COMMIT_RANGE');
    }

    const ancestryResult = await execFileCommand(
        'git',
        ['merge-base', '--is-ancestor', resolvedFrom, resolvedTo],
        { cwd: projectPath }
    );
    if (ancestryResult.error) {
        throw createCodedError(
            'No commits found in the selected range. Make sure "From" is older than "To".',
            'INVALID_COMMIT_RANGE'
        );
    }

    // Get commit messages in range
    const commitsResult = await execFileCommand(
        'git',
        ['log', '--format=%h %s%n%b', `${resolvedFrom}..${resolvedTo}`, '--'],
        { cwd: projectPath, maxBuffer: 5 * 1024 * 1024 }
    );
    const commitMessages = (commitsResult.stdout || '').trim();

    if (commitsResult.error || !commitMessages) {
        throw createCodedError(
            'No commits found in the selected range. Make sure "From" is older than "To".',
            'INVALID_COMMIT_RANGE'
        );
    }

    // Get diff stat (safe, small output)
    const statResult = await execFileCommand(
        'git',
        ['diff', '--stat', resolvedFrom, resolvedTo, '--'],
        { cwd: projectPath, maxBuffer: 5 * 1024 * 1024 }
    );
    const diffStat = (statResult.stdout || '').trim();

    // Get changed file names
    const filesResult = await execFileCommand(
        'git',
        ['diff', '--name-status', resolvedFrom, resolvedTo, '--'],
        { cwd: projectPath, maxBuffer: 5 * 1024 * 1024 }
    );
    const filesChanged = (filesResult.stdout || '').trim();

    // Try to get the actual diff, but with strict limits to avoid crashes
    let diff = '';
    const diffResult = await execFileCommand(
        'git',
        ['diff', '--no-color', '--unified=1', resolvedFrom, resolvedTo, '--', ...AI_DIFF_EXCLUSIONS],
        { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 }
    );

    if (!diffResult.error) {
        diff = (diffResult.stdout || '').trim();
    }

    return {
        fromHash: resolvedFrom,
        toHash: resolvedTo,
        commitMessages: truncateText(commitMessages, 3500),
        diffStat: truncateText(diffStat, 2000),
        filesChanged: truncateText(filesChanged, 2500),
        diff: truncateText(diff, 8000)
    };
}

function normalizeTagNames(tagNames) {
    if (!Array.isArray(tagNames) || tagNames.length === 0) {
        throw createCodedError('Select at least one release.', 'NO_RELEASES_SELECTED');
    }

    const normalized = [...new Set(tagNames.map(tag => (
        typeof tag === 'string' ? tag.trim() : ''
    )))].filter(Boolean);

    if (normalized.length === 0) {
        throw createCodedError('Select at least one release.', 'NO_RELEASES_SELECTED');
    }
    if (normalized.length > MAX_SELECTED_RELEASES) {
        throw createCodedError(
            `Select no more than ${MAX_SELECTED_RELEASES} releases at once.`,
            'TOO_MANY_RELEASES'
        );
    }

    for (const tagName of normalized) {
        if (
            tagName.length > 200 ||
            tagName.startsWith('-') ||
            /[\0\r\n]/.test(tagName)
        ) {
            throw createCodedError(`Invalid release tag: ${tagName}`, 'INVALID_TAG');
        }
    }

    return normalized;
}

async function validateTagName(projectPath, tagName) {
    const result = await execFileCommand(
        'git',
        ['check-ref-format', `refs/tags/${tagName}`],
        { cwd: projectPath, maxBuffer: 1024 * 1024 }
    );
    if (result.error) {
        throw createCodedError(`Invalid release tag: ${tagName}`, 'INVALID_TAG');
    }
}

async function getReleasePresence(projectPath, tagName) {
    const result = await execFileCommand(
        'gh',
        ['release', 'list', '--json', 'tagName', '--limit', '1000'],
        { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 }
    );

    if (result.error) {
        const detail = `${result.stderr}\n${result.stdout}\n${result.error.message}`.trim();
        return { exists: null, verified: false, error: detail || 'Could not query the GitHub releases.' };
    }

    try {
        const releases = JSON.parse(result.stdout);
        if (!Array.isArray(releases)) throw new Error('Expected a release list.');
        return {
            exists: releases.some(release => release?.tagName === tagName),
            verified: true,
            error: null
        };
    } catch (error) {
        return {
            exists: null,
            verified: false,
            error: `Could not parse the GitHub release list: ${error.message}`
        };
    }
}

async function getLocalTagPresence(projectPath, tagName) {
    const result = await execFileCommand(
        'git',
        ['show-ref', '--verify', '--quiet', `refs/tags/${tagName}`],
        { cwd: projectPath }
    );
    if (!result.error) {
        return { exists: true, verified: true, error: null };
    }
    if (result.error.code === 1) {
        return { exists: false, verified: true, error: null };
    }
    return {
        exists: null,
        verified: false,
        error: (result.stderr || result.error.message || 'Could not query the local tag.').trim()
    };
}

async function getRemoteTagPresence(projectPath, tagName) {
    const result = await execFileCommand(
        'git',
        ['ls-remote', '--tags', '--refs', 'origin', `refs/tags/${tagName}`],
        { cwd: projectPath, maxBuffer: 2 * 1024 * 1024 }
    );

    if (result.error) {
        return {
            exists: null,
            verified: false,
            error: (result.stderr || result.error.message || 'Could not query the remote tag.').trim()
        };
    }

    return { exists: Boolean(result.stdout.trim()), verified: true, error: null };
}

async function getReleaseDetails(projectPath, tagName) {
    const fields = 'tagName,name,body,publishedAt,targetCommitish,url';
    const result = await execFileCommand(
        'gh',
        ['release', 'view', tagName, '--json', fields],
        { cwd: projectPath, maxBuffer: 5 * 1024 * 1024 }
    );

    if (result.error) {
        const detail = (result.stderr || result.error.message || '').trim();
        throw createCodedError(
            detail || `Release not found: ${tagName}`,
            'RELEASE_NOT_FOUND'
        );
    }

    try {
        return JSON.parse(result.stdout);
    } catch {
        throw createCodedError(`Could not parse release metadata for ${tagName}.`, 'INVALID_RELEASE_DATA');
    }
}

async function getOrderedReleaseTags(projectPath) {
    const result = await execFileCommand(
        'gh',
        [
            'release',
            'list',
            '--json',
            'tagName,publishedAt',
            '--limit',
            '1000',
            '--order',
            'asc'
        ],
        { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 }
    );

    if (result.error) return [];

    try {
        const releases = JSON.parse(result.stdout);
        return Array.isArray(releases) ? releases.map(item => item.tagName).filter(Boolean) : [];
    } catch {
        return [];
    }
}

function parseGitCommitRecords(raw) {
    return raw
        .split('\x1e')
        .map(record => record.trim())
        .filter(Boolean)
        .map(record => {
            const [hash = '', subject = '', ...bodyParts] = record.split('\x1f');
            return {
                hash: hash.trim(),
                subject: subject.trim(),
                body: bodyParts.join('\x1f').trim()
            };
        })
        .filter(commit => commit.hash && (commit.subject || commit.body));
}

async function resolveReleaseCommit(projectPath, tagName) {
    const tagCommitRef = `refs/tags/${tagName}^{commit}`;
    let result = await execFileCommand(
        'git',
        ['rev-parse', '--verify', tagCommitRef],
        { cwd: projectPath, maxBuffer: 2 * 1024 * 1024 }
    );

    if (result.error) {
        const fetchResult = await execFileCommand(
            'git',
            ['fetch', '--no-tags', 'origin', `refs/tags/${tagName}`],
            { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 }
        );
        if (fetchResult.error) {
            throw createCodedError(
                (fetchResult.stderr || fetchResult.error.message || `Could not fetch ${tagName}.`).trim(),
                'COMMIT_COVERAGE_UNAVAILABLE'
            );
        }
        result = await execFileCommand(
            'git',
            ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'],
            { cwd: projectPath, maxBuffer: 2 * 1024 * 1024 }
        );
    }

    const commit = result.stdout.trim();
    if (result.error || !/^[0-9a-f]{40,64}$/i.test(commit)) {
        throw createCodedError(
            `Could not resolve the commit for release ${tagName}.`,
            'COMMIT_COVERAGE_UNAVAILABLE'
        );
    }
    return commit;
}

async function collectReleaseCommits(projectPath, currentCommit, previousCommit) {
    const args = previousCommit
        ? [
            'log',
            '--format=%H%x1f%s%x1f%b%x1e',
            `${previousCommit}..${currentCommit}`,
            '--'
        ]
        : [
            'log',
            '--format=%H%x1f%s%x1f%b%x1e',
            currentCommit,
            '--'
        ];

    const result = await execFileCommand(
        'git',
        args,
        { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 }
    );

    if (result.error) {
        throw createCodedError(
            (result.stderr || result.error.message || 'Could not read release commits.').trim(),
            'COMMIT_COVERAGE_UNAVAILABLE'
        );
    }
    return parseGitCommitRecords(result.stdout);
}

async function buildAggregateReleaseContext(projectPath, tagNames) {
    const orderedTags = await getOrderedReleaseTags(projectPath);
    const releaseDetails = [];
    const commitMap = new Map();
    const releaseCommitCache = new Map();

    const getReleaseCommit = async tagName => {
        if (!releaseCommitCache.has(tagName)) {
            releaseCommitCache.set(tagName, await resolveReleaseCommit(projectPath, tagName));
        }
        return releaseCommitCache.get(tagName);
    };

    for (const tagName of tagNames) {
        await validateTagName(projectPath, tagName);
        const details = await getReleaseDetails(projectPath, tagName);
        releaseDetails.push(details);

        const releaseIndex = orderedTags.indexOf(tagName);
        const previousTagName = releaseIndex > 0 ? orderedTags[releaseIndex - 1] : null;
        const currentCommit = await getReleaseCommit(tagName);
        const previousCommit = previousTagName ? await getReleaseCommit(previousTagName) : null;
        const commits = await collectReleaseCommits(projectPath, currentCommit, previousCommit);

        for (const commit of commits) {
            const fallbackKey = `${commit.subject}\n${commit.body}`.trim().toLowerCase();
            const key = commit.hash || fallbackKey;
            if (key && !commitMap.has(key)) commitMap.set(key, commit);
        }
    }

    const perReleaseBodyLimit = Math.max(
        240,
        Math.floor((MAX_AI_CONTEXT_LENGTH * 0.45) / Math.max(releaseDetails.length, 1))
    );
    const releaseSections = releaseDetails.map(details => [
        `Release: ${details.tagName}`,
        `Title: ${details.name || details.tagName}`,
        details.publishedAt ? `Published: ${details.publishedAt}` : '',
        'Existing release notes:',
        truncateText(details.body?.trim() || '(No release notes)', perReleaseBodyLimit)
    ].filter(Boolean).join('\n'));

    const commitSections = [...commitMap.values()].map(commit => {
        const description = [commit.subject, commit.body].filter(Boolean).join('\n');
        return `- ${commit.hash.substring(0, 7)} ${truncateText(description, 500)}`;
    });

    return truncateText([
        'Selected releases:',
        releaseSections.join('\n\n'),
        '',
        'Deduplicated commit descriptions:',
        commitSections.length ? commitSections.join('\n\n') : '(No local commit descriptions were available; use the existing release notes.)'
    ].join('\n'), MAX_AI_CONTEXT_LENGTH);
}

async function deleteReleaseAndTag(projectPath, tagName) {
    await validateTagName(projectPath, tagName);

    const beforeRelease = await getReleasePresence(projectPath, tagName);
    const beforeLocalTag = await getLocalTagPresence(projectPath, tagName);
    const beforeRemoteTag = await getRemoteTagPresence(projectPath, tagName);
    const errors = [];

    // Never start a destructive operation unless both remote sources of truth
    // were queried successfully. A network/auth failure must not be mistaken
    // for an absent release or tag.
    if (!beforeRelease.verified || !beforeLocalTag.verified || !beforeRemoteTag.verified) {
        const preflightErrors = [
            !beforeRelease.verified ? beforeRelease.error : null,
            !beforeLocalTag.verified ? beforeLocalTag.error : null,
            !beforeRemoteTag.verified ? beforeRemoteTag.error : null
        ].filter(Boolean);
        throw createCodedError(
            preflightErrors.join('\n') || `Could not verify ${tagName} before deletion.`,
            'DELETE_PREFLIGHT_FAILED'
        );
    }

    if (beforeRelease.exists) {
        const releaseDeleteResult = await execFileCommand(
            'gh',
            ['release', 'delete', tagName, '--yes'],
            { cwd: projectPath, maxBuffer: 5 * 1024 * 1024 }
        );
        if (releaseDeleteResult.error) {
            errors.push((releaseDeleteResult.stderr || releaseDeleteResult.error.message).trim());
        }
    }

    if (errors.length === 0 && beforeRemoteTag.exists) {
        const remoteDeleteResult = await execFileCommand(
            'git',
            ['push', 'origin', '--delete', tagName],
            { cwd: projectPath, maxBuffer: 5 * 1024 * 1024 }
        );
        if (remoteDeleteResult.error) {
            errors.push((remoteDeleteResult.stderr || remoteDeleteResult.error.message).trim());
        }
    }

    if (errors.length === 0 && beforeLocalTag.exists) {
        const localDeleteResult = await execFileCommand(
            'git',
            ['tag', '-d', tagName],
            { cwd: projectPath, maxBuffer: 2 * 1024 * 1024 }
        );
        if (localDeleteResult.error) {
            errors.push((localDeleteResult.stderr || localDeleteResult.error.message).trim());
        }
    }

    const [afterRelease, afterLocalTag, afterRemoteTag] = await Promise.all([
        getReleasePresence(projectPath, tagName),
        getLocalTagPresence(projectPath, tagName),
        getRemoteTagPresence(projectPath, tagName)
    ]);

    if (!afterRelease.verified) errors.push(afterRelease.error);
    if (!afterLocalTag.verified) errors.push(afterLocalTag.error);
    if (!afterRemoteTag.verified) errors.push(afterRemoteTag.error);

    const releaseDeleted = afterRelease.verified && afterRelease.exists === false;
    const localTagDeleted = afterLocalTag.verified && afterLocalTag.exists === false;
    const remoteTagDeleted = afterRemoteTag.verified && afterRemoteTag.exists === false;
    const success = releaseDeleted && localTagDeleted && remoteTagDeleted;

    return {
        tagName,
        success,
        releaseDeleted,
        localTagDeleted,
        remoteTagDeleted,
        error: success ? null : [...new Set(errors.filter(Boolean))].join('\n') || `Could not fully delete ${tagName}.`
    };
}

async function ensureReleaseTagAvailable(projectPath, tagName) {
    await validateTagName(projectPath, tagName);
    const [release, localTag, remoteTag] = await Promise.all([
        getReleasePresence(projectPath, tagName),
        getLocalTagPresence(projectPath, tagName),
        getRemoteTagPresence(projectPath, tagName)
    ]);

    if (!release.verified) {
        throw createCodedError(release.error || 'Could not check the GitHub release tag.', 'TAG_CHECK_FAILED');
    }
    if (!localTag.verified) {
        throw createCodedError(localTag.error || 'Could not check the local tag.', 'TAG_CHECK_FAILED');
    }
    if (!remoteTag.verified) {
        throw createCodedError(remoteTag.error || 'Could not check the remote tag.', 'TAG_CHECK_FAILED');
    }
    if (release.exists || localTag.exists || remoteTag.exists) {
        throw createCodedError(`Release tag ${tagName} already exists.`, 'VERSION_ALREADY_EXISTS');
    }
}

async function findNextAvailablePatchVersion(projectPath, currentVersion) {
    let candidateVersion = bumpPatchVersion(currentVersion);

    for (let attempt = 0; attempt < 1000; attempt += 1) {
        const candidate = parseStrictVersion(candidateVersion, 'INVALID_PROJECT_VERSION');
        try {
            await ensureReleaseTagAvailable(projectPath, candidate.tagName);
            return candidate;
        } catch (error) {
            if (getErrorCode(error) !== 'VERSION_ALREADY_EXISTS') throw error;
            candidateVersion = bumpPatchVersion(candidateVersion);
        }
    }

    throw createCodedError(
        'Could not find an available patch version after 1000 attempts.',
        'NO_AVAILABLE_VERSION'
    );
}

function sendBuildLog(message) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('build-log', message);
    }
}

function runStreamingBuild(command, options) {
    return new Promise((resolve) => {
        let settled = false;
        let processError = null;
        const child = exec(command, { maxBuffer: 50 * 1024 * 1024, ...options });

        child.stdout?.on('data', data => sendBuildLog(data));
        child.stderr?.on('data', data => sendBuildLog(`[BUILD] ${data}`));
        child.on('error', error => {
            processError = error;
        });
        child.on('close', code => {
            if (settled) return;
            settled = true;
            resolve({ code, error: processError });
        });
    });
}

function collectArtifactDirectories(projectPath) {
    const directories = [
        path.join(projectPath, 'release'),
        path.join(projectPath, 'dist'),
        findArtifactDirectory(projectPath)
    ].filter(Boolean);

    return [...new Set(directories)].filter(directory => {
        try {
            return fs.statSync(directory).isDirectory();
        } catch {
            return false;
        }
    });
}

function scanReleaseArtifacts(projectPath) {
    const candidates = [];
    const skippedDirectories = new Set(['node_modules', '.git', 'win-unpacked', 'linux-unpacked', 'mac']);

    const visit = (directory, depth) => {
        if (depth > 2) return;
        let entries;
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (!skippedDirectories.has(entry.name.toLowerCase())) visit(fullPath, depth + 1);
                continue;
            }
            if (!entry.isFile()) continue;

            const lower = entry.name.toLowerCase();
            const isExe = lower.endsWith('.exe');
            const isUpdaterMetadata = lower.endsWith('.blockmap') || /^latest(?:-[^.]+)?\.ya?ml$/.test(lower);
            if (!isExe && !isUpdaterMetadata) continue;

            try {
                const stats = fs.statSync(fullPath);
                if (stats.size > 0) {
                    candidates.push({
                        filePath: fullPath,
                        name: entry.name,
                        isExe,
                        size: stats.size,
                        mtimeMs: stats.mtimeMs,
                        ctimeMs: stats.ctimeMs
                    });
                }
            } catch {
                // Ignore files that disappear while the artifact directory is scanned.
            }
        }
    };

    for (const directory of collectArtifactDirectories(projectPath)) visit(directory, 0);

    return [...new Map(candidates.map(item => [item.filePath, item])).values()]
        .sort((a, b) => a.name.localeCompare(b.name));
}

function snapshotReleaseArtifacts(projectPath) {
    return new Map(scanReleaseArtifacts(projectPath).map(item => [
        path.normalize(item.filePath).toLowerCase(),
        { size: item.size, mtimeMs: item.mtimeMs, ctimeMs: item.ctimeMs }
    ]));
}

function collectFreshArtifacts(projectPath, previousArtifacts) {
    const uniqueArtifacts = scanReleaseArtifacts(projectPath).filter(item => {
        const previous = previousArtifacts.get(path.normalize(item.filePath).toLowerCase());
        return !previous ||
            previous.size !== item.size ||
            previous.mtimeMs !== item.mtimeMs ||
            previous.ctimeMs !== item.ctimeMs;
    });

    if (!uniqueArtifacts.some(item => item.isExe)) {
        throw createCodedError(
            'The build completed but did not produce a fresh .exe artifact for this release.',
            'NO_FRESH_EXE_ARTIFACT'
        );
    }

    return uniqueArtifacts;
}

async function uploadReleaseArtifact(projectPath, tagName, artifact, environment) {
    const maxRetries = 3;
    let lastError = '';

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const result = await execFileCommand(
            'gh',
            ['release', 'upload', tagName, artifact.filePath, '--clobber'],
            { cwd: projectPath, env: environment, maxBuffer: 5 * 1024 * 1024 }
        );

        if (!result.error) {
            sendBuildLog(`\n✅ Uploaded ${artifact.name}\n`);
            return { success: true, file: artifact.name };
        }

        lastError = (result.stderr || result.error.message || '').trim();
        sendBuildLog(`\n⚠️ Upload failed for ${artifact.name} (attempt ${attempt}/${maxRetries})\n`);
        if (attempt < maxRetries) await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return { success: false, file: artifact.name, error: lastError || 'Upload failed.' };
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 850,
        minWidth: 1000,
        minHeight: 700,
        backgroundColor: '#050608',
        frame: false,
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#00000000',
            symbolColor: '#ffffff',
            height: 36
        },
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: !isDev
        }
    });

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });
}

app.whenReady().then(createWindow);

// --- PROJECT HANDLERS ---

ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
});

// CHECK GITHUB CLI STATUS
ipcMain.handle('check-gh-status', async () => {
    return getGhStatus();
});

// ENSURE GITHUB CLI (auto install + open auth command)
ipcMain.handle('ensure-gh-ready', async () => {
    const result = {
        installed: false,
        loggedIn: false,
        installAttempted: false,
        installSuccess: false,
        installError: null,
        authOpened: false
    };

    let status = await getGhStatus();
    result.installed = status.installed;
    result.loggedIn = status.loggedIn;

    if (!status.installed) {
        result.installAttempted = true;
        const install = await installGhCliIfMissing();
        if (!install.success) {
            result.installError = install.error;
            return result;
        }

        result.installSuccess = true;
        status = await getGhStatus();
        result.installed = status.installed;
        result.loggedIn = status.loggedIn;

        if (!status.installed) {
            result.installError = 'GitHub CLI installation did not finish successfully.';
            return result;
        }
    }

    if (!status.loggedIn) {
        result.authOpened = openGhAuthTerminal();
    }

    return result;
});

// PROJECT INFO
ipcMain.handle('get-project-info', async (event, projectPath) => {
    let version = null;
    let currentVersion = null;
    let nextVersion = null;
    let suggestedTag = null;
    let suggestedBuildCommand = null;
    let versionSuggestionError = null;
    let resolvedProjectPath = null;

    try {
        resolvedProjectPath = resolveProjectDirectory(projectPath);
        const { pkg } = readProjectPackage(resolvedProjectPath);
        version = typeof pkg.version === 'string' ? pkg.version : null;
        if (version) {
            const parsed = parseStrictVersion(version, 'INVALID_PROJECT_VERSION');
            currentVersion = parsed.packageVersion;
        }
        suggestedBuildCommand = getBuildCommand(resolvedProjectPath, null);
    } catch (error) {
        version = null;
        currentVersion = null;
        nextVersion = null;
        suggestedTag = null;
        suggestedBuildCommand = null;
        versionSuggestionError = error.message;
    }

    if (resolvedProjectPath && currentVersion) {
        try {
            const nextAvailable = await findNextAvailablePatchVersion(
                resolvedProjectPath,
                currentVersion
            );
            nextVersion = nextAvailable.packageVersion;
            suggestedTag = nextAvailable.tagName;
        } catch (error) {
            nextVersion = null;
            suggestedTag = null;
            versionSuggestionError = error.message;
        }
    }

    return {
        version,
        currentVersion,
        nextVersion,
        suggestedTag,
        suggestedBuildCommand,
        versionSuggestionError
    };
});

// GET RELEASES
// GET RELEASES & TAGS
ipcMain.handle('get-releases', async (event, projectPath) => {
    return new Promise((resolve) => {
        const getRepoCmd = 'gh repo view --json url';
        exec(getRepoCmd, { cwd: projectPath, env: baseEnv }, (error, stdout) => {
            if (error) {
                // Αν αποτύχει το gh repo view, δοκιμάζουμε με git remote
                exec('git remote get-url origin', { cwd: projectPath }, (gitError, gitStdout) => {
                    if (gitError) {
                        resolve([]);
                        return;
                    }
                    const repoUrl = gitStdout.trim().replace('.git', '');
                    fetchReleasesAndTags(projectPath, repoUrl, resolve);
                });
                return;
            }

            try {
                const repoInfo = JSON.parse(stdout);
                const repoUrl = repoInfo.url;
                fetchReleasesAndTags(projectPath, repoUrl, resolve);
            } catch (e) {
                console.error('Error parsing repo info:', e);
                resolve([]);
            }
        });
    });
});

function fetchReleasesAndTags(projectPath, repoUrl, resolve) {
    // Πάρε releases
    const releasesCmd = 'gh release list --json tagName,publishedAt,name,isDraft --limit 50';
    exec(releasesCmd, { cwd: projectPath, env: baseEnv }, (releaseError, releaseStdout) => {
        let releases = [];
        let releaseTags = new Set();

        if (!releaseError) {
            try {
                const rawReleases = JSON.parse(releaseStdout);
                releases = rawReleases.map(rel => ({
                    tagName: rel.tagName,
                    publishedAt: rel.publishedAt,
                    url: `${repoUrl}/releases/tag/${rel.tagName}`,
                    title: rel.name || rel.tagName,
                    isDraft: rel.isDraft || false,
                    type: 'release'
                }));
                // Κρατάμε τα tags που έχουν release
                releases.forEach(rel => releaseTags.add(rel.tagName));
            } catch (e) {
                console.error('Error parsing releases:', e);
            }
        }

        // Πάρε όλα τα tags (git tags)
        const tagsCmd = 'git tag --list --sort=-creatordate';
        exec(tagsCmd, { cwd: projectPath }, (tagsError, tagsStdout) => {
            let tagsWithoutReleases = [];

            if (!tagsError && tagsStdout.trim()) {
                const allTags = tagsStdout.trim().split('\n');

                // Φίλτραρε μόνο τα tags που ΔΕΝ έχουν release
                tagsWithoutReleases = allTags
                    .filter(tag => tag && !releaseTags.has(tag))
                    .slice(0, 20) // Περιορισμός για απόδοση
                    .map(tag => ({
                        tagName: tag,
                        publishedAt: null,
                        url: `${repoUrl}/releases/tag/${tag}`,
                        title: tag,
                        isDraft: false,
                        type: 'tag-only' // Διαφορετικός τύπος
                    }));
            }

            // Ενώνουμε releases και tags χωρίς releases
            const allItems = [...releases, ...tagsWithoutReleases]
                .sort((a, b) => {
                    // Ταξινόμηση βάσει ημερομηνίας (αν υπάρχει) ή αλφαβητικά
                    if (a.publishedAt && b.publishedAt) {
                        return new Date(b.publishedAt) - new Date(a.publishedAt);
                    }
                    if (a.publishedAt) return -1;
                    if (b.publishedAt) return 1;
                    return b.tagName.localeCompare(a.tagName);
                });

            resolve(allItems);
        });
    });
}

// CREATE RELEASE WITH BUILD & UPLOAD
ipcMain.handle('create-release', async (event, data = {}) => {
    const jobName = 'create-release';
    let jobAcquired = false;
    let versionSnapshot = null;
    let githubReleaseCreated = false;
    let notesFilePath = null;
    let tagName = null;
    let packageVersion = null;
    let nextVersion = null;
    let packageVersionVerified = false;
    let persistedPackageVersion = null;
    let rolledBack = false;
    let projectPath = null;

    try {
        projectPath = resolveProjectDirectory(data.path);
        const title = typeof data.title === 'string' ? data.title.trim() : '';
        const notes = typeof data.notes === 'string' ? data.notes : '';
        const resolvedBuildCommand = getBuildCommand(projectPath, data.buildCommand);

        if (!title) {
            throw createCodedError('Release title is required.', 'RELEASE_TITLE_REQUIRED');
        }
        if (title.length > 256) {
            throw createCodedError('Release title must be 256 characters or fewer.', 'INVALID_RELEASE_TITLE');
        }
        if (!resolvedBuildCommand) {
            throw createCodedError(
                'No build script found in package.json and no custom command provided.',
                'BUILD_COMMAND_REQUIRED'
            );
        }

        const { pkg } = readProjectPackage(projectPath);
        let targetVersion;
        if (data.versionWasEdited === true) {
            targetVersion = parseStrictVersion(data.version, 'INVALID_VERSION');
        } else {
            const displayedSuggestion = parseStrictVersion(data.version, 'INVALID_VERSION');
            targetVersion = await findNextAvailablePatchVersion(projectPath, pkg.version);
            if (displayedSuggestion.tagName !== targetVersion.tagName) {
                throw createCodedError(
                    `The automatic version changed from ${displayedSuggestion.tagName} to ${targetVersion.tagName}. Refresh and confirm the release again.`,
                    'VERSION_SUGGESTION_STALE'
                );
            }
        }

        tagName = targetVersion.tagName;
        packageVersion = targetVersion.packageVersion;
        nextVersion = bumpPatchVersion(packageVersion);

        acquireMutationJob(jobName);
        jobAcquired = true;
        await ensureReleaseTagAvailable(projectPath, tagName);

        versionSnapshot = updateProjectVersionFiles(projectPath, packageVersion);
        packageVersionVerified = versionSnapshot.verifiedVersion === packageVersion;
        persistedPackageVersion = versionSnapshot.verifiedVersion;
        sendBuildLog(
            `\n🏷️ package.json verified at ${packageVersion} (${tagName})\n` +
            `   ${path.join(projectPath, 'package.json')}\n`
        );
        sendBuildLog('\n🔨 Step 1/3: Building project...\n');

        const tokenResult = await execFileCommand('gh', ['auth', 'token'], {
            maxBuffer: 2 * 1024 * 1024
        });
        const ghToken = tokenResult.error ? null : tokenResult.stdout.trim();
        const releaseEnv = ghToken ? { ...baseEnv, GH_TOKEN: ghToken } : { ...baseEnv };
        const buildEnv = { ...baseEnv };
        delete buildEnv.GH_TOKEN;
        delete buildEnv.GITHUB_TOKEN;

        if (ghToken) {
            sendBuildLog('\n🔑 GH_TOKEN loaded from GitHub CLI\n');
        } else {
            sendBuildLog('\n⚠️ GitHub CLI token was not available; authenticated release commands may fail.\n');
        }

        const artifactSnapshot = snapshotReleaseArtifacts(projectPath);
        const buildResult = await runStreamingBuild(resolvedBuildCommand, {
            cwd: projectPath,
            env: buildEnv
        });

        if (buildResult.error || buildResult.code !== 0) {
            throw createCodedError(
                buildResult.error?.message || `Build failed with exit code ${buildResult.code}.`,
                'BUILD_FAILED'
            );
        }

        persistedPackageVersion = assertPersistedProjectVersion(
            projectPath,
            packageVersion
        ).packageVersion;
        packageVersionVerified = true;

        sendBuildLog('\n✅ Build completed successfully!\n');
        const artifacts = collectFreshArtifacts(projectPath, artifactSnapshot);
        sendBuildLog(
            `\nFound ${artifacts.length} fresh release artifact(s):\n${artifacts.map(item => `  - ${item.name}`).join('\n')}\n`
        );

        notesFilePath = path.join(
            os.tmpdir(),
            `release-notes-${process.pid}-${Date.now()}.md`
        );
        fs.writeFileSync(notesFilePath, notes, 'utf-8');

        sendBuildLog(`\n🚀 Step 2/3: Creating GitHub release ${tagName}...\n`);
        let createResult = await execFileCommand(
            'gh',
            ['release', 'create', tagName, '--title', title, '--notes-file', notesFilePath],
            { cwd: projectPath, env: releaseEnv, maxBuffer: 10 * 1024 * 1024 }
        );

        if (createResult.error) {
            // A custom electron-builder command may have auto-published the tag.
            // If so, update that release rather than creating a duplicate.
            const releasePresence = await getReleasePresence(projectPath, tagName);
            if (releasePresence.verified && releasePresence.exists) {
                githubReleaseCreated = true;
                const editResult = await execFileCommand(
                    'gh',
                    ['release', 'edit', tagName, '--title', title, '--notes-file', notesFilePath],
                    { cwd: projectPath, env: releaseEnv, maxBuffer: 10 * 1024 * 1024 }
                );
                if (editResult.error) {
                    throw createCodedError(
                        (editResult.stderr || editResult.error.message || 'Could not update release notes.').trim(),
                        'RELEASE_METADATA_UPDATE_FAILED'
                    );
                }
                createResult = editResult;
                sendBuildLog('\n✅ Existing builder-created release updated successfully!\n');
            } else {
                throw createCodedError(
                    (createResult.stderr || createResult.error.message || 'Failed to create release.').trim(),
                    'CREATE_RELEASE_FAILED'
                );
            }
        } else {
            githubReleaseCreated = true;
            sendBuildLog('\n✅ Release created successfully!\n');
        }

        sendBuildLog('\n📦 Step 3/3: Uploading build artifacts...\n');
        const settledUploads = await Promise.allSettled(
            artifacts.map(artifact => uploadReleaseArtifact(
                projectPath,
                tagName,
                artifact,
                releaseEnv
            ))
        );

        const uploadResults = settledUploads.map((result, index) => {
            if (result.status === 'fulfilled') return result.value;
            return {
                success: false,
                file: artifacts[index].name,
                error: result.reason?.message || 'Unexpected upload failure.'
            };
        });
        const failedUploads = uploadResults.filter(result => !result.success);
        const success = failedUploads.length === 0;
        const partialSuccess = !success && githubReleaseCreated;

        persistedPackageVersion = assertPersistedProjectVersion(
            projectPath,
            packageVersion
        ).packageVersion;
        packageVersionVerified = true;

        if (success) {
            sendBuildLog('\n🎉 All artifacts uploaded successfully!\n');
        } else {
            sendBuildLog(
                `\n⚠️ Some uploads failed:\n${failedUploads.map(item => `${item.file}: ${item.error}`).join('\n')}\n`
            );
        }

        return {
            success,
            partialSuccess,
            releaseCreated: githubReleaseCreated,
            output: createResult.stdout,
            version: tagName,
            tagName,
            previousPackageVersion: versionSnapshot.previousPackageVersion,
            targetPackageVersion: packageVersion,
            packageVersion,
            persistedPackageVersion,
            packageVersionVerified,
            rolledBack: false,
            nextVersion,
            suggestedTag: `v${nextVersion}`,
            nextVersionTag: `v${nextVersion}`,
            artifacts: uploadResults,
            error: success ? null : 'The release was created, but one or more artifacts failed to upload.',
            code: success ? null : 'ARTIFACT_UPLOAD_FAILED'
        };
    } catch (error) {
        let rollbackError = null;
        let rollbackCompleted = false;
        let externalMutationDetected = githubReleaseCreated;
        let externalStateUnverified = false;

        if (versionSnapshot && !githubReleaseCreated) {
            const mutationProjectPath = path.dirname(versionSnapshot.packagePath);
            const [releasePresence, localTagPresence, remoteTagPresence] = await Promise.all([
                getReleasePresence(mutationProjectPath, tagName),
                getLocalTagPresence(mutationProjectPath, tagName),
                getRemoteTagPresence(mutationProjectPath, tagName)
            ]);
            externalStateUnverified = !releasePresence.verified ||
                !localTagPresence.verified ||
                !remoteTagPresence.verified;
            githubReleaseCreated = releasePresence.verified && releasePresence.exists === true;
            externalMutationDetected = githubReleaseCreated ||
                (localTagPresence.verified && localTagPresence.exists === true) ||
                (remoteTagPresence.verified && remoteTagPresence.exists === true);
        }

        if (versionSnapshot && !externalMutationDetected && !externalStateUnverified) {
            try {
                rollbackProjectVersionFiles(versionSnapshot);
                rollbackCompleted = true;
                rolledBack = true;
                sendBuildLog('\n↩️ Restored the previous package version because the release was not created.\n');
            } catch (restoreError) {
                rollbackError = restoreError.message;
            }
        }

        const stateWarning = externalStateUnverified
            ? '\nRemote release state could not be fully verified, so the package version was preserved.'
            : '';
        const message = rollbackError
            ? `${error.message}\nVersion rollback also failed: ${rollbackError}`
            : `${error.message}${stateWarning}`;
        sendBuildLog(`\n❌ ${message}\n`);

        try {
            if (projectPath) {
                persistedPackageVersion = readPersistedVersionState(projectPath).packageVersion;
            }
        } catch {
            persistedPackageVersion = null;
        }
        packageVersionVerified = !rolledBack && persistedPackageVersion === packageVersion;

        return {
            success: false,
            partialSuccess: githubReleaseCreated || externalMutationDetected || externalStateUnverified || Boolean(rollbackError),
            releaseCreated: githubReleaseCreated,
            externalStateUnverified,
            error: message,
            code: getErrorCode(error, 'CREATE_RELEASE_FAILED'),
            version: tagName,
            tagName,
            previousPackageVersion: versionSnapshot?.previousPackageVersion || null,
            targetPackageVersion: packageVersion,
            packageVersion: rollbackCompleted ? versionSnapshot.previousPackageVersion : packageVersion,
            persistedPackageVersion,
            packageVersionVerified: rollbackCompleted ? false : packageVersionVerified,
            rolledBack,
            nextVersion: rollbackCompleted ? packageVersion : nextVersion,
            suggestedTag: rollbackCompleted ? tagName : (nextVersion ? `v${nextVersion}` : null),
            nextVersionTag: rollbackCompleted ? tagName : (nextVersion ? `v${nextVersion}` : null),
            artifacts: []
        };
    } finally {
        if (notesFilePath) {
            try {
                fs.unlinkSync(notesFilePath);
            } catch {
                // Temporary release-note cleanup is best effort.
            }
        }
        if (jobAcquired) releaseMutationJob(jobName);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('build-complete');
        }
    }
});

// DELETE ONE RELEASE + ITS REMOTE/LOCAL TAG
ipcMain.handle('delete-release', async (event, data = {}) => {
    const jobName = 'delete-release';
    let jobAcquired = false;

    try {
        const projectPath = resolveProjectDirectory(data.path);
        const tagName = normalizeTagNames([data.tagName])[0];
        await validateTagName(projectPath, tagName);
        acquireMutationJob(jobName);
        jobAcquired = true;

        const result = await deleteReleaseAndTag(projectPath, tagName);
        return {
            ...result,
            message: result.success
                ? `Successfully deleted ${tagName} from GitHub and the local repository.`
                : undefined,
            code: result.success ? null : 'DELETE_RELEASE_FAILED'
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            code: getErrorCode(error, 'DELETE_RELEASE_FAILED')
        };
    } finally {
        if (jobAcquired) releaseMutationJob(jobName);
    }
});

// DELETE MULTIPLE RELEASES SEQUENTIALLY TO AVOID CONCURRENT GIT REF UPDATES
ipcMain.handle('bulk-delete-releases', async (event, data = {}) => {
    const jobName = 'bulk-delete-releases';
    let jobAcquired = false;

    try {
        const projectPath = resolveProjectDirectory(data.path);
        const tagNames = normalizeTagNames(data.tagNames);
        for (const tagName of tagNames) await validateTagName(projectPath, tagName);

        acquireMutationJob(jobName);
        jobAcquired = true;

        const results = [];
        for (const tagName of tagNames) {
            try {
                results.push(await deleteReleaseAndTag(projectPath, tagName));
            } catch (error) {
                results.push({
                    tagName,
                    success: false,
                    releaseDeleted: false,
                    localTagDeleted: false,
                    remoteTagDeleted: false,
                    error: error.message,
                    code: getErrorCode(error, 'DELETE_RELEASE_FAILED')
                });
            }
        }

        const succeeded = results.filter(result => result.success).length;
        return {
            success: succeeded === results.length,
            partialSuccess: succeeded > 0 && succeeded < results.length,
            deletedCount: succeeded,
            failedCount: results.length - succeeded,
            results,
            code: succeeded === results.length ? null : 'BULK_DELETE_PARTIAL_FAILURE'
        };
    } catch (error) {
        return {
            success: false,
            partialSuccess: false,
            deletedCount: 0,
            failedCount: 0,
            results: [],
            error: error.message,
            code: getErrorCode(error, 'BULK_DELETE_FAILED')
        };
    } finally {
        if (jobAcquired) releaseMutationJob(jobName);
    }
});

// --- AI HANDLERS ---

ipcMain.handle('get-api-key', async () => {
    const config = readConfig();
    return config.deepseekApiKey || null;
});

ipcMain.handle('save-api-key', async (event, apiKey) => {
    const ok = writeConfig({ deepseekApiKey: apiKey });
    return { success: ok };
});

ipcMain.handle('format-with-ai', async (event, { text, apiKey }) => {
    try {
        const systemPrompt = [
            'You are a GitHub release notes formatter. Format user input into clean, professional GitHub release notes using Markdown.',
            'Rules:',
            "- Use ## for main sections (e.g. ## What's New, ## Bug Fixes, ## Improvements)",
            '- Use bullet points with - for each item',
            '- Add relevant emojis to bullet points',
            '- Keep it concise and clear',
            '- Use GitHub-flavored markdown',
            '- Return a JSON object with exactly two fields: "title" (a short, professional release title, max 6 words, no version number, no quotes) and "notes" (the formatted markdown)',
            '- Return ONLY the raw JSON object, no markdown fences, no extra text'
        ].join('\n');

        const aiResult = await callDeepseek({
            apiKey,
            systemPrompt,
            userPrompt: truncateText(text, 8000),
            maxOutputTokens: 900
        });

        return {
            success: true,
            result: aiResult.notes,
            title: aiResult.title,
            model: aiResult.model,
            usage: aiResult.usage
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('aggregate-release-notes', async (event, data = {}) => {
    const { path: projectPath, tagNames, apiKey } = data;

    try {
        const resolvedProjectPath = resolveProjectDirectory(projectPath);
        const normalizedTags = normalizeTagNames(tagNames);
        const resolvedApiKey = apiKey || readConfig().deepseekApiKey;

        if (!resolvedApiKey) {
            throw createCodedError(
                'Save your DeepSeek API key before aggregating releases.',
                'API_KEY_REQUIRED'
            );
        }

        const aggregateContext = await buildAggregateReleaseContext(
            resolvedProjectPath,
            normalizedTags
        );
        const systemPrompt = [
            'You are an expert GitHub release manager.',
            'Aggregate the supplied historical releases and deduplicated commit descriptions into one new release.',
            'Rules:',
            '- Preserve every distinct user-facing change, fix, security update, and tooling improvement.',
            '- Deduplicate repeated descriptions and organize them under concise ## headings.',
            '- Do not mention that releases were merged or deleted.',
            '- Do not invent information absent from the supplied context.',
            '- Return strict JSON: {"title":"...","notes":"..."}'
        ].join('\n');

        const aiResult = await callDeepseek({
            apiKey: resolvedApiKey,
            systemPrompt,
            userPrompt: [
                `Create one aggregate release from these tags: ${normalizedTags.join(', ')}`,
                '',
                aggregateContext
            ].join('\n'),
            maxOutputTokens: 1800
        });

        return {
            success: true,
            title: aiResult.title,
            notes: aiResult.notes,
            result: aiResult.notes,
            sources: normalizedTags,
            model: aiResult.model,
            usage: aiResult.usage,
            code: null
        };
    } catch (error) {
        return {
            success: false,
            title: '',
            notes: '',
            result: '',
            sources: [],
            error: error.message,
            code: getErrorCode(error, 'AGGREGATE_RELEASES_FAILED')
        };
    }
});

ipcMain.handle('get-commits', async (event, projectPath) => {
    if (!projectPath) {
        return {
            success: false,
            error: 'Project path is required.',
            code: 'PROJECT_PATH_REQUIRED',
            commits: [],
            headHash: null
        };
    }
    try {
        const resolvedProjectPath = resolveProjectDirectory(projectPath);
        const commits = await getCommitList(resolvedProjectPath);
        return { success: true, commits, headHash: commits[0]?.hash || null, code: null };
    } catch (err) {
        return {
            success: false,
            error: err.message,
            code: getErrorCode(err, 'COMMIT_HISTORY_FAILED'),
            commits: [],
            headHash: null
        };
    }
});

ipcMain.handle('generate-release-from-diff', async (event, data = {}) => {
    const { path: projectPath, apiKey, fromHash, toHash } = data;
    if (!projectPath) {
        return {
            success: false,
            title: '',
            notes: '',
            result: '',
            error: 'Project path is required.',
            code: 'PROJECT_PATH_REQUIRED'
        };
    }

    const resolvedApiKey = apiKey || readConfig().deepseekApiKey;
    if (!resolvedApiKey) {
        return {
            success: false,
            title: '',
            notes: '',
            result: '',
            error: 'API key is required.',
            code: 'API_KEY_REQUIRED'
        };
    }

    try {
        const resolvedProjectPath = resolveProjectDirectory(projectPath);
        if ((fromHash && !toHash) || (!fromHash && toHash)) {
            throw createCodedError('Select both "From" and "To" commits.', 'INVALID_COMMIT_RANGE');
        }
        const useRange = fromHash && toHash;

        const systemPrompt = [
            'You are an expert release manager.',
            'Generate clean and accurate GitHub release notes from git changes.',
            'Rules:',
            '- Use ## headings and concise bullet points.',
            '- Focus on user-facing changes, bug fixes, performance, security, and tooling.',
            '- Mention breaking changes only when clearly implied.',
            '- Do not invent changes not present in git output.',
            '- Return strict JSON: {"title":"...","notes":"..."}'
        ].join('\n');

        let userPrompt;
        let source;

        if (useRange) {
            // Commit range mode
            const rangeData = await collectGitChangesFromRange(resolvedProjectPath, fromHash, toHash);
            source = 'range';
            userPrompt = [
                `Create release notes and a short title from the git changes between commits ${rangeData.fromHash.substring(0, 7)} and ${rangeData.toHash.substring(0, 7)}.`,
                '',
                'Commits in range:',
                rangeData.commitMessages || 'No commits',
                '',
                'Changed Files:',
                rangeData.filesChanged || 'No changed files',
                '',
                'Diff Summary:',
                rangeData.diffStat || 'No diff stats',
                '',
                'Code Diff:',
                rangeData.diff || 'Diff too large or unavailable'
            ].join('\n');
        } else {
            const gitChanges = await collectGitChanges(resolvedProjectPath);
            source = gitChanges.source;

            if (gitChanges.source === 'head') {
                userPrompt = [
                    'Create release notes and a short title from the latest HEAD commit shown below.',
                    'The working tree is clean. Summarize only this commit and do not infer changes from older versions.',
                    '',
                    'HEAD Commit:',
                    gitChanges.headDiff
                ].join('\n');
            } else {
                userPrompt = [
                    'Create release notes and a short title from the current uncommitted git changes below.',
                    '',
                    'Git Status:',
                    gitChanges.statusText,
                    '',
                    'Changed Files:',
                    gitChanges.filesChanged || 'No changed files',
                    '',
                    'Staged Diff:',
                    gitChanges.stagedDiff || 'No staged diff',
                    '',
                    'Unstaged Diff:',
                    gitChanges.unstagedDiff || 'No unstaged diff'
                ].join('\n');
            }
        }

        const aiResult = await callDeepseek({
            apiKey: resolvedApiKey,
            systemPrompt,
            userPrompt: truncateText(userPrompt, MAX_AI_CONTEXT_LENGTH),
            maxOutputTokens: DEFAULT_AI_OUTPUT_TOKENS
        });

        return {
            success: true,
            result: aiResult.notes,
            notes: aiResult.notes,
            title: aiResult.title,
            source,
            model: aiResult.model,
            usage: aiResult.usage,
            code: null
        };
    } catch (err) {
        return {
            success: false,
            title: '',
            notes: '',
            result: '',
            error: err.message,
            code: getErrorCode(err, 'GENERATE_RELEASE_NOTES_FAILED')
        };
    }
});

// TRIGGER BUILD
ipcMain.handle('trigger-build', (event, data = {}) => {
    const jobName = 'trigger-build';
    let projectPath;
    let resolvedBuildCommand;

    try {
        projectPath = resolveProjectDirectory(data.path);
        resolvedBuildCommand = getBuildCommand(projectPath, data.command);
        if (!resolvedBuildCommand) {
            throw createCodedError(
                'No build script found (looking for "build-all", "release", or "build") and no custom command was provided.',
                'BUILD_COMMAND_REQUIRED'
            );
        }
        acquireMutationJob(jobName);
    } catch (error) {
        sendBuildLog(`\n❌ ${error.message}\n`);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('build-complete');
        return { success: false, error: error.message, code: getErrorCode(error, 'BUILD_FAILED') };
    }

    sendBuildLog(`\n🚀 Starting ${resolvedBuildCommand} in: ${projectPath}...\n`);
    let buildProcess;
    try {
        buildProcess = exec(resolvedBuildCommand, {
            cwd: projectPath,
            env: baseEnv,
            maxBuffer: 50 * 1024 * 1024
        });
    } catch (error) {
        releaseMutationJob(jobName);
        sendBuildLog(`\n❌ Could not start build: ${error.message}\n`);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('build-complete');
        return { success: false, error: error.message, code: 'BUILD_START_FAILED' };
    }

    let processError = null;
    buildProcess.stdout?.on('data', data => sendBuildLog(data));
    buildProcess.stderr?.on('data', data => sendBuildLog(`[MSG] ${data}`));
    buildProcess.on('error', error => {
        processError = error;
    });
    buildProcess.on('close', async (code) => {
        let msg;

        if (code === 0 && !processError) {
            msg = '\n✅ Build Completed Successfully!';

            const distPath = path.join(projectPath, 'dist');
            const releasePath = path.join(projectPath, 'release');
            let openedPath = null;

            if (fs.existsSync(releasePath)) {
                openedPath = releasePath;
            } else if (fs.existsSync(distPath)) {
                openedPath = distPath;
            }

            if (openedPath) {
                try {
                    const openResult = await shell.openPath(openedPath);
                    if (openResult) {
                        msg += `\n⚠️ Could not open output folder: ${openResult}`;
                    } else {
                        msg += `\n📂 Opened output folder: ${path.basename(openedPath)}`;
                    }
                } catch (err) {
                    msg += `\n⚠️ Could not open output folder: ${err.message}`;
                }
            }
        } else {
            msg = `\n❌ Build Failed${processError ? `: ${processError.message}` : ` (Code ${code})`}`;
        }

        sendBuildLog(msg);
        releaseMutationJob(jobName);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('build-complete');
    });

    return { success: true, started: true, code: null };
});
