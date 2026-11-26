#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project: its folder, its project in containers and its host name.')
parser.add_argument('--runtime',
                    dest='RUNTIME',
                    default="_none_",
                    choices=['ddev', 'docker', 'podman', 'kubernetes'],
                    help='The container runtime to build on: ddev (the default, or container.runtime of settings.yml), docker (Docker Compose), podman or kubernetes (a kind cluster). Lando and Docksal are not proven for Plane yet.')
parser.add_argument('-i', '--install',
                    action='store_true',
                    default=False,
                    help='Make the workspace account the instance administrator of the site.')
parser.add_argument('-a', '--add-users',
                    action='store_true',
                    default=False,
                    help='With --install, add the default accounts (owner: Admin, member: Member, reader: Guest of the workspace webship and its project Webship site; stranger: no membership): the ones the test scenarios log in as.')
parser.add_argument('-s', '--sample-content',
                    action='store_true',
                    default=False,
                    help='With --install and --add-users, add the sample content the step pack and the tracker are tested on: the work items of Webship site, its cycle Sprint 1 and a comment.')
parser.add_argument('-v', '--release',
                    dest='PLANE_VERSION',
                    default="",
                    help='The release of the site (a tag of the all-in-one image): v1.5.1 by default. Example: --release v1.5.1')
parser.add_argument('--login-limit',
                    dest='LOGIN_LIMIT',
                    default="",
                    help='How many logins a minute (or a second, an hour, a day) Plane allows from one address on this site: a dev and test setting, 100/minute by default so a test suite can log in as often as it needs; Plane\'s own default is 10/minute. Example: --login-limit 10/minute')
parser.add_argument('-l', '--launch',
                    action='store_true',
                    default=False,
                    help='Open the site in a browser when it is ready.')
ARGEOF
