#!/usr/bin/env bash

# Plane for the Webship Workspace: build a site of Plane (the open-source project and work management software,
# Community Edition) from its all-in-one image, run Plane's own commands in its container, add its default accounts and
# their memberships of a sample workspace and project, add its sample content, and wire its step pack into the testing
# setup.
#
# Placed by `plugins.sh --install plane` in core/scripts/plugins/plane/functions/, where bootstrap sources it after the
# core's own functions. Everything runs in containers, never on the host:
#   - DDEV (the default): Plane's all-in-one image (its proxy, web app, admin, space, API, live server and workers) is a
#     service of a generic project, on the project's own PostgreSQL (the db service), with Valkey, RabbitMQ and an S3
#     store (MinIO) as services beside it, at https://<name>.ddev.site; the project's web container keeps the mail
#     catcher.
#   - Docker Compose, Podman and Kubernetes (--runtime docker, podman, kubernetes): Plane's all-in-one image is the web
#     container's (rt_stack image), run as the host user (rt_web_build, plane-serve.sh, rt_serve), on the project's
#     PostgreSQL, with Valkey, RabbitMQ and the store as the project's own services (rt_service, webship/workspace#900);
#     at http://127.0.0.1:<port>, or on Kubernetes (kind) at the node's address and a NodePort.
# The stack is heavy: the builder asks for 4 GB of free memory before it starts. Lando and Docksal are not proven yet:
# asked for one, the builder says so and changes nothing.
# The site's accounts and content go through Django's own shell in Plane's container (plane-site.py), its input never
# on a command line.
#
# The container tool has no project type for Plane, so a site of this plugin is recognised by a file on DDEV
# (.ddev/config.plane.yaml, written by the builder) and by the plugin's claim on the other runtimes (rt_claim).
# Four names are the ones the core's tools look for:
#   set_plane_users          the default accounts                          (cmd-tools-add-users.sh <project> plane)
#   add_plane_users          make them, and their memberships              (the same tool, and --add-users of the builder)
#   cancel_plane_users       keep them from logging in                     (cmd-tools-cancel-users.sh <project> plane)
#   testing_configure_plane  the step pack in the testing stack            (cmd-tools-testing.sh <project>)

# The step pack a site is tested with, and the release line it is required at.
readonly PLANE_STEPS_PACKAGE='@webship-js/plane-steps';
readonly PLANE_STEPS_VERSION='^2.0.0';

# The release the builder runs when none is asked for (a tag of the all-in-one image).
readonly PLANE_DEFAULT_RELEASE='v1.5.1';

# The sample workspace (its slug) and project (its identifier and name) the default accounts are members of, and the
# folder of a site with the plugin's scripts and the site's own values (its container reads them at /opt/webship).
readonly PLANE_WORKSPACE='webship';
readonly PLANE_PROJECT='WEB';
readonly PLANE_PROJECT_NAME='Webship site';
readonly PLANE_FILES='plane';

# The free memory a build asks for, in MB: the all-in-one image runs a dozen processes, beside PostgreSQL, Valkey,
# RabbitMQ and the store.
readonly PLANE_MEMORY_MB=4096;

# The images of Plane's services, pinned and by their whole names (docker-compose.plane.yaml names the same on DDEV):
# its cache, its queue and its S3 store.
readonly PLANE_VALKEY_IMAGE='docker.io/valkey/valkey:7.2.11-alpine';
readonly PLANE_RABBITMQ_IMAGE='docker.io/library/rabbitmq:3.13.6-alpine';
readonly PLANE_STORE_IMAGE='docker.io/pgsty/silo:RELEASE.2026-09-16T00-00-00Z';

# The port Plane's own proxy listens on in the web container, on a runtime other than DDEV (rt_serve).
readonly PLANE_SERVE_PORT=8080;

# How many logins Plane allows from one address on a site the builder makes (--login-limit, or site_plane_login_limit
# of the folder's settings): a dev and test setting. Plane's own default is 10/minute; a test suite logs in more often
# than a person. A Plane the dashboard is connected to with --connect keeps its own: nothing here touches it.
readonly PLANE_LOGIN_LIMIT='100/minute';

# The default accounts, the ones a scenario logs in as: an Admin of the sample workspace and project (owner), a Member
# (member), a Guest (reader), and an account with no membership (stranger), whom the project is refused. Plane logs in
# by e-mail address. Accounts are configuration, made once on the site; a test suite never creates or deletes one. The
# workspace account the builder makes with --install is the instance's administrator and is not in this list.
function set_plane_users() {
  users=(owner member reader stranger);
  local user ;
  for user in "${users[@]}" ; do
    printf -v "user_${user}_name" '%s' "${user}" ;
    printf -v "user_${user}_mail" '%s' "${user}@example.com" ;
    printf -v "user_${user}_password" '%s' 'dD.123123ddd' ;
    printf -v "user_${user}_fullname" '%s' "${user^} Test" ;
  done
  user_owner_role='Admin' ;
  user_member_role='Member' ;
  user_reader_role='Guest' ;
  user_stranger_role='' ;
}

# The runtime of the project in this folder, or of a new build (--runtime, else the workspace's setting, else DDEV).
# A core without the runtime layer has DDEV only.
function plane_runtime() {
  if declare -f runtime_of > /dev/null ; then runtime_of "$@" ; else echo 'ddev' ; fi
}

