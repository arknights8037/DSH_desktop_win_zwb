const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const DEFAULT_FLOW = Object.freeze({
  production: 'main',
  develop: 'develop',
  prefixes: Object.freeze({ feature: 'feature/', release: 'release/', hotfix: 'hotfix/', support: 'support/', versionTag: '' })
});

function asErrorMessage(reason) {
  return reason instanceof Error ? reason.message : String(reason);
}

function redactRemoteUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    }
  } catch {
    const scp = /^([^/@:\s]+)@([^/:\\\s]+):(.*)$/.exec(value);
    if (scp) return `${scp[2]}:${scp[3]}`;
  }
  return value.replace(/^(https?:\/\/)[^/@\s]+@/i, '$1');
}

function validateRef(value, label = 'branch') {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240 || value.startsWith('-') || /[\x00-\x20~^:?*[\\]/.test(value) || value.includes('..') || value.includes('@{') || value.endsWith('/') || value.endsWith('.') || value.includes('//')) {
    throw new Error(`Invalid ${label} name`);
  }
  return value;
}

function validateRemote(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw new Error('Invalid remote name');
  return value;
}

function validateUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || /[\r\n\0]/.test(value) || value.startsWith('-')) throw new Error('Invalid remote URL');
  return value;
}

function parseTrack(value) {
  const ahead = /ahead (\d+)/.exec(value)?.[1];
  const behind = /behind (\d+)/.exec(value)?.[1];
  return { ahead: Number(ahead ?? 0), behind: Number(behind ?? 0) };
}

function classifyBranch(name, flow) {
  if (name === flow.production) return 'production';
  if (name === flow.develop) return 'develop';
  for (const kind of ['feature', 'release', 'hotfix', 'support']) {
    if (name.startsWith(flow.prefixes[kind])) return kind;
  }
  return 'other';
}

async function optionalRaw(git, args) {
  try { return await git.raw(args); } catch { return ''; }
}

async function gitExecutablePath() {
  try {
    const command = process.platform === 'win32' ? 'where.exe' : 'which';
    const { stdout } = await execFileAsync(command, ['git'], { timeout: 5_000, windowsHide: true });
    return stdout.split(/\r?\n/).map(value => value.trim()).find(Boolean) ?? null;
  } catch { return null; }
}

async function readGitEnvironment(git, isRepo) {
  const version = (await git.raw(['--version'])).trim().replace(/^git version\s+/i, '');
  const read = async (scope, key) => (await optionalRaw(git, ['config', scope, '--get', key])).trim() || null;
  const localName = isRepo ? await read('--local', 'user.name') : null;
  const localEmail = isRepo ? await read('--local', 'user.email') : null;
  const globalName = await read('--global', 'user.name');
  const globalEmail = await read('--global', 'user.email');
  const credentialHelpers = (await optionalRaw(git, ['config', '--get-all', 'credential.helper']))
    .split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  return {
    available: true,
    version,
    executablePath: await gitExecutablePath(),
    userName: localName ?? globalName,
    userEmail: localEmail ?? globalEmail,
    identityScope: localName || localEmail ? 'local' : globalName || globalEmail ? 'global' : 'unset',
    defaultBranch: await read('--global', 'init.defaultBranch'),
    pullFastForward: (isRepo ? await read('--local', 'pull.ff') : null) ?? await read('--global', 'pull.ff'),
    autoCrlf: (isRepo ? await read('--local', 'core.autocrlf') : null) ?? await read('--global', 'core.autocrlf'),
    credentialHelpers
  };
}

function emptySnapshot(workspacePath, repositoryState, environment) {
  return {
    workspacePath, repositoryState, root: null, head: null, currentBranch: null, detached: false,
    dirty: false, files: [], conflicts: [], flow: { initialized: false, ...DEFAULT_FLOW },
    branches: [], remotes: [], commits: [], environment
  };
}

