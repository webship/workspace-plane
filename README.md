# @webship.co/workspace-plane

Plane, the open-source project and work management software (its Community Edition), for the
[Webship Workspace](https://github.com/webship/workspace), a container-based workspace (DDEV by default). The plugin
brings:

- **a builder**, `cmd-plane-project.sh`: a real Plane site from Plane's all-in-one image on the project's own
  PostgreSQL, with Valkey, RabbitMQ and an S3 store beside it, on DDEV, Docker Compose, Podman or Kubernetes, its
  instance set up, its default accounts as members of a sample workspace and project, and its work items and cycle;
- **a tool**, `cmd-tools-plane-cli.sh`: what a site is and its accounts, Plane's own commands in its container, the
  default accounts, the sample content, a clean-up after a stopped test run, and the dashboard's connection;
- **the step pack** [`@webship-js/plane-steps`](https://github.com/webship/plane-steps) wired into the workspace's
  testing setup, with a first feature for a site;
- **the work items as work items** of the tracker family
  ([`@webship.co/workspace-tracker`](https://github.com/webship/workspace-tracker)): the PLANE menu on a project row
  lists them, reads one, analyzes it, and lets the workspace's AI CLI work it on a branch, with a person in charge;
- **AI items** in their folders: three agents, a skill, a command and two prompts.

## Install

From the workspace's root, the same four steps as Settings → Plugins:

```bash
bash core/scripts/plugins.sh --require @webship.co/workspace-plane
bash core/scripts/plugins.sh --activate plane --with-needs
bash core/scripts/plugins.sh --install plane --with-needs
bash core/scripts/plugins.sh --configure plane
```

## What it needs

- A sites folder: one of the `dev`, `test`, `sandboxes` or `demos` plugins. The commands are placed there.
- The AI folders `ai-agents`, `ai-skills`, `ai-commands` and `ai-prompts`, where its AI items land.
- A container runtime: DDEV, or Docker, Podman or a kind cluster with the workspace's container runtimes
  (`--runtime docker`, `podman`, `kubernetes`), where a project carries services of its own (webship/workspace#900).
- About 800 MB of disk for the images the first time, and memory: a running site takes about 2 GB, and the builder
  asks for 4 GB free before it starts (`free -m`).

## Build a site

```bash
cd ~/workspace/sandboxes                      # or dev, test, demos
bash cmd-plane-project.sh mysite --install --add-users --sample-content
bash cmd-plane-project.sh mysite --install --add-users --sample-content --runtime docker   # or podman, kubernetes
```

| Flag | What it does |
| --- | --- |
| `--install` | Sets the instance up and makes the workspace account (`account` of `core/config/settings.yml`) its administrator. Plane asks a password of at least eight characters |
| `--add-users` | With `--install`: the default accounts, members of the workspace webship and its project Webship site in their roles |
| `--sample-content` | With `--install --add-users`: the work items of Webship site, its cycle "Sprint 1", the label "bug" and a comment |
| `--release <tag>` | The release of the all-in-one image: v1.5.1 by default |
| `--login-limit <number>/<period>` | The logins Plane allows from one address on the site, a dev and test setting: 100/minute by default, where Plane's own default is 10/minute |
| `--runtime ddev`, `docker`, `podman` or `kubernetes` | DDEV (the default, or `container.runtime` of `settings.yml`), Docker Compose, Podman or Kubernetes (a kind cluster) |
| `--launch` | Open the site when it is ready |

A project of the same name is deleted first, with its database, its files and its stores. Every build sets the
instance up the way a person would on its first screen: sign-ups closed, logins by e-mail and password, no
telemetry. Plane keeps its instance's answer for two hours, so the builder drops it and then checks that a visitor
gets the login form, not the setup's "Get started".

- **On DDEV** Plane's all-in-one image of the Community Edition (`makeplane/plane-aio-community`: its proxy, web app,
  API, live server and workers in one container) is a service of a generic project, on the project's PostgreSQL 15,
  with Valkey, RabbitMQ and an S3 store (MinIO) as services beside it, at `https://mysite.ddev.site`. The project's
  web container keeps the mail catcher, at `https://mysite.ddev.site:8026`. The store and the queue keep their data in
  volumes named after the project.
- **On Docker Compose and Podman** the same image is the web container's (the workspace's generic stack), run as the
  host user: the project's web image gives that user the folders Plane writes to, and runs Plane's supervisor without
  the user it names. Valkey, RabbitMQ and the store are the project's own services (`rt_service`), the same pinned
  images as on DDEV, their containers and volumes named after the project; the site is at `http://127.0.0.1:<port>`,
  and its proxy listens on 8080 in the web container. Removing the project removes them with it.
- **On Kubernetes** (the workspace's kind cluster) the web pod runs the same image, the project's folder mounted from
  the host, and each service is a Deployment, a ClusterIP Service and a volume claim of the project's namespace; the
  site is at the node's address and a NodePort.
- Plane's own start sets its address from a host name that takes no port, so on these runtimes the builder also gives
  Plane the site's address with its port for the logins, the instance's admin and the published views to come back
  to. Two links still leave the port out: the one in the e-mail Plane sends an account it activates again, and the one
  on the page it shows when it refuses a form.
- Lando and Docksal are not proven for Plane yet: asked for one, the builder says so and changes nothing.

The site's own values, its secret keys and the keys of its queue and its store, are made for it and kept in `plane/`
of the project, which only you can read. The builder never prints them. The image starts from its own settings file
and copies only some of the container's values into it: `plane-start.sh` puts the site's other values into that file
first.

**The login limit is a dev and test setting.** Plane allows a set number of logins from one address, 10 a minute by
default. A test suite logs in far more often than a person, so a site the workspace builds allows 100 a minute:
`--login-limit` (or `site_plane_login_limit` in the folder's settings) sets another, and `--login-limit 10/minute`
builds a site with Plane's own default. Only the sites the builder makes get it: a Plane you point the dashboard at,
with `--connect` or by hand, keeps its own limit, and the plugin never changes it.

### The default accounts

| Account | Address | Role in Webship site |
| --- | --- | --- |
| `owner` | `owner@example.com` | Admin |
| `member` | `member@example.com` | Member |
| `reader` | `reader@example.com` | Guest: sees and comments on only the work items it created, and changes nothing else |
| `stranger` | `stranger@example.com` | No membership: the workspace is not open to it |

Each has the password of the workspace's other default lists, `dD.123123ddd`, logs in with its address, and shows as
its login. They are configuration: a test suite never creates or deletes one. `bash cmd-tools-add-users.sh mysite
plane` and `bash cmd-tools-cancel-users.sh mysite plane` (the row's Tests menu) add them and keep them from logging in.

### The sample content

In Webship site (`webship/WEB`): "The greeting script says Helo instead of Hello" (WEB-1, by the owner, In Progress,
high, assigned to the member, labelled bug, in the cycle "Sprint 1", with a comment), "The usage line spells greeting
as greting" (WEB-2, by the member) and "An issue opened by someone outside the project" (WEB-3). A Guest makes no work
items in the Community Edition 1.5.1: WEB-3 is made as the Guest through Django to stand for a request from outside
the project, as Plane's Intake would bring one, and the tracker treats it as from outside the project.

## The tool

```bash
bash cmd-tools-plane-cli.sh mysite                                    # what the site is: release, address, accounts
bash cmd-tools-plane-cli.sh mysite --run "showmigrations db"          # one of Plane's own Django commands, in its container
bash cmd-tools-plane-cli.sh mysite --sample-content                   # the sample content, where it is missing
bash cmd-tools-plane-cli.sh mysite --tidy                             # the work items a stopped test run left
bash cmd-tools-plane-cli.sh mysite --add-users                        # the default accounts and their memberships
bash cmd-tools-plane-cli.sh mysite --cancel-users                     # keep them from logging in
bash cmd-tools-plane-cli.sh mysite --connect member                   # the dashboard reads this site as member
```

`--connect <login>` makes a new API key of the account (its earlier one is revoked) and writes it, with the site's
address, into `core/config/plugin.plane.settings.yml`, and the sample project as the default one when none was set.
The key is never shown.

`--tidy` deletes for good, with no way back. It removes the work items a stopped test run left: titled "Webship test …"
and made by one of the default accounts. Plane would keep a deleted one, marked; tidy removes it and its history. It
also removes the comments the default accounts deleted in the sample project. A work item with another title ("Webship
testing plan") or another author stays, and so does everything outside the sample project.

## The work items as work items

The plugin is a provider of the tracker family. With a Plane address and an API key in its settings (`--connect`
writes both for a site the workspace built; for your own Plane, the key is in Profile settings → Personal Access
Tokens), the project rows of sites and code folders carry the **PLANE** menu, once they have a Plane project to work
against (`default_scope` as `<workspace slug>/<IDENTIFIER>`, `webship/WEB`, or one remembered from the list):

- **The list**: the open work items (their state is not of the completed or cancelled group), mine, assigned to
  someone, the current cycle's, and a search in the title.
- **One work item** (`WEB-1`): its text, its author and its last editor, each with their standing, and its comments.
- **Analyze**: the AI CLI reads it and proposes a plan, with reading tools only.
- **Do the work**: the AI CLI works it on a new branch of the project (or a worktree), made from the default branch of
  the project's remote, in a screen session you watch. The work item is saved as data, never as instructions; an HTML
  comment in its text stays as it was written.
- **Result**: the branch, its commits and the notes, the reviewer role, and the comment to post.
- With writes on (`allow_writes: true`): a comment, a move to another state of the project, labels of the project and
  an assignee (`me`, or an Admin or a Member by the name Plane shows, the address, the whole name or its first word),
  each your click after a preview. The text the dashboard writes is Markdown; Plane keeps HTML, so the plugin turns it
  into the HTML Plane's editor reads, with every character of the text escaped.

**What the Community Edition does not have.** No worklog: the provider says so, and the dashboard offers no "Log
work". No filter on its lists: the provider reads a project's work items in pages of 100, newest change first, keeps
the ones the view asks for, and reads at most five pages (the newest 500 changes).

**Plane's limit of API calls.** Plane allows 60 API calls a minute for a key. The provider reads lists in pages, keeps
the project, its members, states and labels for five minutes, and never makes a call per work item of a list. When
Plane answers that the key used its calls, nothing more is sent for that key until the time Plane gave has passed, and
the dashboard says how long that is.

**Who is inside.** An Admin and a Member of the project are inside. A Guest and an account with no membership are
outside: their work items are analyze only unless you confirm one by its author's name (`outsider_items: refuse`
refuses them). A Guest sees only the work items it created, and its comments count as from outside too.

**The last editor** is the account of the newest change of the title or the description, else the creator: what
Plane's own screen shows as "Last edited by". Plane's editor rewrites the description of a work item it opens for the
first time without saying so in the activity, so the provider does not read `updated_by`.

**Credentials.** The key travels in a file only you can read, never on a command line. Before anything is posted, the
text is checked for credentials: the ones the tracker family knows, the key of the settings, and anything shaped like
a Plane API key (`plane_api_` and 32 hex digits).

Plane opens no pull request: push the branch and open its pull request from the project's forge menu (GITHUB,
GITLAB) when its remote is on a forge.

### Settings

`core/config/plugin.plane.settings.yml` (Settings → Plugins → Plane):

| Key | What it is |
| --- | --- |
| `url` | The Plane address, without a trailing slash |
| `token` | An API key of the account the dashboard reads (and, with writes on, writes) as. Never printed |
| `allow_writes` | Comments, moves, labels, assignees and new work items to Plane; `false` by default |
| `max_agents` | Author sessions at once |
| `default_scope` | The Plane project a workspace project works against when it remembers none: `webship/WEB` |
| `scopes` | The Plane projects (`slug/IDENTIFIER`) the list may be switched to; empty is any project of the default one's workspace |
| `work_in` | `branch` (a new branch in the project) or `worktree` (outside the workspace folders) |
| `sandbox` | `required` (the AI CLI's sandbox, and no session without it) or `off` (a person's choice) |
| `network_domains` | The domains the sandbox allows (the project's package registries) |
| `allow_web` | Web fetch and web search in the author session |
| `comments_from` | The comments a saved work item keeps: `members` (Admins and Members), `all`, `none` |
| `outsider_items` | A work item from outside the project: `analyze` (work it only after a confirmation by name) or `refuse` |

## Testing a site

```bash
bash cmd-tools-testing.sh mysite                       # webship-js, the step pack, the users registry, a first feature
bash cmd-tools-testing.sh mysite --run
```

The testing setup adds `@webship-js/plane-steps` to the project, its step definitions to `cucumber.js`, the managing
account (`owner`, which makes and removes the test content through the site's own API), the workspace and the project
of the steps (`webship`, `WEB`), the users registry (`owner`, `member`, `reader`, `stranger`, each logging in with its
address), and `tests/features/site.feature`, whose first scenario checks the site opens on its login form. The suite
leaves the site as it found it.

## AI items

| Kind | Item | What it is for |
| --- | --- | --- |
| Agent | `plane-site-builder` | Build, look after and remove Plane sites |
| Agent | `plane-tester` | Test a site with the step pack: look at the screens first, write scenarios, run, read |
| Agent | `plane-issue-worker` | Work a work item on a branch, the writes left to a person |
| Skill | `plane-scenarios` | The pack's phrases by area, the traps found on real sites, whole features |
| Command | `/plane-test <site>` | Set the testing stack up, run the suite, report |
| Prompt | `plane-build-and-test` | Build a site and prove it with its first feature |
| Prompt | `plane-issue-to-branch` | Work a work item on a branch |

## License

ISC (see `LICENSE`). Plane itself is AGPL-3.0: the plugin runs Plane's own image and carries none of its code.
