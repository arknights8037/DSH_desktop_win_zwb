/** Runs on the SSH host before DSH starts; only the shipped conversation stores are imported. */
export const remoteSessionImport = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const [requestedSource, home, owner] = process.argv.slice(2);
const source = path.resolve(requestedSource);
const target = fs.realpathSync(home);
const stage = path.join(target, '.manager-session-import');
const completed = path.join(target, '.manager-session-import.json');
const exists = file => fs.lstatSync(file, { throwIfNoEntry: false });
function regular(file, directory = false) {
  const stat = fs.lstatSync(file);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw Error('Unsupported file or symbolic link: ' + file);
  return stat;
}
function readRecord(file) {
  regular(file);
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record.version !== 1 || record.owner !== owner || record.source !== source) throw Error('Session import ownership or source mismatch');
  return record;
}
function digest(file) {
  regular(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try { for (let size; (size = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0;) hash.update(buffer.subarray(0, size)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function inventory(root, selections) {
  const result = [];
  function visit(relative) {
    const file = path.join(root, relative);
    const stat = fs.lstatSync(file);
    if (stat.isDirectory()) {
      result.push({ path: relative, directory: true });
      for (const child of fs.readdirSync(file).sort()) visit(relative + '/' + child);
    } else {
      regular(file);
      result.push({ path: relative, hash: digest(file) });
    }
  }
  for (const entry of selections) visit(entry);
  return result;
}
if (exists(completed)) {
  readRecord(completed);
  process.exit(0);
}
let record;
if (exists(stage)) {
  regular(stage, true);
  record = readRecord(path.join(stage, 'state.json'));
  if (record.phase !== 'ready') throw Error('An incomplete session snapshot is retained at ' + stage + '; inspect it before retrying');
} else {
  regular(source, true);
  const realSource = fs.realpathSync(source);
  if (realSource === target || realSource.startsWith(target + path.sep) || target.startsWith(realSource + path.sep)) throw Error('Source and destination DSH directories must not overlap');
  regular(path.join(source, 'sessions'), true);
  const selections = ['sessions'];
  if (exists(path.join(source, 'attachments'))) { regular(path.join(source, 'attachments'), true); selections.push('attachments'); }
  if (exists(path.join(source, 'storages'))) {
    regular(path.join(source, 'storages'), true);
    if (exists(path.join(source, 'storages', 'workspace'))) throw Error('Custom workspace storage is not supported for session import');
    const workspace = path.join(source, 'storages', 'workspace.json');
    if (exists(workspace)) {
      regular(workspace);
      const document = JSON.parse(fs.readFileSync(workspace, 'utf8'));
      if (document.unit?.name !== 'workspace' || document.global?.pendingMutation) throw Error('Workspace data is not a completed snapshot; stop the source DSH before importing');
      selections.push('storages/workspace.json');
    }
  }
  // Never merge with a live or previously used destination's conversation stores.
  for (const entry of ['sessions', 'attachments', 'storages/workspace.json', 'storages/workspace']) {
    if (exists(path.join(target, entry))) throw Error('Session import requires a new instance without existing conversation data');
  }
  if (exists(path.join(target, 'storages'))) regular(path.join(target, 'storages'), true);
  const files = inventory(source, selections);
  if (!files.some(file => file.path.startsWith('sessions/') && file.hash)) throw Error('No session files were found in the source DSH directory');
  record = { version: 1, owner, source, phase: 'copying', selections, files };
  fs.mkdirSync(stage, { mode: 0o700 });
  fs.writeFileSync(path.join(stage, 'state.json'), JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  try {
    const payload = path.join(stage, 'payload');
    fs.mkdirSync(payload, { mode: 0o700 });
    for (const file of files) {
      const destination = path.join(payload, file.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      if (file.directory) fs.mkdirSync(destination, { mode: 0o700 });
      else {
        fs.copyFileSync(path.join(source, file.path), destination, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(destination, 0o600);
        if (digest(destination) !== file.hash) throw Error('Source sessions changed during import; stop the source DSH and retry');
      }
    }
    if (JSON.stringify(inventory(source, selections)) !== JSON.stringify(files)) throw Error('Source sessions changed during import; stop the source DSH and retry');
    if (selections.includes('storages/workspace.json') && JSON.parse(fs.readFileSync(path.join(payload, 'storages/workspace.json'), 'utf8')).global?.pendingMutation) {
      throw Error('Workspace data is not a completed snapshot; stop the source DSH before importing');
    }
    record.phase = 'ready';
    fs.writeFileSync(path.join(stage, 'state.next'), JSON.stringify(record), { flag: 'wx', mode: 0o600 });
    fs.renameSync(path.join(stage, 'state.next'), path.join(stage, 'state.json'));
  } catch (error) {
    fs.rmSync(stage, { recursive: true });
    throw error;
  }
}
// An interrupted publication resumes only after checking each already-published store.
const allowed = ['sessions', 'attachments', 'storages/workspace.json'];
if (!Array.isArray(record.selections) || !record.selections.includes('sessions') || new Set(record.selections).size !== record.selections.length
  || record.selections.some(entry => !allowed.includes(entry)) || !Array.isArray(record.files)
  || record.files.some(file => !file || typeof file.path !== 'string' || path.isAbsolute(file.path) || file.path.split('/').some(part => !part || part === '..' || part === '.')
    || !record.selections.some(entry => file.path === entry || file.path.startsWith(entry + '/')))) throw Error('Invalid session import journal');
regular(path.join(stage, 'payload'), true);
if (exists(path.join(target, 'storages'))) regular(path.join(target, 'storages'), true);
for (const entry of record.selections) {
  const from = path.join(stage, 'payload', entry);
  const destination = path.join(target, entry);
  const expected = record.files.filter(file => file.path === entry || file.path.startsWith(entry + '/'));
  if (exists(destination)) {
    if (exists(from) || JSON.stringify(inventory(target, [entry])) !== JSON.stringify(expected)) throw Error('Session import destination conflict; existing data was retained');
  } else {
    if (JSON.stringify(inventory(path.join(stage, 'payload'), [entry])) !== JSON.stringify(expected)) throw Error('Session snapshot verification failed');
    if (exists(path.dirname(destination))) regular(path.dirname(destination), true);
    else fs.mkdirSync(path.dirname(destination), { mode: 0o700 });
    fs.renameSync(from, destination);
  }
}
fs.writeFileSync(completed, JSON.stringify({ version: 1, owner, source }), { flag: 'wx', mode: 0o600 });
fs.rmSync(stage, { recursive: true });
`;
