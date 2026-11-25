import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

import { assistantContext, PLATFORM, COMMANDS, AGENTS, SKILLS, AI_COMMANDS, PROMPTS } from '../src/index';

// Compiled, these tests run from dist/tests, so the package root is one folder further up.
const PKG = fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');
const read = (f: string) => fs.readFileSync(path.join(PKG, f), 'utf8');
const pkg = JSON.parse(read('package.json'));
const manifest = pkg.workspacePlugin;
const FUN = read('scripts/functions/fun-plane.sh');

test('the manifest names the platform, and every file it names ships', () => {
  assert.strictEqual(manifest.name, PLATFORM);
  const named = [...manifest.commands.files, ...manifest.scripts.functions, ...manifest.scripts.args, ...manifest.scripts.machine,
    ...manifest.ai.agents, ...manifest.ai.skills, ...manifest.ai.commands, ...manifest.ai.prompts, ...manifest.features, manifest.settingsTemplate, manifest.labels];
  for (const f of named) assert.ok(fs.existsSync(path.join(PKG, f)), `${f} is in the package`);
  for (const f of named) assert.ok(pkg.files.includes(f.split('/')[0]), `${f} is published with the package`);
  assert.deepStrictEqual(manifest.commands.files.map((f: string) => path.basename(f)), COMMANDS);
  assert.deepStrictEqual(manifest.ai.agents.map((f: string) => path.basename(f, '.md')), AGENTS);
  assert.deepStrictEqual(manifest.ai.skills.map((f: string) => path.basename(f)), SKILLS);
  assert.deepStrictEqual(manifest.ai.commands.map((f: string) => path.basename(f, '.md')), AI_COMMANDS);
  assert.deepStrictEqual(manifest.ai.prompts.map((f: string) => path.basename(f, '.md')), PROMPTS);
  assert.deepStrictEqual(manifest.commands.types, ['sites'], 'the commands go to sites folders only');
  assert.deepStrictEqual(manifest.typeActions, { plane: ['sites', 'code'] }, 'the PLANE menu on the rows of sites and code folders');
  // The machine files land side by side in core/scripts/plugins/plane/: no two may share a name.
  const names = manifest.scripts.machine.map((f: string) => path.basename(f));
  assert.strictEqual(new Set(names).size, names.length, 'the machine files have names of their own');
  assert.deepStrictEqual(names, ['docker-compose.plane.yaml', 'plane-site.py', 'plane-start.sh', 'site.feature']);
  assert.strictEqual(manifest.featuresSite, undefined, 'CI builds no site: Plane runs on DDEV only for now, which CI\'s dashboard job does not have');
  assert.deepStrictEqual(pkg.dependencies, { '@webship.co/workspace-tracker': '^1.0.2' });
  assert.ok(manifest.summary.length <= 110, 'the catalogue line shows at most 110 characters');
});

