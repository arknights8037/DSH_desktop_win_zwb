const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach, test } = require('node:test');
const { simpleGit } = require('simple-git');
const { createProjectGitService, redactRemoteUrl, validateRef } = require('../src/project-git-service.cjs');

const temporary = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function tempDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-project-git-test-'));
  temporary.push(directory);
  return directory;
}

function command(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function service(workspaces) {
  return createProjectGitService({
    gitFactory: options => simpleGit(options).env('GIT_CEILING_DIRECTORIES', os.tmpdir()),
    allowedWorkspacePaths: () => workspaces
  });
}

function commit(cwd, message, file = `${Date.now()}-${Math.random()}.txt`) {
  fs.writeFileSync(path.join(cwd, file), message, 'utf8');
  command(cwd, 'add', file);
  command(cwd, 'commit', '-m', message);
}

test('stages literal files, commits on the chosen branch and reads history and diffs', async () => {
  const workspace = tempDirectory();
  const git = service([workspace]);
  await git.execute({ workspacePath: workspace, operation: { type: 'initRepository', initialBranch: 'main' } });
  command(workspace, 'config', 'user.name', 'Test');
  command(workspace, 'config', 'user.email', 'test@example.invalid');
  fs.writeFileSync(path.join(workspace, '[draft].txt'), 'first\n');
  const preview = await git.read({ workspacePath: workspace, kind: 'diff', path: '[draft].txt', staged: false });
  assert.match(preview.text, /first/);
  await git.execute({ workspacePath: workspace, operation: { type: 'stage', paths: ['[draft].txt'] } });
  await git.execute({ workspacePath: workspace, operation: { type: 'unstage', paths: ['[draft].txt'] } });
  assert.equal(fs.readFileSync(path.join(workspace, '[draft].txt'), 'utf8'), 'first\n');
  await git.execute({ workspacePath: workspace, operation: { type: 'stage', paths: ['[draft].txt'] } });
  let state = await git.execute({ workspacePath: workspace, expectedHead: null, operation: { type: 'commit', branch: 'main', message: 'initial from UI' } });
  await git.execute({ workspacePath: workspace, operation: { type: 'createBranch', branch: 'feature/ui' } });
  fs.appendFileSync(path.join(workspace, '[draft].txt'), 'second\n');
  await git.execute({ workspacePath: workspace, operation: { type: 'stage', paths: ['[draft].txt'] } });
  await assert.rejects(git.execute({ workspacePath: workspace, expectedHead: state.head, operation: { type: 'commit', branch: 'main', message: 'wrong branch' } }), /branch changed/);
  state = await git.execute({ workspacePath: workspace, expectedHead: state.head, operation: { type: 'commit', branch: 'feature/ui', message: 'feature from UI' } });
  const history = await git.read({ workspacePath: workspace, kind: 'history', limit: 200 });
  assert.equal(history.commits[0].hash, state.head);
  assert.equal(history.commits[0].parents[0], history.commits[1].hash);
  assert.match((await git.read({ workspacePath: workspace, kind: 'commit', hash: state.head })).text, /second/);
  await assert.rejects(git.read({ workspacePath: workspace, kind: 'diff', path: '../outside', staged: false }), /Invalid/);
  await assert.rejects(git.execute({ workspacePath: workspace, operation: { type: 'stage', paths: [':(glob)*'] } }));
});

test('initializes a registered workspace and rejects an unregistered directory', async () => {
  const workspace = tempDirectory();
  const outside = tempDirectory();
  const git = service([workspace]);

  assert.equal((await git.inspect(workspace)).repositoryState, 'not-repository');
  await git.execute({ workspacePath: workspace, operation: { type: 'initRepository', initialBranch: 'main' } });
  assert.equal((await git.inspect(workspace)).repositoryState, 'unborn');
  await assert.rejects(git.inspect(outside), /not registered/);
});

test('configures GitFlow and finishes a feature into develop', async () => {
  const workspace = tempDirectory();
  const git = service([workspace]);
  await git.execute({ workspacePath: workspace, operation: { type: 'initRepository', initialBranch: 'main' } });
  command(workspace, 'config', 'user.name', 'DSH Test');
  command(workspace, 'config', 'user.email', 'dsh@example.invalid');
  commit(workspace, 'initial');

  let snapshot = await git.inspect(workspace);
  snapshot = await git.execute({
    workspacePath: workspace,
    expectedHead: snapshot.head,
    operation: {
      type: 'configureFlow',
      config: { production: 'main', develop: 'develop', prefixes: { feature: 'feature/', release: 'release/', hotfix: 'hotfix/', support: 'support/', versionTag: '' } }
    }
  });
  assert.equal(snapshot.flow.initialized, true);
  assert(snapshot.branches.some(branch => branch.name === 'develop'));

  snapshot = await git.execute({ workspacePath: workspace, expectedHead: snapshot.head, operation: { type: 'startFlowBranch', kind: 'feature', name: 'dashboard' } });
  commit(workspace, 'feature work');
  snapshot = await git.inspect(workspace);
  snapshot = await git.execute({ workspacePath: workspace, expectedHead: snapshot.head, operation: { type: 'finishFlowBranch', kind: 'feature', name: 'dashboard' } });
  assert.equal(snapshot.currentBranch, 'develop');
  assert.equal(snapshot.branches.some(branch => branch.name === 'feature/dashboard'), false);
  assert.match(command(workspace, 'log', '--oneline', '--merges', '-1'), /Merge branch 'feature\/dashboard'/);
});

test('guards stale heads, unsafe refs, and embedded remote credentials', async () => {
  const workspace = tempDirectory();
  const git = service([workspace]);
  await git.execute({ workspacePath: workspace, operation: { type: 'initRepository', initialBranch: 'main' } });
  command(workspace, 'config', 'user.name', 'DSH Test');
  command(workspace, 'config', 'user.email', 'dsh@example.invalid');
  commit(workspace, 'initial');

  await assert.rejects(git.execute({ workspacePath: workspace, expectedHead: 'deadbeef', operation: { type: 'fetch' } }), /changed/);
  assert.throws(() => validateRef('--upload-pack=bad'), /Invalid/);
  assert.equal(redactRemoteUrl('https://user:token@example.com/repo.git'), 'https://example.com/repo.git');
  assert.equal(redactRemoteUrl('git@example.com:team/repo.git'), 'example.com:team/repo.git');
});

test('checks Git environment and configures repository identity and safe pull defaults', async () => {
  const workspace = tempDirectory();
  const git = service([workspace]);
  let current = await git.inspect(workspace);
  assert.equal(current.environment.available, true);
  assert.match(current.environment.version, /^\d+\./);
  assert(current.environment.executablePath);
  await git.execute({ workspacePath: workspace, operation: { type: 'initRepository', initialBranch: 'main' } });
  current = await git.inspect(workspace);
  current = await git.execute({
    workspacePath: workspace,
    expectedHead: current.head,
    operation: {
      type: 'configureGit', scope: 'local',
      values: { userName: 'Project User', userEmail: 'project@example.invalid', pullFastForward: 'only', autoCrlf: 'input' }
    }
  });
  assert.equal(current.environment.userName, 'Project User');
  assert.equal(current.environment.userEmail, 'project@example.invalid');
  assert.equal(current.environment.identityScope, 'local');
  assert.equal(command(workspace, 'config', '--local', '--get', 'pull.ff'), 'only');
  assert.equal(command(workspace, 'config', '--local', '--get', 'core.autocrlf'), 'input');
  await assert.rejects(git.execute({
    workspacePath: workspace,
    operation: { type: 'configureGit', scope: 'global', values: { credentialHelper: '!malicious helper' } }
  }), /Unsupported credential helper/);
});

test('finishes a release into production and develop with an annotated tag', async () => {
  const workspace = tempDirectory();
  const git = service([workspace]);
  await git.execute({ workspacePath: workspace, operation: { type: 'initRepository', initialBranch: 'main' } });
  command(workspace, 'config', 'user.name', 'DSH Test');
  command(workspace, 'config', 'user.email', 'dsh@example.invalid');
  commit(workspace, 'initial');
  let current = await git.inspect(workspace);
  current = await git.execute({ workspacePath: workspace, expectedHead: current.head, operation: { type: 'configureFlow', config: { production: 'main', develop: 'develop', prefixes: { feature: 'feature/', release: 'release/', hotfix: 'hotfix/', support: 'support/', versionTag: 'v' } } } });
  current = await git.execute({ workspacePath: workspace, expectedHead: current.head, operation: { type: 'startFlowBranch', kind: 'release', name: '1.0.0' } });
  commit(workspace, 'release work');
  current = await git.inspect(workspace);
  const releaseHead = current.head;
  current = await git.execute({ workspacePath: workspace, expectedHead: current.head, operation: { type: 'finishFlowBranch', kind: 'release', name: '1.0.0', tag: '1.0.0' } });

  assert.equal(current.currentBranch, 'develop');
  assert.equal(command(workspace, 'tag', '--points-at', 'main'), 'v1.0.0');
  command(workspace, 'merge-base', '--is-ancestor', releaseHead, 'main');
  command(workspace, 'merge-base', '--is-ancestor', releaseHead, 'develop');
  assert.equal(current.branches.some(branch => branch.name === 'release/1.0.0'), false);
});

test('publishes and independently deletes a remote topic branch', async () => {
  const workspace = tempDirectory();
  const remote = tempDirectory();
  command(remote, 'init', '--bare');
  const git = service([workspace]);
  await git.execute({ workspacePath: workspace, operation: { type: 'initRepository', initialBranch: 'main' } });
  command(workspace, 'config', 'user.name', 'DSH Test');
  command(workspace, 'config', 'user.email', 'dsh@example.invalid');
  commit(workspace, 'initial');
  let current = await git.inspect(workspace);
  current = await git.execute({ workspacePath: workspace, expectedHead: current.head, operation: { type: 'addRemote', remote: 'origin', url: remote } });
  current = await git.execute({ workspacePath: workspace, expectedHead: current.head, operation: { type: 'publish', remote: 'origin', branch: 'main' } });
  assert.equal(current.tracking, 'origin/main');
  current = await git.execute({ workspacePath: workspace, expectedHead: current.head, operation: { type: 'unsetUpstream', localBranch: 'main' } });
  assert.equal(current.tracking, null);
  current = await git.execute({ workspacePath: workspace, expectedHead: current.head, operation: { type: 'setUpstream', localBranch: 'main', remote: 'origin', branch: 'main' } });
  assert.equal(current.tracking, 'origin/main');
  command(workspace, 'checkout', '-b', 'feature/shared');
  commit(workspace, 'shared work');
  current = await git.inspect(workspace);
  current = await git.execute({ workspacePath: workspace, expectedHead: current.head, operation: { type: 'publish', remote: 'origin', branch: 'feature/shared' } });
  assert.match(command(remote, 'show-ref', 'refs/heads/feature/shared'), /refs\/heads\/feature\/shared/);
  await git.execute({ workspacePath: workspace, expectedHead: current.head, operation: { type: 'deleteRemoteBranch', remote: 'origin', branch: 'feature/shared' } });
  assert.throws(() => command(remote, 'show-ref', 'refs/heads/feature/shared'));
});

test('finishes a hotfix into production and develop and supports conflict abort', async () => {
  const workspace = tempDirectory();
  const git = service([workspace]);
  await git.execute({ workspacePath: workspace, operation: { type: 'initRepository', initialBranch: 'main' } });
  command(workspace, 'config', 'user.name', 'DSH Test');
  command(workspace, 'config', 'user.email', 'dsh@example.invalid');
  commit(workspace, 'initial', 'shared.txt');
  let current = await git.inspect(workspace);
  current = await git.execute({
    workspacePath: workspace,
    expectedHead: current.head,
    operation: {
      type: 'configureFlow',
      config: {
        production: 'main', develop: 'develop',
        prefixes: { feature: 'feature/', release: 'release/', hotfix: 'hotfix/', support: 'support/', versionTag: 'v' }
      }
    }
  });
  current = await git.execute({
    workspacePath: workspace,
    expectedHead: current.head,
    operation: { type: 'startFlowBranch', kind: 'hotfix', name: '1.0.1' }
  });
  commit(workspace, 'hotfix work');
  current = await git.inspect(workspace);
  const hotfixHead = current.head;
  current = await git.execute({
    workspacePath: workspace,
    expectedHead: current.head,
    operation: { type: 'finishFlowBranch', kind: 'hotfix', name: '1.0.1', tag: '1.0.1' }
  });
  command(workspace, 'merge-base', '--is-ancestor', hotfixHead, 'main');
  command(workspace, 'merge-base', '--is-ancestor', hotfixHead, 'develop');
  assert.equal(command(workspace, 'tag', '--points-at', 'main'), 'v1.0.1');

  current = await git.execute({
    workspacePath: workspace,
    expectedHead: current.head,
    operation: { type: 'startFlowBranch', kind: 'feature', name: 'conflict' }
  });
  fs.writeFileSync(path.join(workspace, 'shared.txt'), 'feature\n', 'utf8');
  command(workspace, 'add', 'shared.txt');
  command(workspace, 'commit', '-m', 'feature conflict');
  command(workspace, 'checkout', 'develop');
  fs.writeFileSync(path.join(workspace, 'shared.txt'), 'develop\n', 'utf8');
  command(workspace, 'add', 'shared.txt');
  command(workspace, 'commit', '-m', 'develop conflict');
  command(workspace, 'checkout', 'feature/conflict');
  current = await git.inspect(workspace);
  await assert.rejects(git.execute({
    workspacePath: workspace,
    expectedHead: current.head,
    operation: { type: 'finishFlowBranch', kind: 'feature', name: 'conflict' }
  }), /CONFLICT|conflict/i);
  current = await git.inspect(workspace);
  assert.equal(current.repositoryState, 'conflict');
  assert.deepEqual(current.conflicts, ['shared.txt']);
  current = await git.execute({ workspacePath: workspace, operation: { type: 'abortMerge' } });
  assert.equal(current.repositoryState, 'ready');
  assert.equal(current.currentBranch, 'develop');
});