# The address of the site in this folder (or of a new build named PROJECT_NAME, on DDEV); on another runtime the one
# the runtime gives it.
function plane_url() {
  if [ "$(plane_runtime)" != 'ddev' ] && declare -f rt_url > /dev/null ; then rt_url ; return ; fi
  echo "https://${1:-${PROJECT_NAME}}.ddev.site" ;
}

# Is this folder a Plane site of this plugin? On DDEV the builder leaves .ddev/config.plane.yaml in it; on another
# runtime the project carries the plugin's claim.
function plane_is_project() {
  local project_path="$1" ;
  [ -f "${project_path}/.ddev/config.plane.yaml" ] && return 0 ;
  if declare -f rt_is_platform > /dev/null ; then rt_is_platform "${project_path}" plane ; return $? ; fi
  return 1 ;
}

# Go to the project a tool was asked about, or say why not.
function plane_enter_project() {
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}";
  if [ ! -d "${project_path}" ] ; then
    echo "No project ${PROJECT_NAME} in ${WORKSPACE_ROOT}/${doc_name}." ;
    return 1 ;
  fi
  if ! plane_is_project "${project_path}" ; then
    echo "${doc_name}/${PROJECT_NAME} is not a Plane site of this plugin." ;
    return 1 ;
  fi
  plane_refresh_files "${project_path}" || return 1 ;
  cd "${project_path}" || return 1 ;
}

# The site's copy of the plugin's scripts (plane/), brought up to the installed plugin's, so a plugin updated with
# --install reaches the sites built before it. The site's own values (plane/*.env) are left as they are.
function plane_refresh_files() {
  local project_path="$1" from="${WORKSPACE_SCRIPTS}/plugins/plane" f ;
  [ -d "${project_path}/${PLANE_FILES}" ] || return 0 ;
  for f in plane-site.py plane-start.sh plane-serve.sh ; do
    if [ -f "${from}/${f}" ] && ! cmp -s "${from}/${f}" "${project_path}/${PLANE_FILES}/${f}" ; then
      cp "${from}/${f}" "${project_path}/${PLANE_FILES}/${f}" || return 1 ;
    fi
  done
}

# A value of the site's own values (plane/env), never printed by the tools: PLANE_RELEASE.
function plane_setting() {
  sed -n "s/^$1=\\(.*\\)\$/\\1/p" "${2:-.}/${PLANE_FILES}/env" 2>/dev/null | head -n 1 ;
}

# A value made for this site only: letters and digits.
function plane_secret() {
  head -c 200 /dev/urandom | base64 -w0 | tr -dc 'A-Za-z0-9' | head -c "${1:-64}" ;
}

# The free memory of this machine, in MB (what the kernel says is available).
function plane_free_memory() {
  awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo 2>/dev/null ;
}

# The values of Plane's services (plane/rabbitmq.env, plane/minio.env, which only you can read): the keys of its queue
# and its store, of this site only. Written first, so the services find them on every runtime (Kubernetes keeps a copy
# of each as a Secret of the project when the project is written).
function plane_write_service_env() {
  local project_path="$1" mq store_user store_key ;
  mq="$(plane_secret 32)" ; store_user="plane$(plane_secret 12)" ; store_key="$(plane_secret 40)" ;
  mkdir -p "${project_path}/${PLANE_FILES}" || return 1 ;
  ( umask 077 && cat > "${project_path}/${PLANE_FILES}/rabbitmq.env" <<ENVEOF
RABBITMQ_DEFAULT_USER=plane
RABBITMQ_DEFAULT_PASS=${mq}
RABBITMQ_DEFAULT_VHOST=plane
ENVEOF
  cat > "${project_path}/${PLANE_FILES}/minio.env" <<ENVEOF
MINIO_ROOT_USER=${store_user}
MINIO_ROOT_PASSWORD=${store_key}
ENVEOF
  ) ;
}