test('every command finds the workspace by itself, names its folder, and sources its args from where the installer puts them', () => {
  for (const f of manifest.commands.files) {
    const src = read(f);
    assert.match(src, /^#!\/usr\/bin\/env bash/, `${f} is a bash script`);
    assert.match(src, /WORKSPACE_SCRIPTS="\$\{WORKSPACE_SCRIPTS:-\$\(cd "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\.\.\/core\/scripts" && pwd\)\}"/, `${f} locates the tooling from its own path`);
    assert.match(src, /workspace\.__WORKSPACE__\.settings\.yml/, `${f} loads the settings of the folder it is installed into`);
    assert.match(src, /source \$\{WORKSPACE_SCRIPTS\}\/plugins\/plane\/args\/arg-[a-z-]+\.sh \|\| exit 1 ;/, `${f} reads its arguments from the plugin's args`);
    const last = src.trim().split('\n').pop() as string;
    assert.match(FUN, new RegExp(`^function ${last.replace(/ ;$/, '')}\\(\\)`, 'm'), `${f} ends by calling a function the plugin defines`);
  }
  assert.match(read('commands/cmd-plane-project.sh'), /^# workspace-name: Plane \(project and work management\)$/m, 'the builder carries the name the Build list shows');
  assert.doesNotMatch(read('commands/cmd-tools-plane-cli.sh'), /^# workspace-name:/m, 'a tool is not a builder');
});

test('every shell script parses, and the site\'s script is Python Plane\'s own Django shell reads', () => {
  for (const f of [...manifest.commands.files, ...manifest.scripts.functions, ...manifest.scripts.args]) {
    const r = spawnSync('bash', ['-n', path.join(PKG, f)], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `${f}: ${r.stderr}`);
  }
  const start = spawnSync('sh', ['-n', path.join(PKG, 'scripts/plane-start.sh')], { encoding: 'utf8' });
  assert.strictEqual(start.status, 0, `plane-start.sh: ${start.stderr}`);
  const py = spawnSync('python3', ['-c', 'import ast, sys; ast.parse(open(sys.argv[1]).read())', path.join(PKG, 'scripts/plane-site.py')], { encoding: 'utf8' });
  assert.strictEqual(py.status, 0, `plane-site.py: ${py.stderr}`);
  const site = read('scripts/plane-site.py');
  for (const verb of ['defaults', 'accounts', 'content', 'tidy', 'list', 'token', 'version', 'counts']) assert.match(site, new RegExp(`verb == '${verb}'`), `the site script answers ${verb}`);
  assert.match(site, /\('ENABLE_SIGNUP', '0'\)/, 'sign-ups closed');
  assert.match(site, /cache\.clear\(\)/, 'the instance\'s cached answer is dropped, so a visitor gets the login form, not the setup');
  assert.match(site, /with impersonate\(author\)/, 'the sample content is made as its author');
  assert.match(site, /IssueActivity\.all_objects\.filter\(issue=issue\)\.delete\(\)/, 'a work item removed for good loses its history first, which Plane keeps');
  assert.match(site, /IssueComment\.objects\.filter\(\*\*on_live\)/, 'the counts leave out what Plane keeps marked as deleted');
  // What tidy deletes for good: a work item titled "Webship test …" (a space after test) made by a default account, and
  // a comment a default account deleted; nothing of another title or another author.
  assert.match(site, /^TEST_PREFIX = 'Webship test '$/m);
  assert.match(site, /^TEST_ACCOUNTS = \['owner', 'member', 'reader', 'stranger'\]$/m);
  const tidy = site.slice(site.indexOf('def tidy():'), site.indexOf('def counts():'));
  assert.match(tidy, /authors = User\.objects\.filter\(username__in=TEST_ACCOUNTS, email__endswith='@example\.com'\)/);
  assert.match(tidy, /Issue\.all_objects\.filter\(project=project, name__startswith=TEST_PREFIX, created_by__in=authors\)/);
  assert.match(tidy, /IssueComment\.all_objects\.filter\(project=project, deleted_at__isnull=False, actor__in=authors\)/);
  assert.strictEqual((tidy.match(/\.delete\(/g) || []).length, 3, 'three deletes, each on one of those');
});

test('the runtime: DDEV; another is refused before anything is changed, and so is a machine with too little memory', () => {
  assert.match(read('scripts/args/arg-plane.sh'), /choices=\['ddev'\]/);
  const build = FUN.slice(FUN.indexOf('function plane_build()'));
  const guard = build.indexOf('if [ "${runtime}" != \'ddev\' ]');
  const memory = build.indexOf('plane_free_memory');
  assert.ok(guard > 0 && guard < build.indexOf('drop_database') && guard < build.indexOf('ddev config'), 'the runtime is asked first');
  assert.ok(memory > 0 && memory < build.indexOf('drop_database'), 'the free memory is asked before anything is removed');
  assert.ok(build.includes('Plane builds on DDEV for now (--runtime ddev), not on ${runtime}: that runtime is not proven for it yet. Nothing was changed.'));
  assert.match(FUN, /^readonly PLANE_MEMORY_MB=4096;$/m, 'the builder asks for 4 GB free');
  assert.ok(build.indexOf('plane_site defaults') > build.indexOf('plane_wait'), 'the instance is set up once the site answers');
  assert.ok(build.indexOf('plane_setup_done') > build.indexOf('plane_site defaults'), 'then the builder checks a visitor gets the login form, not the setup');
});

test('Plane\'s services on DDEV: the all-in-one image takes the project\'s address, on the project\'s database, with its own queue, cache and store', () => {
  const compose = read('scripts/docker-compose.plane.yaml');
  assert.match(compose, /image: "\$\{PLANE_IMAGE:-docker\.io\/makeplane\/plane-aio-community:v1\.5\.1\}"/, 'the Community Edition, pinned, by its whole name');
  assert.match(compose, /VIRTUAL_HOST: \$\{DDEV_HOSTNAME\}/, 'Plane takes the project\'s address');
  assert.match(compose, /HTTP_EXPOSE: "80:80"/);
  assert.match(compose, /HTTPS_EXPOSE=8457:80,8026:8025/, 'the web container moves, its mail catcher stays at :8026');
  assert.match(compose, /depends_on:\n\s+db:\n\s+condition: service_healthy/, 'Plane starts once its database is healthy');
  assert.match(compose, /command: \["sh", "\/opt\/webship\/plane-start\.sh"\]/, 'the site\'s values go into the image\'s own settings file first');
  assert.match(compose, /env_file:\n\s+- \$\{DDEV_APPROOT\}\/plane\/env/, 'the site\'s own values from its file');
  assert.match(compose, /name: ddev-\$\{DDEV_SITENAME\}-plane-minio/, 'the store is the project\'s');
  assert.match(compose, /name: ddev-\$\{DDEV_SITENAME\}-plane-rabbitmq/, 'the queue is the project\'s');
  for (const image of compose.match(/image: "[^"]+"/g) || []) assert.match(image, /image: "(\$\{PLANE_IMAGE:-)?docker\.io\//, `${image}: every image by its whole name`);
  assert.doesNotMatch(compose, /SECRET_KEY:|PASSWORD:|ACCESS_KEY/, 'no secret in the compose file');
  const start = read('scripts/plane-start.sh');
  assert.match(start, /for key in AUTHENTICATION_RATE_LIMIT GUNICORN_WORKERS ; do/);
  assert.match(start, /exec \/app\/start\.sh$/m, 'then the image\'s own start');
  assert.match(FUN, /^readonly PLANE_LOGIN_LIMIT='100\/minute';$/m, 'a test site allows the logins a suite makes, by default');
  assert.match(FUN, /^AUTHENTICATION_RATE_LIMIT=\$\{login_limit\}$/m, 'the site\'s own value goes into its settings');
  assert.match(FUN, /local login_limit="\$\{LOGIN_LIMIT:-\$\{site_plane_login_limit:-\$\{PLANE_LOGIN_LIMIT\}\}\}"/, 'the flag, else the folder\'s setting, else the default');
  assert.match(read('scripts/args/arg-plane.sh'), /'--login-limit',\n\s+dest='LOGIN_LIMIT'/);
  const connect = FUN.slice(FUN.indexOf('function plane_connect()'), FUN.indexOf('function plane_cli_tool()'));
  assert.doesNotMatch(connect, /RATE_LIMIT|login_limit/i, 'connecting to a Plane never changes its limit');
});

test('the functions carry the names the core\'s tools look for, and run Plane\'s tools in its container', () => {
  for (const fn of ['set_plane_users', 'add_plane_users', 'cancel_plane_users', 'testing_configure_plane', 'plane_build', 'plane_cli_tool', 'plane_connect']) {
    assert.match(FUN, new RegExp(`^function ${fn}\\(\\) \\{`, 'm'), `${fn} is defined`);
  }
  assert.match(FUN, /ddev exec -s plane "sh -c/, 'on DDEV in Plane\'s container');
  assert.match(FUN, /python manage\.py shell -c \\"exec\(open\('\/opt\/webship\/plane-site\.py'\)\.read\(\)\)\\"/, 'the site script through Django\'s own shell');
  assert.match(FUN, /plane_exec "python manage\.py \$\{RUN\}"/, 'the tool runs Plane\'s own commands');
  assert.match(FUN, /users=\(owner member reader stranger\);/);
  assert.match(FUN, /user_owner_role='Admin' ;\n\s+user_member_role='Member' ;\n\s+user_reader_role='Guest' ;\n\s+user_stranger_role='' ;/);
  assert.doesNotMatch(FUN, /ddev stop -y/, 'ddev stop takes no -y');
  const connect = FUN.slice(FUN.indexOf('function plane_connect()'), FUN.indexOf('function plane_cli_tool()'));
  assert.match(connect, /PLANE_NEW_TOKEN="\$\{token\}" python3/, 'the key reaches the settings writer in its environment only');
  assert.match(connect, /0o600/, 'the settings file stays readable by its owner only');
  assert.doesNotMatch(connect, /echo[^\n]*\$\{token\}/, 'the key is never printed');
  const testing = FUN.slice(FUN.indexOf('function testing_configure_plane()'));
  assert.match(testing, /registry="\$\{registry\}\$\{user\}\|\$\{!user_mail\}\|\$\{!user_password\}\|\$\{!user_name\}"/, 'the pack logs in with the address and shows the display name');
  assert.match(testing, /workspace: process\.env\.WORKSPACE \|\| '%s',/, 'the workspace the pack works in');
});

test('the assistant is told how to build, test and connect a site', () => {
  const told = assistantContext();
  for (const c of COMMANDS) assert.ok(told.includes(c), `the assistant is told about ${c}`);
  for (const a of AGENTS) assert.ok(told.includes(a), `the assistant is told about ${a}`);
  assert.match(told, /4 GB of free memory/);
  assert.match(told, /--connect <login>/);
  assert.match(told, /no worklog/);
});

test('the docs say container-based, name only what ships, and carry no personal value', () => {
  const docs = ['README.md', ...manifest.ai.agents, 'scripts/functions/fun-plane.sh', 'config/plugin.plane.settings.yml'];
  for (const f of docs) {
    const src = read(f);
    assert.doesNotMatch(src, /DDEV-only/i, `${f}: the workspace is container-based, DDEV by default`);
    assert.doesNotMatch(src, /\/home\/(?!YOUR_USER)[a-z]/, `${f} carries no personal path`);
    const mails = src.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[a-z]{2,}/g) || [];
    for (const m of mails) assert.match(m, /@example\.(com|org)$/, `${f}: ${m} is not an example address`);
  }
  for (const c of COMMANDS) assert.ok(read('README.md').includes(c), `the README lists ${c}`);
  const keys = [...read('config/plugin.plane.settings.yml').matchAll(/^([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 12);
  for (const k of keys) assert.ok(read('README.md').includes(`\`${k}\``), `the README describes the setting ${k}`);
});