async function readFlow(git, currentBranch, localBranches) {
  const output = await optionalRaw(git, ['config', '--local', '--get-regexp', '^gitflow\.']);
  const config = new Map(output.split(/\r?\n/).filter(Boolean).map(line => {
    const split = line.indexOf(' ');
    return split < 0 ? [line, ''] : [line.slice(0, split), line.slice(split + 1)];
  }));
  const production = config.get('gitflow.branch.master') || (localBranches.includes('main') ? 'main' : localBranches.includes('master') ? 'master' : currentBranch || 'main');
  const develop = config.get('gitflow.branch.develop') || 'develop';
  const prefixes = {
    feature: config.get('gitflow.prefix.feature') ?? 'feature/',
    release: config.get('gitflow.prefix.release') ?? 'release/',
    hotfix: config.get('gitflow.prefix.hotfix') ?? 'hotfix/',
    support: config.get('gitflow.prefix.support') ?? 'support/',
    versionTag: config.get('gitflow.prefix.versiontag') ?? ''
  };
  return { initialized: config.has('gitflow.branch.master') && config.has('gitflow.branch.develop'), production, develop, prefixes };
}

async function inspectRepository(git, workspacePath) {
  const isRepo = await git.checkIsRepo();
  const environment = await readGitEnvironment(git, isRepo);
  if (!isRepo) return emptySnapshot(workspacePath, 'not-repository', environment);

  const root = (await git.revparse(['--show-toplevel'])).trim();
  const status = await git.status();
  const head = (await optionalRaw(git, ['rev-parse', '--verify', 'HEAD'])).trim() || null;
  const merging = (await optionalRaw(git, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).trim().length > 0;
  const refs = await git.raw(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(committerdate:iso-strict)%00%(subject)', 'refs/heads', 'refs/remotes']);
  const rawBranches = refs.split(/\r?\n/).filter(Boolean).map(line => {
    const [ref, hash, upstream, track, date, subject] = line.split('\0');
    const remote = ref.startsWith('refs/remotes/');
    const name = ref.replace(remote ? 'refs/remotes/' : 'refs/heads/', '');
    return { name, fullRef: ref, remote, hash, upstream: upstream || null, ...parseTrack(track || ''), date, subject };
  }).filter(branch => !branch.remote || !branch.name.endsWith('/HEAD'));
  const localBranches = rawBranches.filter(branch => !branch.remote).map(branch => branch.name);
  const currentBranch = status.detached ? null : status.current;
  const flow = await readFlow(git, currentBranch, localBranches);
  const branches = rawBranches.map(branch => ({ ...branch, kind: classifyBranch(branch.remote ? branch.name.slice(branch.name.indexOf('/') + 1) : branch.name, flow), current: !branch.remote && branch.name === status.current }));
  const remotes = (await git.getRemotes(true)).map(remote => ({ name: remote.name, fetchUrl: redactRemoteUrl(remote.refs.fetch), pushUrl: redactRemoteUrl(remote.refs.push) }));
  const log = await optionalRaw(git, ['log', '--all', '--topo-order', '--max-count=200', '--date=iso-strict', '--pretty=format:%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1e']);
  const commits = log.split('\x1e').map(row => row.trim()).filter(Boolean).map(row => {
    const [hash, parents, author, date, subject] = row.split('\x1f');
    return { hash, parents: parents ? parents.split(' ') : [], author, date, subject };
  });
  const files = status.files.map(file => ({ path: file.path, from: file.from, index: file.index, workingDir: file.working_dir }));
  const conflicts = status.conflicted ?? [];
  return {
    workspacePath,
    repositoryState: conflicts.length > 0 || merging ? 'conflict' : head === null ? 'unborn' : 'ready',
    root,
    head,
    currentBranch,
    detached: status.detached,
    dirty: !status.isClean(),
    files,
    conflicts,
    ahead: status.ahead,
    behind: status.behind,
    tracking: status.tracking ?? null,
    flow,
    branches,
    remotes,
    commits,
    environment
  };
}

function validateConfigText(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 320 || /[\r\n\0]/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

async function configureGit(git, operation) {
  if (!['local', 'global'].includes(operation.scope)) throw new Error('Invalid Git configuration scope');
  if (!operation.values || typeof operation.values !== 'object') throw new Error('Invalid Git configuration');
  if (operation.scope === 'local' && !await git.checkIsRepo()) throw new Error('Local Git configuration requires a repository');
  const flag = operation.scope === 'local' ? '--local' : '--global';
  const entries = [];
  if (operation.values.userName !== undefined) entries.push(['user.name', validateConfigText(operation.values.userName, 'user name')]);
  if (operation.values.userEmail !== undefined) entries.push(['user.email', validateConfigText(operation.values.userEmail, 'user email')]);
  if (operation.values.defaultBranch !== undefined) {
    if (operation.scope !== 'global') throw new Error('Default branch can only be configured globally');
    entries.push(['init.defaultBranch', validateRef(operation.values.defaultBranch, 'default branch')]);
  }
  if (operation.values.pullFastForward !== undefined) {
    if (operation.values.pullFastForward !== 'only') throw new Error('Only fast-forward-only pull policy is supported');
    entries.push(['pull.ff', 'only']);
  }
  if (operation.values.autoCrlf !== undefined) {
    if (!['true', 'false', 'input'].includes(operation.values.autoCrlf)) throw new Error('Invalid autocrlf policy');
    entries.push(['core.autocrlf', operation.values.autoCrlf]);
  }
  if (operation.values.credentialHelper !== undefined) {
    if (operation.scope !== 'global') throw new Error('Credential helper can only be configured globally');
    if (!['manager', 'manager-core', 'wincred'].includes(operation.values.credentialHelper)) throw new Error('Unsupported credential helper');
    entries.push(['credential.helper', operation.values.credentialHelper]);
  }
  if (entries.length === 0) throw new Error('No Git configuration values were provided');
  for (const [key, value] of entries) await git.raw(['config', flag, key, value]);
}

async function requireClean(git) {
  const status = await git.status();
  if (!status.isClean()) throw new Error('Working tree must be clean');
  if ((status.conflicted ?? []).length > 0) throw new Error('Resolve or abort the current merge first');
}

async function branchExists(git, branch) {
  return (await optionalRaw(git, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])) !== '' || (await optionalRaw(git, ['rev-parse', '--verify', `refs/heads/${branch}`])).trim() !== '';
}

async function isAncestor(git, ancestor, descendant) {
  const count = (await git.raw(['rev-list', '--count', `${descendant}..${ancestor}`])).trim();
  return count === '0';
}

async function executeFinish(git, operation, flow) {
  await requireClean(git);
  const prefix = flow.prefixes[operation.kind];
  const topic = validateRef(`${prefix}${operation.name}`, 'GitFlow branch');
  if (!await branchExists(git, topic)) throw new Error(`Branch does not exist: ${topic}`);
  const mergeInto = async (target) => {
    if (!await branchExists(git, target)) throw new Error(`Branch does not exist: ${target}`);
    await git.checkout(target);
    if (!await isAncestor(git, topic, target)) await git.merge(['--no-ff', '--no-edit', topic]);
  };
  if (operation.kind === 'feature') {
    await mergeInto(flow.develop);
  } else {
    const tag = validateRef(`${flow.prefixes.versionTag}${operation.tag}`, 'tag');
    await mergeInto(flow.production);
    const productionHead = (await git.revparse(['HEAD'])).trim();
    const tagHead = (await optionalRaw(git, ['rev-list', '-n', '1', tag])).trim();
    if (tagHead && tagHead !== productionHead) throw new Error(`Tag already points to another commit: ${tag}`);
    if (!tagHead) await git.addAnnotatedTag(tag, `Finish ${operation.kind} ${operation.name}`);
    await mergeInto(flow.develop);
  }
  if (await branchExists(git, topic)) await git.deleteLocalBranch(topic, true);
}

async function applyOperation(git, operation) {
  if (!operation || typeof operation.type !== 'string') throw new Error('Invalid Git operation');
  if (operation.type === 'configureGit') {
    await configureGit(git, operation);
    return;
  }
  if (operation.type === 'initRepository') {
    const initialBranch = validateRef(operation.initialBranch || 'main', 'initial branch');
    await git.raw(['init', `--initial-branch=${initialBranch}`]);
    return;
  }
  if (!await git.checkIsRepo()) throw new Error('Workspace is not a Git repository');
  const status = await git.status();
  const localBranches = (await git.branchLocal()).all;
  const flow = await readFlow(git, status.current, localBranches);
  switch (operation.type) {
    case 'stage':
    case 'unstage': {
      if (!Array.isArray(operation.paths) || !operation.paths.length || operation.paths.length > 1000) throw new Error('Select 1–1000 files');
      const paths = operation.paths.map(literalFile);
      const root = (await git.revparse(['--show-toplevel'])).trim();
      if (operation.type === 'stage') await git.raw(['-C', root, 'add', '--', ...paths]);
      else {
        const head = (await optionalRaw(git, ['rev-parse', '--verify', 'HEAD'])).trim();
        await git.raw(['-C', root, ...(head ? ['reset', 'HEAD'] : ['rm', '--cached', '-f']), '--', ...paths]);
      }
      return;
    }
    case 'commit': {
      if (typeof operation.message !== 'string' || !operation.message.trim() || operation.message.length > 10000 || operation.message.includes('\0')) throw new Error('Enter a commit message');
      if (status.detached || status.current !== validateRef(operation.branch)) throw new Error('Current branch changed; refresh before committing');
      if (status.conflicted.length) throw new Error('Resolve conflicts before committing');
      if (!(await git.raw(['diff', '--cached', '--name-only'])).trim()) throw new Error('Stage files before committing');
      await git.raw(['commit', '-m', operation.message]);
      return;
    }
    case 'createBranch': {
      await git.raw(['switch', '-c', validateRef(operation.branch)]);
      return;
    }
    case 'configureFlow': {
      await requireClean(git);
      const next = operation.config;
      validateRef(next.production, 'production branch');
      validateRef(next.develop, 'develop branch');
      for (const kind of ['feature', 'release', 'hotfix', 'support']) validateRef(`${next.prefixes[kind]}probe`, `${kind} prefix`);
      if (typeof next.prefixes.versionTag !== 'string' || next.prefixes.versionTag.startsWith('-') || /[\r\n\0]/.test(next.prefixes.versionTag)) throw new Error('Invalid version tag prefix');
      if (!await branchExists(git, next.production)) throw new Error(`Branch does not exist: ${next.production}`);
      if (!await branchExists(git, next.develop)) await git.branch([next.develop, next.production]);
      const entries = {
        'gitflow.branch.master': next.production, 'gitflow.branch.develop': next.develop,
        'gitflow.prefix.feature': next.prefixes.feature, 'gitflow.prefix.release': next.prefixes.release,
        'gitflow.prefix.hotfix': next.prefixes.hotfix, 'gitflow.prefix.support': next.prefixes.support,
        'gitflow.prefix.versiontag': next.prefixes.versionTag
      };
      for (const [key, value] of Object.entries(entries)) await git.addConfig(key, value, false, 'local');
      return;
    }
    case 'checkout': await git.raw(['switch', validateRef(operation.branch)]); return;
    case 'startFlowBranch': {
      await requireClean(git);
      if (!['feature', 'release', 'hotfix'].includes(operation.kind)) throw new Error('Invalid GitFlow branch kind');
      const base = operation.kind === 'hotfix' ? flow.production : flow.develop;
      const branch = validateRef(`${flow.prefixes[operation.kind]}${operation.name}`, 'GitFlow branch');
      await git.checkoutBranch(branch, base);
      return;
    }
    case 'finishFlowBranch': {
      if (!['feature', 'release', 'hotfix'].includes(operation.kind)) throw new Error('Invalid GitFlow branch kind');
      if (operation.kind !== 'feature' && (typeof operation.tag !== 'string' || operation.tag.length === 0)) throw new Error('A release or hotfix tag is required');
      await executeFinish(git, operation, flow);
      return;
    }
    case 'abortMerge': await git.raw(['merge', '--abort']); return;
    case 'fetch': {
      if (operation.remote) await git.raw(['fetch', validateRemote(operation.remote), '--prune']);
      else await git.raw(['fetch', '--all', '--prune']);
      return;
    }
    case 'pullFastForward': {
      await requireClean(git);
      const args = ['pull', '--ff-only'];
      if (operation.remote) args.push(validateRemote(operation.remote));
      if (operation.branch) args.push(validateRef(operation.branch));
      await git.raw(args);
      return;
    }
    case 'push': {
      const args = ['push', validateRemote(operation.remote)];
      if (operation.branch) args.push(operation.remoteBranch ? `refs/heads/${validateRef(operation.branch)}:refs/heads/${validateRef(operation.remoteBranch)}` : validateRef(operation.branch));
      await git.raw(args);
      return;
    }
    case 'publish': {
      const branch = validateRef(operation.branch);
      await git.raw(['push', '--set-upstream', validateRemote(operation.remote), branch]);
      return;
    }
    case 'setUpstream': {
      const localBranch = validateRef(operation.localBranch, 'local branch');
      const remote = validateRemote(operation.remote);
      const branch = validateRef(operation.branch, 'remote branch');
      if (!await branchExists(git, localBranch)) throw new Error(`Branch does not exist: ${localBranch}`);
      await git.raw(['branch', `--set-upstream-to=${remote}/${branch}`, localBranch]);
      return;
    }
    case 'unsetUpstream': {
      const localBranch = validateRef(operation.localBranch, 'local branch');
      if (!await branchExists(git, localBranch)) throw new Error(`Branch does not exist: ${localBranch}`);
      await git.raw(['branch', '--unset-upstream', localBranch]);
      return;
    }
    case 'track': {
      await requireClean(git);
      const remote = validateRemote(operation.remote);
      const branch = validateRef(operation.branch);
      const localBranch = validateRef(operation.localBranch || branch);
      await git.raw(['checkout', '--track', '-b', localBranch, `${remote}/${branch}`]);
      return;
    }
    case 'addRemote': await git.addRemote(validateRemote(operation.remote), validateUrl(operation.url)); return;
    case 'setRemoteUrl': await git.remote(['set-url', validateRemote(operation.remote), validateUrl(operation.url)]); return;
    case 'removeRemote': await git.removeRemote(validateRemote(operation.remote)); return;
    case 'deleteRemoteBranch': await git.raw(['push', validateRemote(operation.remote), '--delete', validateRef(operation.branch)]); return;
    default: throw new Error(`Unsupported Git operation: ${operation.type}`);
  }
}

function createProjectGitService(options) {
  const queues = new Map();
  const canonicalWorkspace = (requested) => {
    if (typeof requested !== 'string' || !path.isAbsolute(requested)) throw new Error('Workspace path must be absolute');
    let candidate;
    try { candidate = fs.realpathSync(requested); } catch { throw new Error('Workspace directory is unavailable'); }
    const allowed = options.allowedWorkspacePaths().flatMap(value => {
      try { return [fs.realpathSync(value)]; } catch { return []; }
    });
    const match = allowed.find(value => process.platform === 'win32' ? value.toLocaleLowerCase() === candidate.toLocaleLowerCase() : value === candidate);
    if (!match) throw new Error('Workspace is not registered');
    return match;
  };
  const gitFor = baseDir => options.gitFactory({ baseDir, binary: 'git', maxConcurrentProcesses: 1, timeout: { block: 30_000 } });
  const inspect = async (requested) => {
    const workspacePath = canonicalWorkspace(requested);
    try { return await inspectRepository(gitFor(workspacePath), workspacePath); }
    catch (reason) {
      if (/ENOENT|not found|cannot find/i.test(asErrorMessage(reason))) {
        return emptySnapshot(workspacePath, 'git-unavailable', {
          available: false, version: null, executablePath: null, userName: null, userEmail: null,
          identityScope: 'unset', defaultBranch: null, pullFastForward: null, autoCrlf: null, credentialHelpers: []
        });
      }
      throw reason;
    }
  };
  const execute = (request) => {
    if (request?.operation?.type === 'commit' && !Object.hasOwn(request, 'expectedHead')) throw new Error('Commit requires expected HEAD');
    const workspacePath = canonicalWorkspace(request?.workspacePath);
    const previous = queues.get(workspacePath) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      const git = gitFor(workspacePath);
      if (request.expectedHead !== undefined) {
        const actual = (await optionalRaw(git, ['rev-parse', '--verify', 'HEAD'])).trim() || null;
        if (actual !== request.expectedHead) throw new Error('Repository changed; refresh before retrying');
      }
      await applyOperation(git, request.operation);
      return inspectRepository(git, workspacePath);
    });
    queues.set(workspacePath, task);
    void task.finally(() => { if (queues.get(workspacePath) === task) queues.delete(workspacePath); }).catch(() => {});
    return task;
  };
  const read = async (request) => {
    const workspacePath = canonicalWorkspace(request?.workspacePath);
    const git = gitFor(workspacePath);
    const root = (await git.revparse(['--show-toplevel'])).trim();
    const args = ['-C', root];
    if (request.kind === 'history') {
      const limit = request.limit ?? 200;
      if (!Number.isInteger(limit) || limit < 1 || limit > 2000) throw new Error('Invalid history limit');
      const raw = await git.raw([...args, 'log', '--all', '--topo-order', `--max-count=${limit}`, '--pretty=format:%H%x00%P%x00%an%x00%aI%x00%s%x00%D%x1e']);
      return { commits: raw.split('\x1e').map(row => row.trim()).filter(Boolean).map(row => {
        const [hash, parents, author, date, subject, refs] = row.split('\0');
        return { hash, parents: parents ? parents.split(' ') : [], author, date, subject, refs };
      }) };
    }
    let raw;
    if (request.kind === 'commit') {
      if (typeof request.hash !== 'string' || !/^[a-f0-9]{40,64}$/.test(request.hash)) throw new Error('Invalid commit hash');
      raw = await git.raw([...args, 'show', '--format=fuller', '--stat', '--patch', '--no-ext-diff', '--no-textconv', request.hash, '--']);
    } else if (request.kind === 'diff') {
      const file = literalFile(request.path);
      raw = await git.raw([...args, 'diff', ...(request.staged === true ? ['--cached'] : []), '--no-ext-diff', '--no-textconv', '--', file]);
      if (!raw && request.staged !== true) {
        const untracked = await git.raw([...args, 'ls-files', '--others', '--exclude-standard', '--', file]);
        if (untracked.trim()) {
          const absolute = path.resolve(root, request.path);
          const real = fs.realpathSync(absolute);
          if (path.relative(root, real).startsWith('..') || fs.lstatSync(absolute).isSymbolicLink()) throw new Error('Cannot preview external symlink');
          const handle = fs.openSync(real, 'r');
          try { const buffer = Buffer.alloc(256000); const size = fs.readSync(handle, buffer, 0, buffer.length, 0); raw = buffer.subarray(0, size).includes(0) ? 'Binary file' : buffer.subarray(0, size).toString('utf8'); }
          finally { fs.closeSync(handle); }
        }
      }
    } else throw new Error('Unsupported Git read');
    return { text: raw.slice(0, 256000), truncated: raw.length >= 256000 };
  };
  return { inspect, execute, read };
}

function literalFile(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || /[\0\r\n]/.test(value) || value.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === '.git')) throw new Error('Invalid repository file');
  return `:(top,literal)${value}`;
}

module.exports = { createProjectGitService, redactRemoteUrl, validateRef };
