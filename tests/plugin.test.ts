import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
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
  assert.deepStrictEqual(names, ['docker-compose.plane.yaml', 'plane-site.py', 'plane-start.sh', 'plane-serve.sh', 'site.feature']);
  assert.strictEqual(manifest.featuresSite, 'cmd-plane-project.sh ci-plane --install --add-users --sample-content --runtime docker', 'CI builds a site on Docker Compose for the features');
  assert.deepStrictEqual(manifest.features, ['features/plane.feature', 'features/plane-runtimes.feature']);
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
  const serve = spawnSync('bash', ['-n', path.join(PKG, 'scripts/plane-serve.sh')], { encoding: 'utf8' });
  assert.strictEqual(serve.status, 0, `plane-serve.sh: ${serve.stderr}`);
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

test('the runtimes: DDEV, Docker Compose, Podman and Kubernetes; another is refused before anything is changed, and so is a machine with too little memory', () => {
  assert.match(read('scripts/args/arg-plane.sh'), /choices=\['ddev', 'docker', 'podman', 'kubernetes'\]/);
  const build = FUN.slice(FUN.indexOf('function plane_build()'));
  const guard = build.indexOf('case "${runtime}" in');
  const services = build.indexOf('declare -f rt_service');
  const memory = build.indexOf('plane_free_memory');
  assert.ok(guard > 0 && guard < build.indexOf('drop_database') && guard < build.indexOf('ddev config'), 'the runtime is asked first');
  assert.match(build, /case "\$\{runtime\}" in\n\s+ddev\|docker\|podman\|kubernetes\) ;;/, 'the four runtimes the plugin was proven on');
  assert.ok(build.includes('Plane builds on DDEV, Docker Compose, Podman and Kubernetes for now (--runtime ddev, docker, podman or kubernetes), not on ${runtime}: that runtime is not proven for it yet. Nothing was changed.'));
  assert.ok(services > guard && services < build.indexOf('drop_database'), 'a workspace whose projects carry no services of their own is told so before anything is removed');
  assert.ok(build.includes('needs a Webship Workspace whose projects carry services of their own (rt_service, webship/workspace#900)'));
  assert.ok(memory > 0 && memory < build.indexOf('drop_database'), 'the free memory is asked before anything is removed');
  assert.match(FUN, /^readonly PLANE_MEMORY_MB=4096;$/m, 'the builder asks for 4 GB free');
  assert.ok(build.indexOf('plane_write_service_env') < build.indexOf('plane_write_config'), 'the services\' keys are written before the services are');
  assert.ok(build.indexOf('base_url="$(plane_url)"') > build.indexOf('plane_write_config'), 'the address is read once the runtime has given the project its port');
  assert.ok(build.indexOf('plane_site defaults') > build.indexOf('plane_wait'), 'the instance is set up once the site answers');
  assert.ok(build.indexOf('plane_setup_done') > build.indexOf('plane_site defaults'), 'then the builder checks a visitor gets the login form, not the setup');
  const tool = FUN.slice(FUN.indexOf('function plane_cli_tool()'), FUN.indexOf('function testing_configure_plane()'));
  assert.match(tool, /ddev start < \/dev\/null > \/dev\/null 2>&1 \|\| ddev start -y/, 'the tool starts a project of another runtime through its own layer');
});

/** What the builder writes for a project, with the runtime layer's calls stood in: [log of the calls, the project]. */
function written(runtime: string, address: string): { calls: string, dir: string, read: (f: string) => string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plane-runtimes-'));
  const plugin = path.join(dir, 'scripts', 'plugins', 'plane');
  fs.mkdirSync(plugin, { recursive: true });
  for (const f of manifest.scripts.machine) fs.copyFileSync(path.join(PKG, f), path.join(plugin, path.basename(f)));
  const project = path.join(dir, 'mysite');
  fs.mkdirSync(path.join(project, '.ddev'), { recursive: true });
  const stand = [
    'rt_claim() { echo "rt_claim $*" >> "$LOG" ; }',
    'rt_stack() { echo "rt_stack $*" >> "$LOG" ; }',
    'rt_web_build() { echo "rt_web_build $*" >> "$LOG" ; cat > "$LOG.dockerfile" ; }',
    'rt_service() { printf "rt_service" >> "$LOG" ; printf " [%s]" "$@" >> "$LOG" ; echo >> "$LOG" ; }',
    'rt_serve() { echo "rt_serve $1 [$2]" >> "$LOG" ; }',
  ].join('\n');
  const script = `${stand}\nsource "${path.join(PKG, 'scripts/functions/fun-plane.sh')}"\nplane_write_service_env "${project}" && plane_write_config "${project}" v1.5.1 ${runtime} && plane_write_env "${project}" v1.5.1 "${address}" 100/minute ${runtime}`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, WORKSPACE_SCRIPTS: path.join(dir, 'scripts'), LOG: path.join(dir, 'calls.log') } });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const log = path.join(dir, 'calls.log');
  return { calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '', dir, read: (f: string) => fs.readFileSync(path.join(project, f), 'utf8') };
}

