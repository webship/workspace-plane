#!/usr/bin/env bash
# Plane's own start on a runtime other than DDEV (Docker Compose, Podman, Kubernetes): the web container is Plane's
# all-in-one image with the workspace's layer, and runs this as the host user from the project's root (rt_serve), once
# the project's PostgreSQL takes connections. The site's values (plane/env, which only you can read) go into its
# environment, then plane-start.sh and the image's own start run, as on DDEV: its proxy listens on the port the stack
# serves (SITE_ADDRESS). Written by the Plane builder of the workspace; build again rather than editing.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 1
set -a
# shellcheck disable=SC1091
. "${here}/env" || exit 1
set +a
# The proxy keeps its own files (its instance's name, its locks) in a folder the host user owns.
export XDG_DATA_HOME=/app/data XDG_CONFIG_HOME=/app/data
exec sh "${here}/plane-start.sh"
