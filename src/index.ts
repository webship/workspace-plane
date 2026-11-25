/**
 * Plane for Webship Workspace: a platform plugin and a provider of the tracker family.
 *
 * What the package carries is placed by the installer from the manifest: the builder and the tool in the sites
 * folders, their functions and argparse under core/scripts/plugins/plane/ (with the compose file of Plane's services,
 * the Django script the builder runs in Plane's container, and the first feature of a site), and its AI items (ai/ in
 * this package) in the folder of their kind.
 *
 * What register() adds: the work items of a Plane as work items (@webship.co/workspace-tracker): the PLANE menu on the
 * project rows of sites and code folders that work against a Plane project, the list, one work item, analyze, do the
 * work with the workspace's AI CLI on a branch, and, with writes on, a comment, a move, labels and an assignee, each a
 * person's click after a preview. And what the assistant is told.
 *
 * Everything the dashboard is asked for goes through `api`; this package requires nothing from the dashboard's own
 * files, so it can be installed from npm and removed without a trace.
 */

import type { PluginApi } from '@webship.co/workspace-plugin-api';
import { registerTracker } from '@webship.co/workspace-tracker';

import { planeTracker } from './lib/tracker';

export { planeTracker };

/** The plugin's name: a site is a generic project in containers that the plugin claims, and the core's tools call its functions under it. */
export const PLATFORM = 'plane';

/** The commands the installer places in every sites folder. */
export const COMMANDS = ['cmd-plane-project.sh', 'cmd-tools-plane-cli.sh'];

/** The agents the installer places in the AI Agents folder. */
export const AGENTS = ['plane-site-builder', 'plane-tester', 'plane-issue-worker'];

/** The skill the installer places in the AI Skills folder (a folder each, with its SKILL.md). */
export const SKILLS = ['plane-scenarios'];

/** The slash command the installer places in the AI Commands folder. */
export const AI_COMMANDS = ['plane-test'];

/** The prompts the installer places in the AI Prompts folder: each a whole launch command for a new session. */
export const PROMPTS = ['plane-build-and-test', 'plane-issue-to-branch'];

/** What the assistant is told about Plane sites in this workspace (the work items are told by the tracker). */
export function assistantContext(): string {
  return [
    'Plane (a plugin, @webship.co/workspace-plane), the open-source project and work management software (its Community Edition): a site is built with',
    '`bash cmd-plane-project.sh <name> --install --add-users --sample-content` from a sites folder (dev, test, sandboxes, demos):',
    'Plane\'s all-in-one image (v1.5.1 by default, `--release`) on the project\'s own PostgreSQL, with Valkey, RabbitMQ and an S3 store beside it, on DDEV at https://<name>.ddev.site,',
    'or with `--runtime docker` or `podman` at http://127.0.0.1:<port>, or with `--runtime kubernetes` on the workspace\'s kind cluster at the node\'s address (the image runs as the host user there, and the cache, the queue and the store are the project\'s own services).',
    'It needs about 4 GB of free memory, and the builder says so before it starts.',
    '`--install` sets the instance up and makes the workspace account its administrator; `--add-users` adds the default accounts (owner: Admin, member: Member, reader: Guest of the workspace webship and its project Webship site, identifier WEB; stranger: no membership), each @example.com;',
    '`--sample-content` adds the work items WEB-1 to WEB-3, the cycle "Sprint 1", the label "bug" and a comment.',
    '`bash cmd-tools-plane-cli.sh <name>` says what the site is and lists its accounts; `--run "<command>"` runs one of Plane\'s own Django commands in its container,',
    '`--sample-content` adds the sample content later, `--tidy` removes the work items a stopped test run left ("Webship test …"), `--add-users` and `--cancel-users` manage the default accounts,',
    'and `--connect <login>` points the dashboard\'s Plane at the site as that account (a new API key in the plugin\'s settings, never shown).',
    'A Guest of a Plane project sees only the work items it created, comments on them, and changes nothing else; the Community Edition has no worklog.',
    '`bash cmd-tools-testing.sh <name>` sets up webship-js with the Plane step pack; `--run` runs the suite.',
    `For Plane sites hand over to the agent \`${AGENTS[0]}\`, for testing one to \`${AGENTS[1]}\`, for working a work item to \`${AGENTS[2]}\`.`,
    `The plugin also places the skill ${SKILLS.map((a) => `\`${a}\``).join(', ')} (the step pack's phrases, by area) in ai-skills/,`,
    `the command ${AI_COMMANDS.map((a) => `\`/${a} <site>\``).join(', ')} in ai-commands/ and the prompts ${PROMPTS.map((a) => `\`${a}\``).join(' and ')} in ai-prompts/.`,
    'Never run Plane\'s tools on the host for a project; removing the project removes its database, its files and its stores too.',
  ].join(' ');
}

export function register(api: PluginApi): void {
  registerTracker(api, planeTracker(api));
  if (typeof api.addAssistantContext === 'function') api.addAssistantContext(assistantContext);
}