# Write the project's files and the plugin's scripts. On DDEV Plane's services (.ddev/docker-compose.plane.yaml), its
# image in .ddev/.env and the claim (.ddev/config.plane.yaml). On another runtime (Docker Compose, Podman, Kubernetes)
# the claim, the all-in-one image as the web container's, run as the host user, the cache, the queue and the store as
# the project's own services, and Plane's start (rt_claim, rt_stack, rt_web_build, rt_service, rt_serve).
function plane_write_config() {
  local project_path="$1" release="$2" runtime="${3:-ddev}" ;
  local from="${WORKSPACE_SCRIPTS}/plugins/plane" f ;
  for f in docker-compose.plane.yaml plane-site.py plane-start.sh plane-serve.sh ; do
    if [ ! -f "${from}/${f}" ] ; then
      echo "${f} is not in ${from}: install the plugin (plugins.sh --install plane)." ;
      return 1 ;
    fi
  done
  mkdir -p "${project_path}/${PLANE_FILES}" || return 1 ;
  cp "${from}/plane-site.py" "${from}/plane-start.sh" "${from}/plane-serve.sh" "${project_path}/${PLANE_FILES}/" || return 1 ;

  if [ "${runtime}" = 'ddev' ] ; then
    cp "${from}/docker-compose.plane.yaml" "${project_path}/.ddev/docker-compose.plane.yaml" || return 1 ;
    printf 'PLANE_IMAGE=%s\n' "docker.io/makeplane/plane-aio-community:${release}" > "${project_path}/.ddev/.env" || return 1 ;
    cat > "${project_path}/.ddev/config.plane.yaml" <<YAMLEOF
# Plane in this project: its services (docker-compose.plane.yaml), its image in .env, the site's own values in
# ../plane/*.env. Written by the Plane builder of the workspace; build again rather than editing.
web_environment:
  - PLANE_RELEASE=${release}
YAMLEOF
    return 0 ;
  fi

  # Another runtime: the all-in-one image is the web container's, and the stack starts it as the host user.
  ( cd "${project_path}" \
    && rt_claim plane \
    && rt_stack image "docker.io/makeplane/plane-aio-community:${release}" \
    && rt_web_build plane <<'DOCKEREOF'
# Plane's all-in-one image runs as the host user here (plane-serve.sh, rt_serve): its supervisor runs without the user
# its settings name (root), and what Plane writes while it runs belongs to the host user, www-data with the host's UID
# by now: its settings file and its folder, the backend's static files and its scheduler's, its logs and its proxy's
# files. The image declares /app/logs and /app/data as volumes, which a build cannot change on every engine (Podman's
# keeps them as the image has them, root's): the logs and the proxy's files go to /app/var instead.
RUN conf=/etc/supervisor/conf.d/supervisor.conf \
  && sed -i '/^user=root$/d' "${conf}" \
  && if grep -q '^user=' "${conf}" ; then echo "Plane's supervisor names a user the Plane plugin does not know: build this release on DDEV, or update the plugin." >&2 ; exit 1 ; fi \
  && sed -i 's#/app/logs/#/app/var/logs/#g' "${conf}" \
  && if grep -q '/app/logs' "${conf}" ; then echo "Plane's supervisor writes its logs where the Plane plugin does not know: build this release on DDEV, or update the plugin." >&2 ; exit 1 ; fi \
  && mkdir -p /app/var/logs/access /app/var/logs/error /app/var/data \
  && chown www-data:www-data /app /app/plane.env \
  && chown -R www-data:www-data /app/var /app/backend
DOCKEREOF
  ) || return 1 ;
  ( cd "${project_path}" \
    && rt_service valkey "${PLANE_VALKEY_IMAGE}" --port 6379 \
    && rt_service rabbitmq "${PLANE_RABBITMQ_IMAGE}" --port 5672 --env-file "${PLANE_FILES}/rabbitmq.env" --volume /var/lib/rabbitmq \
    && rt_service minio "${PLANE_STORE_IMAGE}" --port 9000 --env-file "${PLANE_FILES}/minio.env" --volume /data \
      --command 'server /data --console-address ":9090"' \
    && rt_serve "${PLANE_SERVE_PORT}" "bash ${PLANE_FILES}/plane-serve.sh" ) || return 1 ;
}

# The site's own values (plane/env, which only you can read): the address, the project's database, the queue, the
# cache and the store with the keys of its services, and its secret keys.
function plane_write_env() {
  local project_path="$1" release="$2" base_url="$3" login_limit="${4:-${PLANE_LOGIN_LIMIT}}" runtime="${5:-ddev}" ;
  local host="${base_url#*://}" protocol="${base_url%%://*}" site_address=':80' urls='' mq store_user store_key ;
  host="${host%%/*}" ;
  mq="$(sed -n 's/^RABBITMQ_DEFAULT_PASS=//p' "${project_path}/${PLANE_FILES}/rabbitmq.env")" ;
  store_user="$(sed -n 's/^MINIO_ROOT_USER=//p' "${project_path}/${PLANE_FILES}/minio.env")" ;
  store_key="$(sed -n 's/^MINIO_ROOT_PASSWORD=//p' "${project_path}/${PLANE_FILES}/minio.env")" ;
  { [ -n "${mq}" ] && [ -n "${store_user}" ] && [ -n "${store_key}" ] ; } || { echo "The keys of Plane's services are not in ${PLANE_FILES}/: build again." ; return 1 ; } ;
  if [ "${runtime}" != 'ddev' ] ; then
    # Plane's proxy listens on the port the stack serves. Plane's own start sets its address from DOMAIN_NAME, which
    # takes no port: the address with its port is what the logins, the instance's admin and the published views come
    # back to.
    site_address=":${PLANE_SERVE_PORT}" ;
    urls="APP_BASE_URL=${base_url}"$'\n'"ADMIN_BASE_URL=${base_url}"$'\n'"SPACE_BASE_URL=${base_url}"$'\n' ;
  fi
  ( umask 077 && cat > "${project_path}/${PLANE_FILES}/env" <<ENVEOF
# The values of this Plane site, made by the Plane builder of the workspace: its secret keys and the keys of its queue
# and its store are of this site only. Read by Plane's container and by the plugin's scripts; never printed.
PLANE_RELEASE=${release}
DOMAIN_NAME=${host%%:*}
APP_DOMAIN=${host%%:*}
APP_PROTOCOL=${protocol}
SITE_ADDRESS=${site_address}
WEB_URL=${base_url}
CORS_ALLOWED_ORIGINS=${base_url}
${urls}DATABASE_URL=postgresql://db:db@db:5432/db
REDIS_URL=redis://valkey:6379/
AMQP_URL=amqp://plane:${mq}@rabbitmq:5672/plane
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=${store_user}
AWS_SECRET_ACCESS_KEY=${store_key}
AWS_S3_BUCKET_NAME=uploads
AWS_S3_ENDPOINT_URL=http://minio:9000
SECRET_KEY=$(plane_secret 64)
LIVE_SERVER_SECRET_KEY=$(plane_secret 64)
GUNICORN_WORKERS=1
# The logins Plane allows from one address (--login-limit): a dev and test setting, as a test suite logs in more often
# than a person; Plane's own default is 10/minute. plane-start.sh puts it into the image's own settings file.
AUTHENTICATION_RATE_LIMIT=${login_limit}
ENVEOF
  ) ;
}

