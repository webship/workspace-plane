# The site of a Plane project of the Webship Workspace, through Django's own shell in Plane's container.
#
# Run by the Plane builder and its tool (fun-plane.sh) as
#     PLANE_VERBS='<verb>…' python manage.py shell -c "exec(open('/opt/webship/plane-site.py').read())"
# in /app/backend of Plane's all-in-one container. A payload (the accounts, a login) travels on the input, never on a
# command line. What is made is made as its author (crum's impersonation), as Plane's own screens would.
#
#   defaults   the instance set up: its setup done, sign-ups closed, e-mail and password logins, no telemetry
#   accounts   make the accounts of the input (the base64 of a JSON list), or give them back their names, passwords and
#              roles: an admin row is the instance's administrator; a row with a role (Admin, Member, Guest) is a member
#              of the sample workspace and project in it, made with them; a row with action "lock" is kept from
#              logging in
#   content    the sample content, where it is missing: the cycle Sprint 1, the label bug, three work items, a comment
#   tidy       remove for good the work items a stopped test run left (titled "Webship test …" and made by one of the
#              default accounts), and the comments the default accounts deleted in the sample project; nothing else
#   list       what the site holds: the accounts, their memberships, the work items and the cycles
#   token      a new API key of the account named on the input (its login or e-mail), in the sample workspace, the
#              earlier one of the Workspace revoked: "TOKEN <key>"
#   version    the release the site runs: "VERSION <release>"
#   counts     what the sample project holds, one count a line, deleted rows left out: a test run must leave them

import base64
import datetime
import json
import os
import sys

from crum import impersonate
from django.core.cache import cache
from django.utils import timezone

from plane.api.serializers import ProjectCreateSerializer
from plane.db.models import (DEFAULT_STATES, APIToken, Cycle, CycleIssue, Issue, IssueActivity, IssueAssignee,
                             IssueComment, IssueLabel, Label, Profile, Project, ProjectMember, State, User, Workspace,
                             WorkspaceMember)
from plane.license.models import Instance, InstanceAdmin, InstanceConfiguration

VERBS = os.environ.get('PLANE_VERBS', '').split()
WORKSPACE_SLUG = 'webship'
WORKSPACE_NAME = 'Webship'
PROJECT_IDENTIFIER = 'WEB'
PROJECT_NAME = 'Webship site'
CYCLE = 'Sprint 1'
# What a test run makes: titled "Webship test …", by one of the default accounts. tidy removes nothing else.
TEST_PREFIX = 'Webship test '
TEST_ACCOUNTS = ['owner', 'member', 'reader', 'stranger']
TOKEN_LABEL = 'webship-workspace'
ROLES = {'Admin': 20, 'Member': 15, 'Guest': 5}

ISSUES = [
    {'name': 'The greeting script says Helo instead of Hello', 'author': 'owner', 'state': 'In Progress',
     'priority': 'high', 'assignee': 'member', 'cycle': True, 'label': True,
     'body': '<p>Run <code>./greeting.sh Ada</code>: it prints "Helo, Ada!". It should print "Hello, Ada!".</p>',
     'comment': "<p>The script is in the project's repository: <code>greeting.sh</code>.</p>"},
    {'name': 'The usage line spells greeting as greting', 'author': 'member', 'state': 'Todo', 'priority': 'low',
     'assignee': None, 'cycle': False, 'label': False,
     'body': '<p>Run <code>./greeting.sh</code> with no name: it prints "Usage: greting.sh &lt;name&gt;".</p>',
     'comment': None},
    {'name': 'An issue opened by someone outside the project', 'author': 'reader', 'state': 'Todo', 'priority': 'none',
     'assignee': None, 'cycle': False, 'label': False,
     'body': '<p>A guest of the project opened this work item: the tracker treats it as from outside the project.</p>',
     'comment': None},
]


def fail(message):
    sys.stderr.write(message + '\n')
    sys.exit(1)


def read_rows():
    raw = sys.stdin.read().strip()
    if not raw:
        return []
    try:
        return json.loads(base64.b64decode(raw).decode())
    except ValueError:
        fail('The accounts on the input are not the base64 of a JSON list.')


