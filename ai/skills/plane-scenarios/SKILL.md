---
name: plane-scenarios
description: Write webship-js scenarios for a Plane site (the open-source project and work management software, its Community Edition) of the Webship Workspace from phrases that exist — the Plane step pack's steps by area (logging in and out and a refused login, a project and who may open it, the work item list, one work item with its state, comments, assignees and last editor, a new work item, a cycle and the cycles page, what a Guest or a stranger may not do, test content), the traps found on real sites, and whole features. Use when asked to write, extend or fix scenarios for a Plane site, or when a scenario of the site fails on a phrase.
---

# plane-scenarios

Scenarios for a site built with the Plane plugin (`bash cmd-plane-project.sh <site> --install --add-users
--sample-content`) in a container-based workspace (DDEV by default), tested with webship-js and
`@webship-js/plane-steps` once `bash cmd-tools-testing.sh <site>` set the project up. Every phrase below exists in the
pack or in webship-js; a scenario names no platform.

## Accounts

- `Given I am a logged in user with the "member" user`: `owner` (Admin of Webship site), `member` (Member),
  `reader` (Guest), `stranger` (no membership). `Given I am not logged in` for a visitor.
- The accounts are made by the build (`cmd-tools-plane-cli.sh <site> --add-users`); a suite never creates or deletes
  one, and never writes a password: it logs in by the handle. Each logs in with its address (`member@example.com`)
  and shows as its display name (`member`).

## Phrases by area

| Area | Steps |
| --- | --- |
| Session | `I am a logged in user with the "member" user`, `I log in with the "member" user`, `I log in as "member@example.com" with the password "…"`, `the login should be refused with "Authentication failed"`, `I am not logged in`, `I log out`, `I should be logged in as "member"` (or the address, or the whole name "Member Test"), `I should not be logged in` |
| Projects | `I open the project "WEB"` (its identifier, or its name "Webship site": its work items), `I should be refused the project "WEB"` |
| Test content | `there is a work item "Webship test …" in the project "WEB"` (it goes after the scenario), `there is no work item "Webship test …" in the project "WEB"` |
| The list | `the work item list should show "…"` (`should not show`), `I create a work item "Webship test …" in the project "WEB"` (it goes after the scenario) |
| One work item | `I open the work item "…"` (its title, or its id "WEB-1"), `I set the state of the work item to "In Progress"`, `the state of the work item should be "In Progress"`, `I add the comment "…" to the work item`, `the work item should show the comment "…"` (`… by "member"`), `I assign the work item to "owner"`, `the work item should be assigned to "owner"`, `the work item should be last edited by "owner"` |
| What an account may not do | `I should not be able to change the state of the work item`, `I should not be able to create a work item in the project "WEB"`, `I should be refused the work item "WEB-1"`, `I should be refused the project "WEB"` |
| Cycles | `I open the cycle "Sprint 1" of the project "WEB"`, `the cycle should list the work item "…"` (`should not list`), `I open the cycles of the project "WEB"`, `the cycles should list "Sprint 1"` (`should not list`) |

## The sample content

`--sample-content` adds, in Webship site (WEB): "The greeting script says Helo instead of Hello" (WEB-1, by the owner,
In Progress, high, assigned to the member, labelled bug, in the cycle "Sprint 1", with the owner's comment "The script
is in the project's repository: `greeting.sh`."), "The usage line spells greeting as greting" (WEB-2, by the member,
Todo) and "An issue opened by someone outside the project" (WEB-3, made as the Guest: it stands for a request from
outside the project, as Plane's Intake would bring one, since a Guest makes no work items). A suite reads them and
never changes them.

## Traps found on real sites

- The login asks for the address first, then the password: the steps fill both.
- A comment stays: change only a work item the scenario made (`there is a work item "Webship test …"`), which goes
  after it.
- The list shows every work item of the project, done ones too; a Guest's list shows only the ones it created.
- An assignee is a Member or an Admin of the project: the list offers no Guest.
- "Last edited by" names the creator until someone changes the title or the description.
- A refusal (a wrong password, a work item or a workspace an account may not see) makes the browser log failed
  requests: tag those scenarios `@js-off`.
- Plane allows a set number of logins a minute from one address (10 by default); a site the workspace built allows
  100, and the step that logs in says so when the site refuses for that.
- A run that was stopped half way leaves its "Webship test …" work items: `bash cmd-tools-plane-cli.sh <site> --tidy`
  removes them.

## Whole features

`examples/` holds three features that pass on a site built with `--install --add-users --sample-content`: the session
(`session.feature`), a work item worked by a member (`issue.feature`) and the roles (`roles.feature`).

## The book

For any automated functional testing in this work (a Gherkin feature, a step definition, choosing a
step, a test run and its failures), read the book *Automated Functional Testing Recipes* first.

- **Where.** Use the first that exists: `.claude/automated-functional-testing-recipes/` in the project,
  `~/.claude/automated-functional-testing-recipes/` (installed by webship/webship-js-ai-agent,
  webship/webship-js-skills or webship/ai-agents), or
  https://github.com/webship/webship-js-ai-agent/tree/2.0.x/automated-functional-testing-recipes
- **How.** Its `README.md` first, then the chapter that matches the task (one file per chapter,
  named by its subject), not the single complete file.
- **Which wins.** The installed webship-js package and the step pack are the source of truth for
  step phrasing. When they differ from the book, follow them and say so.
- **For a site.** Start with `ch10-authentication-authorization.md` (logins, refusals and what each role may do),
  `ch07-waiting-dynamic-content.md` (waiting on the app's own signals) and `ch26-testing-cms-applications.md`
  (content made and removed, roles, a workflow across roles).