# Run a command line in Plane's container, in its backend folder (/app/backend), with the site's values; what is piped
# in reaches it. On DDEV Plane's own service; on another runtime the web container, as the host user.
function plane_exec() {
  if [ "$(plane_runtime)" = 'ddev' ] ; then
    ddev exec -s plane "sh -c $(printf '%q' "cd /app/backend && ${1}")" ;
  else
    ddev exec "set -a ; . /var/www/html/${PLANE_FILES}/env ; set +a ; cd /app/backend && ${1}" ;
  fi
}

# The folder the plugin's scripts are read from in Plane's container.
function plane_scripts_dir() {
  if [ "$(plane_runtime)" = 'ddev' ] ; then echo '/opt/webship' ; else echo "/var/www/html/${PLANE_FILES}" ; fi
}

# Where Plane answers inside the project's network: on DDEV its own service, from the web container; on another
# runtime its proxy, in the web container itself.
function plane_inside_url() {
  if [ "$(plane_runtime)" = 'ddev' ] ; then echo 'http://plane:80' ; else echo "http://127.0.0.1:${PLANE_SERVE_PORT}" ; fi
}

# The answer of Plane's instance endpoint (200 once its API serves and reaches its database), asked inside the
# project's network.
function plane_probe() {
  ddev exec "curl -s -o /dev/null -m 10 -w '%{http_code}' $(plane_inside_url)/api/instances/" < /dev/null 2>/dev/null | tr -d '\r' | tail -1 ;
}

# Whether the site's instance answers that it is set up (a visitor gets the login form, not the setup's "Get started"),
# asked inside the project's network.
function plane_setup_done() {
  ddev exec "curl -s -m 10 $(plane_inside_url)/api/instances/" < /dev/null 2>/dev/null | tr -d '\r' | grep -q '"is_setup_done": *true' ;
}

# Wait until the site answers, in the project's folder: up to fifteen minutes, as the first start migrates the database.
function plane_wait() {
  local attempt code="" ;
  for attempt in $(seq 1 300) ; do
    code="$(plane_probe)" ;
    [ "${code}" == '200' ] && return 0 ;
    sleep 3 ;
  done
  echo "Plane did not answer (its instance endpoint: ${code:-none}); the end of its log:" ;
  if [ "$(plane_runtime)" = 'ddev' ] ; then ddev logs -s plane --tail 40 < /dev/null 2>/dev/null ; else ddev logs < /dev/null 2>/dev/null | tail -n 40 ; fi
  return 1 ;
}

# Run verbs of plane-site.py (defaults, accounts, content, tidy, list, token, version) with Django's own shell in
# Plane's container. A payload (accounts, passwords) travels on the input, never on a command line.
function plane_site() {
  plane_exec "PLANE_VERBS='$*' python manage.py shell -c \"exec(open('$(plane_scripts_dir)/plane-site.py').read())\"" ;
}

# The release the site runs, as Plane says it.
function plane_version() {
  ( cd "${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" 2>/dev/null && plane_site version < /dev/null 2>/dev/null ) | tr -d '\r' | sed -n 's/^VERSION //p' | tail -n 1 ;
}

# Rows of accounts for plane-site.py, as the base64 of its JSON list: "login|mail|password|fullname|admin|role|action"
# lines in PLANE_ROWS, which travel to Python in the environment, never on a command line.
function plane_accounts_payload() {
  PLANE_ROWS="$1" python3 -c '
import base64, json, os
rows = []
for line in os.environ["PLANE_ROWS"].split("\x1e"):
    if not line:
        continue
    login, mail, password, fullname, admin, role, action = line.split("\x1f")
    rows.append({"login": login, "mail": mail, "password": password, "fullname": fullname, "admin": admin == "yes",
                 "role": role, "action": action})
print(base64.b64encode(json.dumps(rows).encode()).decode())' ;
}