def user_by(login):
    return User.objects.filter(email=login).first() or User.objects.filter(username=login).first()


def defaults():
    instance = Instance.objects.first()
    if instance is None:
        fail('Plane has registered no instance yet: its API has not started.')
    instance.is_setup_done = True
    instance.is_signup_screen_visited = True
    instance.is_telemetry_enabled = False
    instance.is_support_required = False
    instance.save()
    for key, value in [('ENABLE_SIGNUP', '0'), ('ENABLE_EMAIL_PASSWORD', '1'), ('ENABLE_MAGIC_LINK_LOGIN', '0'),
                       ('DISABLE_WORKSPACE_CREATION', '1')]:
        config, _ = InstanceConfiguration.objects.get_or_create(key=key, defaults={'category': 'AUTHENTICATION'})
        config.value = value
        config.save()
    # The instance's answer is cached for two hours: what was set must be what the app reads now.
    cache.clear()
    print('defaults: the instance is set up, sign-ups closed, e-mail and password logins')


def onboarded(user, workspace=None):
    profile, _ = Profile.objects.get_or_create(user=user)
    profile.is_onboarded = True
    profile.is_tour_completed = True
    profile.is_navigation_tour_completed = True
    profile.onboarding_step = {'profile_complete': True, 'workspace_create': True, 'workspace_invite': True,
                               'workspace_join': True}
    if workspace is not None:
        profile.last_workspace_id = workspace.id
    profile.save()


def workspace_and_project(owner):
    workspace = Workspace.objects.filter(slug=WORKSPACE_SLUG).first()
    if workspace is None:
        with impersonate(owner):
            workspace = Workspace.objects.create(name=WORKSPACE_NAME, slug=WORKSPACE_SLUG, owner=owner)
    project = Project.objects.filter(workspace=workspace, identifier=PROJECT_IDENTIFIER).first()
    if project is None:
        with impersonate(owner):
            serializer = ProjectCreateSerializer(data={'name': PROJECT_NAME, 'identifier': PROJECT_IDENTIFIER,
                                                       'network': 2, 'cycle_view': True, 'module_view': False},
                                                 context={'workspace_id': workspace.id})
            if not serializer.is_valid():
                fail('The sample project could not be made: %s' % serializer.errors)
            project = serializer.save()
            State.objects.bulk_create([
                State(name=s['name'], color=s['color'], project=project, sequence=s['sequence'], workspace=workspace,
                      group=s['group'], default=s.get('default', False), created_by=owner)
                for s in DEFAULT_STATES])
        print('project: %s (%s) made in the workspace %s' % (PROJECT_NAME, PROJECT_IDENTIFIER, WORKSPACE_SLUG))
    return workspace, project


def accounts(rows):
    instance = Instance.objects.first()
    admins = [r for r in rows if r.get('role') == 'Admin' and r.get('action') != 'lock']
    for row in rows:
        user = user_by(row['mail']) or user_by(row['login'])
        if row.get('action') == 'lock':
            if user is not None:
                user.is_active = False
                user.save()
                print('%s: kept from logging in' % row['login'])
            continue
        first, _, last = row['fullname'].partition(' ')
        if user is None:
            user = User(email=row['mail'], username=row['login'])
        user.email = row['mail']
        user.username = row['login']
        user.display_name = row['login']
        user.first_name = first
        user.last_name = last
        user.is_active = True
        user.is_email_verified = True
        user.is_password_autoset = False
        user.set_password(row['password'])
        user.save()
        onboarded(user)
        print('%s: account ready (%s)%s' % (row['login'], row['mail'], ', the instance administrator' if row.get('admin') else ''))
        if row.get('admin') and instance is not None:
            InstanceAdmin.objects.get_or_create(user=user, instance=instance, defaults={'role': 20, 'is_verified': True})
            cache.clear()
    if not any(r.get('role') for r in rows):
        return
    owner = user_by(admins[0]['mail']) if admins else None
    if owner is None:
        existing = Workspace.objects.filter(slug=WORKSPACE_SLUG).first()
        owner = existing.owner if existing else None
    if owner is None:
        fail('The sample workspace needs an Admin among the accounts.')
    workspace, project = workspace_and_project(owner)
    for row in rows:
        if row.get('action') == 'lock':
            continue
        user = user_by(row['mail'])
        role = ROLES.get(row.get('role') or '')
        if role is None:
            WorkspaceMember.objects.filter(workspace=workspace, member=user).delete()
            ProjectMember.objects.filter(project=project, member=user).delete()
            print('%s: no membership of %s' % (row['login'], PROJECT_NAME))
            continue
        wm, _ = WorkspaceMember.objects.get_or_create(workspace=workspace, member=user, defaults={'role': role})
        wm.role, wm.is_active = role, True
        wm.save()
        pm, _ = ProjectMember.objects.get_or_create(project=project, workspace=workspace, member=user, defaults={'role': role})
        pm.role, pm.is_active = role, True
        pm.save()
        onboarded(user, workspace)
        print('%s: %s of %s' % (row['login'], row['role'], PROJECT_NAME))