/** Remove a folder of this file's tests, never a path outside one. */
function removeTestDir(dir: string): void {
  const parts = path.relative(os.tmpdir(), path.resolve(dir)).split(path.sep);
  assert.ok(parts.length === 1 && /^plane-runtimes-[A-Za-z0-9]{6}$/.test(parts[0]), `refused to remove ${dir}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

test('on Docker Compose, Podman and Kubernetes: the all-in-one image as the web container\'s, run as the host user, and the cache, queue and store as the project\'s own services', () => {
  for (const runtime of ['docker', 'podman', 'kubernetes']) {
    const w = written(runtime, 'http://127.0.0.1:33001');
    try {
      const calls = w.calls.trim().split('\n');
      assert.deepStrictEqual(calls, [
        'rt_claim plane',
        'rt_stack image docker.io/makeplane/plane-aio-community:v1.5.1',
        'rt_web_build plane',
        'rt_service [valkey] [docker.io/valkey/valkey:7.2.11-alpine] [--port] [6379]',
        'rt_service [rabbitmq] [docker.io/library/rabbitmq:3.13.6-alpine] [--port] [5672] [--env-file] [plane/rabbitmq.env] [--volume] [/var/lib/rabbitmq]',
        'rt_service [minio] [docker.io/pgsty/silo:RELEASE.2026-09-16T00-00-00Z] [--port] [9000] [--env-file] [plane/minio.env] [--volume] [/export] [--command] [server /export --console-address ":9090"]',
        'rt_serve 8080 [bash plane/plane-serve.sh]',
      ], runtime);
      // The web image: Plane's supervisor without the user it names, and Plane's folders the host user's.
      const fragment = fs.readFileSync(path.join(w.dir, 'calls.log.dockerfile'), 'utf8');
      assert.match(fragment, /sed -i '\/\^user=root\$\/d' "\$\{conf\}"/);
      assert.match(fragment, /if grep -q '\^user=' "\$\{conf\}" ; then echo "[^"]+" >&2 ; exit 1 ; fi/, 'a release whose supervisor names another user stops the build, saying why');
      assert.match(fragment, /chown www-data:www-data \/app \/app\/plane\.env/);
      assert.match(fragment, /chown -R www-data:www-data \/app\/var \/app\/backend/);
      assert.doesNotMatch(fragment, /chown -R www-data:www-data \/app( |$)/m, 'never the whole image again (its node apps are 1.6 GB)');
      // The image's own volumes (/app/logs, /app/data) keep the image's owner on Podman: the logs go to /app/var.
      assert.match(fragment, /sed -i 's#\/app\/logs\/#\/app\/var\/logs\/#g' "\$\{conf\}"/);
      assert.match(fragment, /if grep -q '\/app\/logs' "\$\{conf\}" ; then echo "[^"]+" >&2 ; exit 1 ; fi/, 'a release that logs elsewhere stops the build, saying why');
      assert.match(fragment, /mkdir -p \/app\/var\/logs\/access \/app\/var\/logs\/error \/app\/var\/data/);
      assert.doesNotMatch(fragment, /chown[^\n]*\/app\/(logs|data)\b/, 'nothing is changed in the image\'s volumes');
      // The site's values: the address with its port where Plane lets one in, its proxy on the port the stack serves.
      const env = w.read('plane/env');
      for (const line of ['DOMAIN_NAME=127.0.0.1', 'APP_DOMAIN=127.0.0.1', 'APP_PROTOCOL=http', 'SITE_ADDRESS=:8080', 'WEB_URL=http://127.0.0.1:33001',
        'APP_BASE_URL=http://127.0.0.1:33001', 'ADMIN_BASE_URL=http://127.0.0.1:33001', 'SPACE_BASE_URL=http://127.0.0.1:33001',
        'DATABASE_URL=postgresql://db:db@db:5432/db', 'REDIS_URL=redis://valkey:6379/', 'AWS_S3_ENDPOINT_URL=http://minio:9000', 'AUTHENTICATION_RATE_LIMIT=100/minute']) {
        assert.ok(env.split('\n').includes(line), `${runtime}: ${line}`);
      }
      // One set of keys: the queue's password and the store's keys are the ones its services were given.
      const mq = (w.read('plane/rabbitmq.env').match(/^RABBITMQ_DEFAULT_PASS=([A-Za-z0-9]{32})$/m) || [])[1];
      assert.ok(mq && env.includes(`AMQP_URL=amqp://plane:${mq}@rabbitmq:5672/plane`), `${runtime}: the queue's password`);
      const store = w.read('plane/minio.env');
      assert.ok(env.includes(`AWS_ACCESS_KEY_ID=${(store.match(/^MINIO_ROOT_USER=(.+)$/m) || [])[1]}`) && env.includes(`AWS_SECRET_ACCESS_KEY=${(store.match(/^MINIO_ROOT_PASSWORD=(.+)$/m) || [])[1]}`), `${runtime}: the store's keys`);
      for (const f of ['env', 'rabbitmq.env', 'minio.env']) assert.strictEqual(fs.statSync(path.join(w.dir, 'mysite', 'plane', f)).mode & 0o777, 0o600, `${runtime}: plane/${f} is its owner's only`);
      for (const f of ['plane-site.py', 'plane-start.sh', 'plane-serve.sh']) assert.ok(fs.existsSync(path.join(w.dir, 'mysite', 'plane', f)), `${runtime}: plane/${f}`);
      assert.ok(!fs.existsSync(path.join(w.dir, 'mysite', '.ddev', 'docker-compose.plane.yaml')), `${runtime}: no DDEV service`);
    } finally {
      removeTestDir(w.dir);
    }
  }
  // On DDEV the site's values are what they were: its own address, no port to add.
  const d = written('ddev', 'https://mysite.ddev.site');
  try {
    assert.strictEqual(d.calls, '', 'no call of the runtime layer on DDEV');
    const env = d.read('plane/env').split('\n');
    for (const line of ['DOMAIN_NAME=mysite.ddev.site', 'APP_PROTOCOL=https', 'SITE_ADDRESS=:80', 'WEB_URL=https://mysite.ddev.site', 'CORS_ALLOWED_ORIGINS=https://mysite.ddev.site']) assert.ok(env.includes(line), line);
    assert.ok(!env.some((l) => /^(APP|ADMIN|SPACE)_BASE_URL=/.test(l)), 'no other address on DDEV');
    assert.ok(fs.existsSync(path.join(d.dir, 'mysite', '.ddev', 'docker-compose.plane.yaml')));
  } finally {
    removeTestDir(d.dir);
  }
});