# Build a Plane site from nothing: the project and Plane, its instance set up; with --install the workspace account as
# the instance's administrator; with --add-users the default accounts, members of the sample workspace and project; with
# --sample-content the project's work items, its cycle and a comment the step pack is tested on.
function plane_build() {
  trim_project_name ;
  local release="${PLANE_VERSION:-${site_plane_release:-${PLANE_DEFAULT_RELEASE}}}" ;
  [[ "${release}" =~ ^[0-9] ]] && release="v${release}" ;
  local login_limit="${LOGIN_LIMIT:-${site_plane_login_limit:-${PLANE_LOGIN_LIMIT}}}" ;
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" ;
  local runtime ; runtime="$(cd "${WORKSPACE_ROOT}/${doc_name}" && plane_runtime)" ;

  case "${runtime}" in
    ddev|docker|podman|kubernetes) ;;
    *) echo "Plane builds on DDEV, Docker Compose, Podman and Kubernetes for now (--runtime ddev, docker, podman or kubernetes), not on ${runtime}: that runtime is not proven for it yet. Nothing was changed." ; exit 1 ;;
  esac
  if [ "${runtime}" != 'ddev' ] && ! declare -f rt_service > /dev/null ; then
    echo "--runtime ${runtime} needs a Webship Workspace whose projects carry services of their own (rt_service, webship/workspace#900): update the workspace, or build on DDEV. Nothing was changed." ;
    exit 1 ;
  fi
  if ! [[ "${release}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] ; then
    echo "--release takes a release of Plane (v1.5.1), not ${release}. Nothing was changed." ;
    exit 1 ;
  fi
  if ! [[ "${login_limit}" =~ ^[1-9][0-9]{0,5}/(second|minute|hour|day)$ ]] ; then
    echo "--login-limit takes a number of logins and a period (100/minute, 10/minute, 500/hour), not ${login_limit}. Nothing was changed." ;
    exit 1 ;
  fi
  if [ "${ADD_USERS}" == 'yes' ] && [ "${INSTALL}" != 'yes' ] ; then
    echo "--add-users needs --install: the default accounts go into the site --install sets up." ;
    exit 1 ;
  fi
  if [ "${SAMPLE_CONTENT}" == 'yes' ] && [ "${ADD_USERS}" != 'yes' ] ; then
    echo "--sample-content needs --add-users: the sample project's members are the default accounts." ;
    exit 1 ;
  fi
  if [ ${#PROJECT_NAME} -gt 40 ] || ! [[ "${PROJECT_NAME}" =~ ^[a-z0-9][a-z0-9-]*$ ]] ; then
    echo "The project name ${PROJECT_NAME} must be small letters, digits and dashes (its address and its containers take it). Nothing was changed." ;
    exit 1 ;
  fi
  if [ "${INSTALL}" == 'yes' ] && [ ${#account_pass} -lt 8 ] ; then
    echo "The workspace account's password (core/config/settings.yml) has fewer than eight characters, which Plane asks of a password: --install makes it an account of the site. Nothing was changed." ;
    exit 1 ;
  fi
  local free ; free="$(plane_free_memory)" ;
  if [ -n "${free}" ] && [ "${free}" -lt "${PLANE_MEMORY_MB}" ] ; then
    echo "Plane needs about ${PLANE_MEMORY_MB} MB of free memory (its all-in-one image, PostgreSQL, Valkey, RabbitMQ and its store); this machine has ${free} MB available now. Stop a site you do not need, then build again. Nothing was changed." ;
    exit 1 ;
  fi

  cd ${WORKSPACE_ROOT}/${doc_name} || exit 1 ;

  # A project of the same name goes first, with its containers and its volumes (Plane's database, queue and store).
  drop_database ;
  rm -rf "${PROJECT_NAME:?}" ;
  mkdir -p "${PROJECT_NAME}" ;
  cd "${project_path}" || exit 1 ;

  # A generic project on PostgreSQL 15, the release Plane's own stack runs.
  if [ "${runtime}" = 'ddev' ] ; then
    ddev config --project-type=generic --project-name=${PROJECT_NAME} --database=postgres:15 \
      --nodejs-version=$(ddev_nodejs_version) < /dev/null || exit 1 ;
  else
    # The runtime's own project: Docker Compose, Podman or Kubernetes, through the runtime layer.
    ddev config --project-type=generic --webserver-type=generic --project-name=${PROJECT_NAME} --database=postgres:15 --auto < /dev/null || exit 1 ;
  fi
  plane_write_service_env "${project_path}" || exit 1 ;
  plane_write_config "${project_path}" "${release}" "${runtime}" || exit 1 ;
  local base_url ; base_url="$(plane_url)" ;
  plane_write_env "${project_path}" "${release}" "${base_url}" "${login_limit}" "${runtime}" || exit 1 ;

  if [ "${runtime}" = 'ddev' ] ; then
    echo "Starting the project and Plane ${release}: its images are about 800 MB the first time, and the first start migrates the database." ;
  else
    echo "Starting the project and Plane ${release}: its images are about 800 MB the first time, the project's web image is built from Plane's, and the first start migrates the database." ;
  fi
  ddev_up start -y < /dev/null || exit 1 ;
  plane_wait || exit 1 ;

  # The instance set up: no sign-up screen, sign-ups closed, e-mail and password logins, no telemetry.
  plane_site defaults < /dev/null || { echo "Plane's instance could not be set up." ; exit 1 ; } ;
  # What a visitor meets: the login form. Plane keeps its answer for two hours, so a stale one would show the setup.
  plane_setup_done || { echo "Plane still answers that its instance is not set up: a visitor would get its setup (Get started), not the login form." ; exit 1 ; } ;

  if [ "${INSTALL}" == 'yes' ] ; then
    echo "Making the workspace account the instance's administrator." ;
    local rows ;
    rows="${account_name}"$'\x1f'"${account_mail:-${account_name}@example.com}"$'\x1f'"${account_pass}"$'\x1f'"${account_name^} Workspace"$'\x1f''yes'$'\x1f'$'\x1f'$'\x1e' ;
    plane_accounts_payload "${rows}" | plane_site accounts || { echo "The workspace account could not be made." ; exit 1 ; } ;
    if [ "${ADD_USERS}" == 'yes' ] ; then
      set_plane_users ;
      add_plane_users || exit 1 ;
      if [ "${SAMPLE_CONTENT}" == 'yes' ] ; then
        echo "Adding the sample content: the work items of ${PLANE_PROJECT_NAME}, its cycle Sprint 1 and a comment." ;
        ( cd "${project_path}" && plane_site content < /dev/null ) || exit 1 ;
      fi
      users=() ;
    fi
    echo "${doc_name} ${PROJECT_NAME} has been installed: Plane $(plane_version).";
    echo "The site: ${base_url}" ;
    echo "The workspace account logs in as ${account_mail:-${account_name}@example.com}, the instance's administrator (${base_url}/god-mode/)." ;
  else
    echo "${doc_name} ${PROJECT_NAME} is ready: Plane $(plane_version) at ${base_url}.";
    echo "Build it again with --install (and --add-users) for the workspace account and the default accounts.";
  fi

  if [ "${LAUNCH}" == 'yes' ] ; then
    ddev launch ;
  fi

  cd ${WORKSPACE_ROOT}/${doc_name};
}

# Make the default accounts, or give them back their names, passwords and memberships: each a member of the sample
# workspace and project in its role (Admin, Member, Guest), the stranger of none. The list is loaded by the caller
# (set_plane_users): the core's add_users, the builder, the tool.
function add_plane_users() {
  plane_enter_project || return 1 ;
  local user user_name user_mail user_password user_fullname user_role rows="" ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_mail="user_${user}_mail";
    user_password="user_${user}_password"; user_fullname="user_${user}_fullname"; user_role="user_${user}_role";

    echo " ---------------------------------------------------------------- ";
    echo "      User name: ${!user_name}";
    echo "      User mail: ${!user_mail}";
    echo "  User password: ${!user_password}";
    echo "      User role: ${!user_role:-no membership} of ${PLANE_PROJECT_NAME}";
    echo " ================================================================= ";
    rows="${rows}${!user_name}"$'\x1f'"${!user_mail}"$'\x1f'"${!user_password}"$'\x1f'"${!user_fullname}"$'\x1f''no'$'\x1f'"${!user_role}"$'\x1f'$'\x1e' ;
  done
  plane_accounts_payload "${rows}" | plane_site accounts ;
  local status=$? ;
  cd ${WORKSPACE_ROOT}/${doc_name};
  return ${status} ;
}

# Keep the default accounts from logging in (their work stays), never the workspace account.
function cancel_plane_users() {
  plane_enter_project || return 1 ;
  local user user_name user_mail rows="" ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_mail="user_${user}_mail";
    echo " ---------------------------------------------------------------- ";
    echo "      User name: ${!user_name}";
    echo "      User mail: ${!user_mail}";
    echo " ================================================================= ";
    rows="${rows}${!user_name}"$'\x1f'"${!user_mail}"$'\x1f'$'\x1f'$'\x1f''no'$'\x1f'$'\x1f''lock'$'\x1e' ;
  done
  plane_accounts_payload "${rows}" | plane_site accounts ;
  local status=$? ;
  cd ${WORKSPACE_ROOT}/${doc_name};
  return ${status} ;
}

# Point the dashboard's Plane (core/config/plugin.plane.settings.yml) at this site, as an account of it: a new API key
# of that account in the sample workspace (made through Django's shell in Plane's container) goes into the settings
# file, which only you can read, never on a screen or in a log; with it the site's address, and the sample project as
# the default one when none was set.
function plane_connect() {
  local login="$1" settings="${WORKSPACE_CONFIG}/plugin.plane.settings.yml" out token url ;
  if ! [[ "${login}" =~ ^[A-Za-z0-9._@-]+$ ]] ; then echo "--connect takes the login or e-mail address of an account of the site." ; return 1 ; fi
  if [ ! -f "${settings}" ] ; then echo "No ${settings}: install the plugin first (plugins.sh --install plane)." ; return 1 ; fi
  out="$(printf '%s\n' "${login}" | plane_site token 2>/dev/null)" ;
  token="$(printf '%s\n' "${out}" | tr -d '\r' | sed -n 's/^TOKEN //p' | tail -n 1)" ;
  out='' ;
  if ! [[ "${token}" =~ ^[A-Za-z0-9_-]{20,}$ ]] ; then echo "No API key could be made for ${login} (is it an active account and a member of the workspace ${PLANE_WORKSPACE}?)." ; return 1 ; fi
  url="$(plane_url)" ;
  PLANE_NEW_TOKEN="${token}" python3 - "${settings}" "${url}" "${PLANE_WORKSPACE}/${PLANE_PROJECT}" <<'PYEOF' || return 1
import os, re, sys
path, url, scope = sys.argv[1:4]
token = os.environ['PLANE_NEW_TOKEN']
text = open(path).read()
def put(text, key, value):
    line = '%s: %s' % (key, value)
    if re.search(r'^%s:.*$' % key, text, re.M):
        return re.sub(r'^%s:.*$' % key, lambda m: line, text, count=1, flags=re.M)
    return text.rstrip('\n') + '\n' + line + '\n'
text = put(text, 'url', url)
text = put(text, 'token', token)
if not re.search(r'^default_scope:[ \t]*[^ \t\n"]', text, re.M) and not re.search(r'^default_scope:[ \t]*"[^"]', text, re.M):
    text = put(text, 'default_scope', scope)
fd = os.open(path + '.new', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write(text)
os.replace(path + '.new', path)
PYEOF
  token='' ;
  echo "The dashboard reads the work items of ${url} as ${login} now: a new API key of that account is in ${settings} (not shown here), and ${PLANE_WORKSPACE}/${PLANE_PROJECT} is the default project when none was set." ;
}

# What cmd-tools-plane-cli.sh does: the first of --run, --add-users, --cancel-users, --sample-content, --tidy,
# --connect that was asked for; with none of them, what the site is and its accounts.
function plane_cli_tool() {
  trim_project_name ;
  plane_enter_project || exit 1 ;

  if [ "$(plane_runtime)" = 'ddev' ] ; then
    ddev describe -j 2>/dev/null | grep -q '"status":"running"' || ddev start -y < /dev/null || exit 1 ;
  else
    # A site that answers is left as it is: on Podman a start makes every container of the project again.
    [ "$(plane_probe)" = '200' ] || ddev start < /dev/null > /dev/null 2>&1 || ddev start -y < /dev/null || exit 1 ;
  fi
  plane_wait > /dev/null || { echo "Plane of ${PROJECT_NAME} does not answer; start it again (ddev restart in ${doc_name}/${PROJECT_NAME})." ; exit 1 ; } ;

  if [ ! "${RUN}" == '_none_' ] ; then
    # Plane's own commands (python manage.py <command>), in its container.
    plane_exec "python manage.py ${RUN}" < /dev/null ;
    exit $? ;
  fi

  set_plane_users ;
  if [ "${ADD_USERS}" == 'yes' ] ; then
    add_plane_users ;
  elif [ "${CANCEL_USERS}" == 'yes' ] ; then
    cancel_plane_users ;
  elif [ "${SAMPLE_CONTENT}" == 'yes' ] ; then
    plane_site content list < /dev/null ;
  elif [ "${TIDY}" == 'yes' ] ; then
    # What a test run that was stopped half way left: its work items ("Webship test …"), with their comments.
    plane_site tidy list < /dev/null ;
  elif [ "${CONNECT}" != '_none_' ] ; then
    plane_connect "${CONNECT}" ;
  else
    echo "${doc_name}/${PROJECT_NAME}: Plane $(plane_version)" ;
    echo "  the site:  $(plane_url)" ;
    echo "" ;
    plane_site list < /dev/null ;
  fi
  cd ${WORKSPACE_ROOT}/${doc_name};
}

# The step pack in the testing stack of a Plane site. The core's testing_configure calls this in the project
# folder once webship-js is scaffolded and before the dependencies are installed; for a project that is not one of
# this plugin's it changes nothing.
#
# It adds the pack to package.json, lists its step definitions in cucumber.js after webship-js's own, gives cucumber.js
# the tags that keep the pack's assertions that must fail out of a normal run, the account that prepares and removes
# test content (manager), the project the steps work in when they name none, and the users registry of the default
# accounts (a handle a scenario reads, mapped to an account; never the workspace account), and writes a first feature
# when the project has none of its own. Every part is skipped when it is already there, so a second run adds what the
# first missed and never resets a suite.
function testing_configure_plane() {
  local project_path="$1";
  plane_is_project "${project_path}" || return 0 ;
  if [ ! -f "${project_path}/cucumber.js" ] || [ ! -f "${project_path}/package.json" ] ; then
    echo "  Plane: cucumber.js is not here yet — run the testing setup again once webship-js is scaffolded." ;
    return 1 ;
  fi

  echo "Adding the Plane step pack (${PLANE_STEPS_PACKAGE} ${PLANE_STEPS_VERSION}).";
  set_plane_users ;
  # Plane logs in with the e-mail address, and shows the display name (the login).
  local registry="" user user_name user_mail user_password ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_mail="user_${user}_mail"; user_password="user_${user}_password";
    registry="${registry}${user}|${!user_mail}|${!user_password}|${!user_name}"$'\n' ;
  done

  local address ;
  address="$(cd "${project_path}" && plane_url "$(sed -n 's/^name:[[:space:]]*"\{0,1\}\([A-Za-z0-9._-]*\)"\{0,1\}[[:space:]]*$/\1/p' .ddev/config.yaml 2>/dev/null | head -n 1)")" ;

  python3 - "${project_path}" "${PLANE_STEPS_PACKAGE}" "${PLANE_STEPS_VERSION}" 'PLANE' "${registry}" "${address}" "${PLANE_WORKSPACE}" "${PLANE_PROJECT}" <<'PYEOF' || return 1
import json, re, sys

project, pack, version, prefix, registry, address, workspace, sample = sys.argv[1:9]

# package.json: the pack as a dev dependency, at the release line this plugin was proven on.
pkg_file = project + '/package.json'
pkg = json.load(open(pkg_file))
if pack not in pkg.get('dependencies', {}) and pack not in pkg.get('devDependencies', {}):
    pkg.setdefault('devDependencies', {})[pack] = version
    open(pkg_file, 'w').write(json.dumps(pkg, indent=4) + '\n')
    print('  package.json: %s %s' % (pack, version))

cucumber_file = project + '/cucumber.js'
src = open(cucumber_file).read()
before = src

if ('node_modules/%s/' % pack) not in src:
    line = "'node_modules/%s/tests/step-definitions/**/*.js'," % pack
    core = re.search(r"^([ \t]*)'node_modules/webship-js/tests/step-definitions/[^']*',.*$", src, re.M)
    opening = re.search(r"^([ \t]*)require:[ \t]*\[[ \t]*$", src, re.M)
    if core:
        src = src[:core.end()] + '\n' + core.group(1) + line + src[core.end():]
    elif opening:
        src = src[:opening.end()] + '\n' + opening.group(1) + '  ' + line + src[opening.end():]
    else:
        sys.exit("  cucumber.js has no require list this can add to. Add this line to it:\n    " + line)
    print('  cucumber.js: the step definitions of %s' % pack)

if not re.search(r"^[ \t]*tags:", src, re.M):
    default = re.search(r"^([ \t]*)default:[ \t]*\{[ \t]*$", src, re.M)
    if default:
        pad = default.group(1) + '  '
        block = [
            pad + "// The pack's assertions that must fail are no part of a normal run.",
            pad + "tags: process.env.CUCUMBER_TAGS || 'not @wip and not @must-fail',",
        ]
        src = src[:default.end()] + '\n' + '\n'.join(block) + src[default.end():]
        print('  cucumber.js: the tags that keep the assertions that must fail out of a normal run')

world = re.search(r"^([ \t]*)worldParameters:[ \t]*\{[ \t]*$", src, re.M)
if not world:
    sys.exit("  cucumber.js has no worldParameters block to add the users registry to.")
pad = world.group(1) + '  '
additions = []
if not re.search(r"^[ \t]*manager:", src, re.M):
    additions += [
        pad + "// The account that prepares and removes test content through the site's API: an Admin of the project.",
        pad + "manager: process.env.MANAGER || 'owner',",
    ]
if not re.search(r"^[ \t]*workspace:", src, re.M):
    additions += [
        pad + "// The workspace the projects are in (its slug, the part of its address after the host).",
        pad + "workspace: process.env.WORKSPACE || '%s'," % workspace,
    ]
if not re.search(r"^[ \t]*project:", src, re.M):
    additions += [
        pad + "// The project the steps work in when they name none (its identifier).",
        pad + "project: process.env.PROJECT || '%s'," % sample,
    ]
if not re.search(r"^[ \t]*users:[ \t]*\{", src, re.M):
    rows = [r.split('|') for r in registry.splitlines() if r.strip()]
    additions += [
        pad + "// The users registry: a handle a scenario reads, mapped to an account of the site (the default accounts:",
        pad + "// cmd-tools-plane-cli.sh --add-users). Override one with %s_<HANDLE>_USER and %s_<HANDLE>_PASSWORD." % (prefix, prefix),
        pad + "users: {",
    ]
    for handle, mail, password, display in rows:
        env = '%s_%s' % (prefix, handle.upper())
        additions.append(pad + "  %s: { username: process.env.%s_USER || '%s', password: process.env.%s_PASSWORD || '%s', name: '%s' }," % (handle, env, mail, env, password, display))
    additions.append(pad + "},")
    print('  cucumber.js: the users registry (%s)' % ', '.join(r[0] for r in rows))
if additions:
    src = src[:world.end()] + '\n' + '\n'.join(additions) + src[world.end():]
    print('  cucumber.js: the managing account, the workspace and the project of the steps')

# The address the suite opens when LAUNCH_URL is not set: the placeholder of the scaffold becomes the site's.
placeholder = "process.env.LAUNCH_URL || 'http://localhost:8080'"
if placeholder in src:
    src = src.replace(placeholder, "process.env.LAUNCH_URL || '%s'" % address)
    print('  cucumber.js: the address of the site (%s)' % address)

if src != before:
    open(cucumber_file, 'w').write(src)
PYEOF

  # A first feature, when the project has none for the site yet.
  local feature="${WORKSPACE_SCRIPTS}/plugins/plane/site.feature" ;
  if [ -f "${feature}" ] && [ ! -f "${project_path}/tests/features/site.feature" ] ; then
    mkdir -p "${project_path}/tests/features" && cp "${feature}" "${project_path}/tests/features/site.feature" \
      && echo "  tests/features/site.feature: a first feature for the work items" ;
  fi

  # The scenarios log in as the default accounts and read the sample project: make sure the site has them, once it
  # answers again (installing the testing stack may restart the project, and Plane with it). Each part runs in the
  # project and says when it did not work: add_plane_users ends in the sites folder, so the sample content is asked for
  # in the project again (webship/workspace-plane#11).
  if ! ( cd "${project_path}" && plane_wait > /dev/null 2>&1 ) ; then
    echo "  Plane does not answer: is the site running (ddev start in ${project_path})? The default accounts and the sample content were not checked." ;
  elif ! ( cd "${project_path}" && add_plane_users > /dev/null 2>&1 ) ; then
    echo "  The default accounts could not be written (bash cmd-tools-plane-cli.sh <site> --add-users says why)." ;
  elif ! ( cd "${project_path}" && plane_site content < /dev/null > /dev/null 2>&1 ) ; then
    echo "  The sample content could not be written (bash cmd-tools-plane-cli.sh <site> --sample-content says why)." ;
  else
    echo "  the default accounts and the sample content are on the site (${users[*]})" ;
  fi
}