def sample_project():
    workspace = Workspace.objects.filter(slug=WORKSPACE_SLUG).first()
    project = workspace and Project.objects.filter(workspace=workspace, identifier=PROJECT_IDENTIFIER).first()
    if not project:
        fail('The sample project is not there: add the default accounts first (--add-users).')
    return workspace, project


def content():
    workspace, project = sample_project()
    owner = User.objects.get(username='owner')
    today = timezone.now()
    cycle = Cycle.objects.filter(project=project, name=CYCLE).first()
    if cycle is None:
        with impersonate(owner):
            cycle = Cycle.objects.create(project=project, workspace=workspace, name=CYCLE, owned_by=owner,
                                         description='The current iteration of the sample project.',
                                         start_date=today - datetime.timedelta(days=3),
                                         end_date=today + datetime.timedelta(days=11))
    label = Label.objects.filter(project=project, name='bug').first()
    if label is None:
        with impersonate(owner):
            label = Label.objects.create(project=project, workspace=workspace, name='bug', color='#ee0701')
    states = {s.name: s for s in State.objects.filter(project=project)}
    for spec in ISSUES:
        if Issue.objects.filter(project=project, name=spec['name']).exists():
            continue
        author = User.objects.get(username=spec['author'])
        with impersonate(author):
            issue = Issue.objects.create(project=project, workspace=workspace, name=spec['name'],
                                         description_html=spec['body'], priority=spec['priority'],
                                         state=states.get(spec['state']))
            if spec['assignee']:
                IssueAssignee.objects.create(issue=issue, assignee=User.objects.get(username=spec['assignee']),
                                             project=project, workspace=workspace)
            if spec['label']:
                IssueLabel.objects.create(issue=issue, label=label, project=project, workspace=workspace)
            if spec['cycle']:
                CycleIssue.objects.create(issue=issue, cycle=cycle, project=project, workspace=workspace)
            if spec['comment']:
                IssueComment.objects.create(issue=issue, project=project, workspace=workspace, actor=author,
                                            comment_html=spec['comment'])
    print('content: %s holds %d work items, %s (%s to %s)' % (PROJECT_NAME, Issue.issue_objects.filter(project=project).count(),
          CYCLE, cycle.start_date.date(), cycle.end_date.date()))


def tidy():
    workspace, project = sample_project()
    authors = User.objects.filter(username__in=TEST_ACCOUNTS, email__endswith='@example.com')
    left = Issue.all_objects.filter(project=project, name__startswith=TEST_PREFIX, created_by__in=authors)
    count = left.count()
    for issue in left:
        # Plane keeps the history of a work item it deletes: removed for good, its history goes first.
        IssueActivity.all_objects.filter(issue=issue).delete()
        issue.delete(soft=False)
    # Plane keeps a deleted comment, marked; the ones the default accounts deleted go for good, their history kept.
    gone = IssueComment.all_objects.filter(project=project, deleted_at__isnull=False, actor__in=authors)
    removed = gone.count()
    for comment in gone:
        IssueActivity.all_objects.filter(issue_comment=comment).update(issue_comment=None)
        comment.delete(soft=False)
    print('tidy: %d work item(s) a test run left removed for good, %d comment(s) the default accounts deleted' % (count, removed))


