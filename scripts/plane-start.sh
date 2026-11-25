#!/bin/sh
# The start of Plane's all-in-one container for a site of the Webship Workspace (the plugin's plane-start.sh, mounted at
# /opt/webship). The image starts from its own settings file, /app/plane.env: it copies some of the container's values
# into it (the address, the database, the queue, the store, the secret keys) and keeps its own defaults for the rest.
# The values a site sets that the image does not copy go into that file first, then the image's own start runs.
set -eu
cd /app
for key in AUTHENTICATION_RATE_LIMIT GUNICORN_WORKERS ; do
  value="$(printenv "${key}" || true)"
  [ -n "${value}" ] || continue
  if grep -q "^${key}=" plane.env ; then
    KEY="${key}" VALUE="${value}" awk 'index($0, ENVIRON["KEY"] "=") == 1 { print ENVIRON["KEY"] "=" ENVIRON["VALUE"]; next } { print }' plane.env > plane.env.tmp
    mv plane.env.tmp plane.env
  else
    printf '%s=%s\n' "${key}" "${value}" >> plane.env
  fi
done
exec /app/start.sh
