#!/usr/bin/env bash

# workspace-name: Plane (project and work management)

# Installed by the Plane plugin (plugins.sh --install plane); __WORKSPACE__ is the workspace it was installed into.
#
# Build a Plane site (Community Edition) in containers from Plane's all-in-one image, on the project's own PostgreSQL,
# with Valkey, RabbitMQ and an S3 store beside it: on DDEV at https://<name>.ddev.site. With --install the workspace
# account is the instance's administrator; with --add-users the default accounts are members of the workspace webship
# and its project Webship site; with --sample-content its work items, its cycle Sprint 1 and a comment.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.__WORKSPACE__.settings.yml);

# Distribution.
distribution_name="plane";
distribution_title="Plane";

ARGPARSE_DESCRIPTION="Build a ${distribution_title} site in __WORKSPACE__"
# The args file comes with the plugin: core/scripts/plugins/plane/ is where plugins.sh --install puts it.
source ${WORKSPACE_SCRIPTS}/plugins/plane/args/arg-plane.sh || exit 1 ;

shift $#;

plane_build ;