def counts():
    workspace, project = sample_project()
    live = Issue.issue_objects.filter(project=project)
    on_live = {'project': project, 'issue__deleted_at__isnull': True}
    for name, number in [
        ('work items', live.count()),
        ('open work items', live.exclude(state__group__in=['completed', 'cancelled']).count()),
        ('comments', IssueComment.objects.filter(**on_live).count()),
        ('assignees', IssueAssignee.objects.filter(**on_live).count()),
        ('labels on work items', IssueLabel.objects.filter(**on_live).count()),
        ('work items in cycles', CycleIssue.objects.filter(**on_live).count()),
        ('cycles', Cycle.objects.filter(project=project).count()),
        ('labels', Label.objects.filter(project=project).count()),
        ('states', State.objects.filter(project=project).count()),
        ('project members', ProjectMember.objects.filter(project=project, is_active=True).count()),
        ('workspace members', WorkspaceMember.objects.filter(workspace=workspace, is_active=True).count()),
        ('users', User.objects.filter(is_bot=False).count()),
    ]:
        print('%s: %d' % (name, number))


def listing():
    workspace = Workspace.objects.filter(slug=WORKSPACE_SLUG).first()
    project = workspace and Project.objects.filter(workspace=workspace, identifier=PROJECT_IDENTIFIER).first()
    instance = Instance.objects.first()
    admins = set(InstanceAdmin.objects.filter(instance=instance).values_list('user_id', flat=True))
    names = {20: 'Admin', 15: 'Member', 5: 'Guest'}
    print('Accounts:')
    for user in User.objects.filter(is_bot=False).order_by('date_joined'):
        role = ''
        if user.id in admins:
            role = 'instance administrator'
        elif project:
            pm = ProjectMember.objects.filter(project=project, member=user, is_active=True).first()
            role = '%s of %s' % (names.get(pm.role, pm.role), PROJECT_NAME) if pm else 'no membership'
        print('  %-12s %-28s %-9s %s' % (user.username, user.email, 'active' if user.is_active else 'blocked', role))
    if project:
        items = Issue.issue_objects.filter(project=project)
        cycles = Cycle.objects.filter(project=project).count()
        print('%s (%s/%s): %d work items, %d cycle(s)' % (PROJECT_NAME, WORKSPACE_SLUG, PROJECT_IDENTIFIER, items.count(), cycles))


def token():
    login = sys.stdin.readline().strip()
    user = user_by(login)
    workspace = Workspace.objects.filter(slug=WORKSPACE_SLUG).first()
    if user is None or not user.is_active:
        fail('No active account %s.' % login)
    if workspace is None or not WorkspaceMember.objects.filter(workspace=workspace, member=user, is_active=True).exists():
        fail('%s is no member of the workspace %s.' % (login, WORKSPACE_SLUG))
    APIToken.objects.filter(user=user, label=TOKEN_LABEL).delete()
    key = APIToken.objects.create(user=user, workspace=workspace, label=TOKEN_LABEL, user_type=0,
                                  description='The Webship Workspace dashboard (cmd-tools-plane-cli.sh --connect).')
    print('TOKEN %s' % key.token)


def version():
    instance = Instance.objects.first()
    print('VERSION %s' % ((instance and instance.current_version) or os.environ.get('PLANE_RELEASE', '')))


ROWS = read_rows() if 'accounts' in VERBS else []
for verb in VERBS:
    if verb == 'defaults':
        defaults()
    elif verb == 'accounts':
        accounts(ROWS)
    elif verb == 'content':
        content()
    elif verb == 'tidy':
        tidy()
    elif verb == 'list':
        listing()
    elif verb == 'token':
        token()
    elif verb == 'version':
        version()
    elif verb == 'counts':
        counts()
    else:
        fail('No verb %s: defaults, accounts, content, tidy, list, token, version, counts.' % verb)
