#!/usr/bin/env bash

# Installed by the Plane plugin (plugins.sh --install plane); __WORKSPACE__ is the workspace it was installed into.
#
# A Plane site of this folder: what it is and its accounts; --run one of Plane's own commands in its container;
# --add-users and --cancel-users the default accounts; --sample-content the sample content; --tidy what a stopped test
# run left; --connect the dashboard's Plane to this site.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.__WORKSPACE__.settings.yml);

ARGPARSE_DESCRIPTION="A Plane site of __WORKSPACE__: what it is, its accounts, Plane's own commands"
# The args file comes with the plugin: core/scripts/plugins/plane/ is where plugins.sh --install puts it.
source ${WORKSPACE_SCRIPTS}/plugins/plane/args/arg-plane-cli.sh || exit 1 ;

shift $#;

plane_cli_tool ;