test('the services\' images are the same on every runtime, and Plane starts the same way', () => {
  const compose = read('scripts/docker-compose.plane.yaml');
  for (const [name, constant] of [['valkey', 'PLANE_VALKEY_IMAGE'], ['rabbitmq', 'PLANE_RABBITMQ_IMAGE'], ['minio', 'PLANE_STORE_IMAGE']]) {
    const image = (FUN.match(new RegExp(`^readonly ${constant}='([^']+)';$`, 'm')) || [])[1];
    assert.ok(image, constant);
    assert.match(compose, new RegExp(`\\n  ${name}:\\n    image: "${image.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"\\n`), `${name}: ${image} on DDEV too`);
  }
  // The README names each image, with its source and licence.
  const readme = read('README.md');
  for (const constant of ['PLANE_VALKEY_IMAGE', 'PLANE_RABBITMQ_IMAGE', 'PLANE_STORE_IMAGE']) {
    const image = (FUN.match(new RegExp(`^readonly ${constant}='([^']+)';$`, 'm')) || [])[1] as string;
    assert.ok(readme.includes(`| \`${image}\` |`), `the README lists ${image}`);
  }
  assert.match(readme, /\[pgsty\/silo\]\(https:\/\/github\.com\/pgsty\/silo\), a fork of MinIO maintained by PGSTY, AGPL-3\.0/, 'the store\'s source and licence');
  const serve = read('scripts/plane-serve.sh');
  assert.match(serve, /^set -a\n# shellcheck disable=SC1091\n\. "\$\{here\}\/env" \|\| exit 1\nset \+a$/m, 'the site\'s values in its environment');
  assert.match(serve, /^export XDG_DATA_HOME=\/app\/var\/data XDG_CONFIG_HOME=\/app\/var\/data$/m, 'the proxy\'s files in a folder the host user owns');
  assert.match(serve, /^exec sh "\$\{here\}\/plane-start\.sh"$/m, 'then the same start as on DDEV');
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
  assert.match(FUN, /ddev exec "set -a ; \. \/var\/www\/html\/\$\{PLANE_FILES\}\/env ; set \+a ; cd \/app\/backend && \$\{1\}"/, 'elsewhere in the web container, with the site\'s values');
  assert.match(FUN, /python manage\.py shell -c \\"exec\(open\('\$\(plane_scripts_dir\)\/plane-site\.py'\)\.read\(\)\)\\"/, 'the site script through Django\'s own shell');
  assert.match(FUN, /if \[ "\$\(plane_runtime\)" = 'ddev' \] ; then echo '\/opt\/webship' ; else echo "\/var\/www\/html\/\$\{PLANE_FILES\}" ; fi/, 'read from where each runtime has it');
  assert.match(FUN, /if \[ "\$\(plane_runtime\)" = 'ddev' \] ; then echo 'http:\/\/plane:80' ; else echo "http:\/\/127\.0\.0\.1:\$\{PLANE_SERVE_PORT\}" ; fi/, 'Plane asked where it answers');
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
  assert.match(told, /--runtime docker/);
  assert.match(told, /--runtime kubernetes/);
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
