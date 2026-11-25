#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the Plane project in this folder.')
parser.add_argument('-r', '--run',
                    default="_none_",
                    help='Run one of Plane\'s own commands (python manage.py <command>) in its container. Example: --run "showmigrations db"')
parser.add_argument('-a', '--add-users',
                    action='store_true',
                    default=False,
                    help='Make the default accounts (owner, member, reader, stranger) and their memberships of the workspace webship and its project Webship site, or give them back their names, passwords and roles.')
parser.add_argument('-c', '--cancel-users',
                    action='store_true',
                    default=False,
                    help='Keep the default accounts from logging in: their work stays.')
parser.add_argument('-s', '--sample-content',
                    action='store_true',
                    default=False,
                    help='Add the sample content the step pack and the tracker are tested on, where it is missing.')
parser.add_argument('-t', '--tidy',
                    action='store_true',
                    default=False,
                    help='Remove for good what a test run that was stopped half way left: its work items, titled "Webship test …" and made by one of the default accounts, and the comments the default accounts deleted. Nothing else is touched.')
parser.add_argument('--connect',
                    default="_none_",
                    help='Point the dashboard\'s Plane at this site as this account: a new API key of it goes into core/config/plugin.plane.settings.yml (never shown), with the site\'s address. Example: --connect member')
ARGEOF
