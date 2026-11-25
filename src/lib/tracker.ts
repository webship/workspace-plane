/**
 * Plane, as a provider of the tracker family (@webship.co/workspace-tracker): the work items of a project of a Plane
 * workspace (the Community Edition), over its public REST API (/api/v1) with an API key (the X-API-Key header), in a
 * header file, never on a command line.
 *
 * A scope is a workspace's slug and a project's identifier ("webship/WEB"); an item is the identifier and its number
 * ("WEB-1"), as Plane shows it.
 *
 * Reads: the open work items (their state is not of the completed or cancelled group), mine, assigned to someone, the
 * current cycle's, and a search in the title; one work item with its comments. The Community Edition answers no filter
 * on its lists (it refuses the pql and filters parameters), so the provider reads a project's work items in pages of
 * 100, newest change first, and keeps the ones the view asks for: at most five pages, the newest 500 changes.
 *
 * Plane allows 60 calls a minute for a key. The provider reads lists in pages, keeps the project, its members, states
 * and labels for five minutes, and never makes a call per item of a list. When Plane answers 429, nothing more is sent
 * until the time its Retry-After gives has passed, and the message says how long that is.
 *
 * Each author's standing is their role in the project: an Admin and a Member are inside; a Guest (who sees only the
 * work items it created) and someone with no membership are outside, so the base keeps their items analyze-only unless
 * a person confirms by name. The last editor is the actor of the newest change of the title or the description, else
 * the creator: what Plane's own screen shows as "Last edited by". Plane's editor rewrites the description of an item it
 * opens for the first time, without an activity, so `updated_by` is not read.
 *
 * Writes, which the base offers only with writes on, each after a person's click: a comment, a state, labels, an
 * assignee, and a new work item. The base writes Markdown; Plane keeps HTML, so the provider turns it into the HTML
 * Plane's editor reads, with every character of the text escaped. The Community Edition has no worklog, which the
 * capabilities say, so the dashboard offers no "Log work". Plane is not a forge: the pull request of the work is opened
 * from the project's forge menu. A Plane API key is `plane_api_` and 32 hex digits; the base refuses that shape in
 * whatever is about to be posted.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PluginApi } from '@webship.co/workspace-plugin-api';
import type { Person, TrackerItem, TrackerItemFull, TrackerProvider, TrackerScope, WriteResult } from '@webship.co/workspace-tracker';

/** A workspace's slug: the part of its address after the host. */
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;
/** A project's identifier, as Plane writes it in front of its work items' numbers. */
const IDENT_RE = /^[A-Z0-9]{1,12}$/;
/** A work item: its project's identifier and its number. */
export const ITEM_RE = /^([A-Z0-9]{1,12})-([1-9][0-9]{0,8})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** What a Plane API key looks like. */
export const KEY_RE = /plane_api_[0-9a-f]{32}/;
/** How long the project, its members, states and labels are kept before they are asked again. */
const KEEP_MS = 5 * 60 * 1000;
/** The pages of 100 a list reads at most. */
const MAX_PAGES = 5;
const EXPAND = 'expand=state%2Cassignees%2Clabels';

const configured = (v: unknown) => { const s = String(v == null ? '' : v).trim(); return s && s !== 'CHANGE_ME' ? s : ''; };

/** A role in the project (Plane's numbers), as the base reads an author's standing. */
export function roleAssociation(role: unknown): Person['association'] {
  const r = Number(role);
  if (r === 20) return 'owner'; // Admin
  if (r === 15) return 'member'; // Member
  if (r === 5) return 'contributor'; // Guest
  return 'outside';
}

/** How a state reads: the completed and cancelled groups are done, started is work going on, the rest is open. */
export function stateClassOf(state: { group?: string } | undefined): TrackerItem['stateClass'] {
  const g = String((state && state.group) || '');
  if (g === 'completed' || g === 'cancelled') return 'done';
  if (g === 'started') return 'doing';
  return g ? 'open' : undefined;
}

/** A work item still to be done: its state is not of the completed or cancelled group. */
export const isOpen = (i: any) => stateClassOf(i && i.state) !== 'done';

/** The name Plane shows for an account: its display name, else its whole name, else its address. */
export function nameOf(u: any): string {
  if (!u || typeof u !== 'object') return 'unknown';
  return String(u.display_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || 'unknown');
}

const idOf = (u: any) => String((u && typeof u === 'object' ? u.id : u) || '');

/** A work item of the API, as the base reads an item. */
export function itemOf(i: any, base: string, slug: string, ident: string, iteration = ''): TrackerItem {
  const id = `${ident}-${i.sequence_id}`;
  return {
    id,
    title: String(i.name || ''),
    url: `${base}/${slug}/browse/${id}/`,
    state: String((i.state && i.state.name) || ''),
    stateClass: stateClassOf(i.state),
    assignees: (Array.isArray(i.assignees) ? i.assignees : []).filter((a: any) => a && typeof a === 'object').map(nameOf),
    labels: (Array.isArray(i.labels) ? i.labels : []).filter((l: any) => l && typeof l === 'object' && l.name).map((l: any) => String(l.name)),
    ...(iteration ? { iteration } : {}),
    updated: i.updated_at || undefined,
  };
}

/** The cycle a "current cycle" view means: of the ones running today, the one that ends first. */
export function currentCycle(list: any[]): { id: string; name: string } | null {
  const running = (Array.isArray(list) ? list : []).filter((c) => c && UUID_RE.test(String(c.id || '')));
  running.sort((a, b) => String(a.end_date || '').localeCompare(String(b.end_date || '')));
  return running.length ? { id: String(running[0].id), name: String(running[0].name || '') } : null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8}|#39);/gi, (all, e: string) => {
    if (/^#/.test(e) && e !== '#39') {
      const n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      // A control character (but a tab or a new line) stays as it is written.
      return (n >= 0x20 || n === 9 || n === 10) && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}
const tagsOut = (s: string) => s.replace(/<[^>]*>/g, '');

/**
 * Plane's HTML (its editor's), as the text a snapshot keeps: blocks on their own lines, list items as "- ", a task as
 * "- [ ]" or "- [x]", a quote as "> ", code as Markdown code, a link with its address, a mention by the name `names`
 * gives its account. An HTML comment stays as it is written: what a page does not show is still read, as data.
 */
export function textOf(html: string, names: Map<string, string> = new Map()): string {
  const kept: string[] = [];
  const hold = (text: string) => { kept.push(text); return `\u0000${kept.length - 1}\u0000`; };
  let s = String(html || '').replace(/[\u0000-\u0002]/g, '');
  s = s.replace(/<!--[\s\S]*?-->/g, (c) => hold(c));
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, c: string) => `\n${hold(`\`\`\`\n${decode(tagsOut(c)).replace(/\n+$/, '')}\n\`\`\``)}\n`);
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, c: string) => hold(`\`${decode(tagsOut(c))}\``));
  s = s.replace(/<mention-component\b([^>]*)>(?:[\s\S]*?<\/mention-component>)?/gi, (_, attrs: string) => {
    const who = (attrs.match(/entity_identifier="([^"]*)"/i) || [])[1] || '';
    return hold(`@${names.get(who) || 'someone'}`);
  });
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
    const text = decode(tagsOut(label)).trim();
    const url = decode(href);
    return hold(text && text !== url ? `${text} (${url})` : url);
  });
  s = s.replace(/<img\b[^>]*>|<image-component\b[^>]*>(?:<\/image-component>)?/gi, (img) => {
    const alt = (img.match(/\balt="([^"]*)"/i) || [])[1] || '';
    return hold(alt ? `[image: ${decode(alt)}]` : '[image]');
  });
  // A quote's lines get "> " in front, one for each quote they are in.
  s = s.replace(/<blockquote\b[^>]*>/gi, '\n\u0001\n').replace(/<\/blockquote>/gi, '\n\u0002\n');
  // A list item's own wrappers (a task's checkbox, a paragraph) are not lines of their own.
  s = s.replace(/(<li\b[^>]*>)(?:\s*<label\b[^>]*>[\s\S]*?<\/label>)?(?:\s*<(?:div|p)\b[^>]*>)*/gi, '$1');
  s = s.replace(/(?:<\/(?:p|div)>\s*)+(<\/li>)/gi, '$1');
  s = s.replace(/<li\b[^>]*data-checked="(true|false)"[^>]*>/gi, (_, c: string) => `\n- [${c === 'true' ? 'x' : ' '}] `);
  s = s.replace(/<li\b[^>]*>/gi, '\n- ');
  s = s.replace(/<h([1-6])\b[^>]*>/gi, (_, n: string) => `\n\n${'#'.repeat(Number(n))} `);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|h[1-6]|ul|ol|table|tr)>/gi, '\n\n');
  s = s.replace(/<(p|div|ul|ol|table|tr)\b[^>]*>/gi, '\n');
  s = s.replace(/<\/(td|th)>/gi, ' | ');
  s = decode(tagsOut(s));
  // Held text may hold more held text (code in a link): put it back until none is left.
  for (let n = 0; n < 4 && /\u0000\d+\u0000/.test(s); n++) s = s.replace(/\u0000(\d+)\u0000/g, (_, k: string) => kept[Number(k)] ?? '');
  let depth = 0;
  const lines: string[] = [];
  for (const line of s.split('\n')) {
    const l = line.replace(/[ \t]+$/, '');
    if (l.trim() === '\u0001') { depth += 1; continue; }
    if (l.trim() === '\u0002') { depth = Math.max(0, depth - 1); continue; }
    lines.push(depth && l.trim() ? `${'> '.repeat(depth)}${l.trim()}` : l);
  }
  return lines.join('\n').replace(/\n(?:[ \t]*\n){2,}/g, '\n\n').trim();
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Bold and a word in underscores, in text already escaped. */
const emphasis = (s: string) => s
  .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[\s(])_([^_\n]+?)_(?=$|[\s).,;:!?])/g, '$1<em>$2</em>');

/** One line of Markdown text: code spans, links ([text](https://…) and bare addresses), bold and emphasis. */
function inline(text: string): string {
  const out: string[] = [];
  const code = /(`+)([^`][\s\S]*?)\1(?!`)/g;
  let at = 0;
  let m: RegExpExecArray | null;
  const rich = (s: string) => {
    const parts: string[] = [];
    const link = /\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]{1,2000})\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g;
    let from = 0;
    let l: RegExpExecArray | null;
    while ((l = link.exec(s))) {
      parts.push(emphasis(esc(s.slice(from, l.index))));
      const href = l[2] || l[3];
      parts.push(`<a href="${esc(href)}">${l[1] ? emphasis(esc(l[1])) : esc(href)}</a>`);
      from = l.index + l[0].length;
    }
    parts.push(emphasis(esc(s.slice(from))));
    return parts.join('');
  };
  while ((m = code.exec(text))) {
    out.push(rich(text.slice(at, m.index)));
    out.push(`<code>${esc(m[2])}</code>`);
    at = m.index + m[0].length;
  }
  out.push(rich(text.slice(at)));
  return out.join('');
}

/**
 * Markdown, as the HTML Plane's editor reads: paragraphs, headings, lists and task lists, quotes, code blocks, code,
 * links, bold and emphasis. Every character of the text is escaped, so nothing in it becomes markup; an HTML comment
 * (a placeholder in a template) is left out, as a Markdown page does not show it.
 */
export function htmlOf(markdown: string): string {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let list: { kind: 'ul' | 'ol' | 'task'; items: string[] } | null = null;
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
  const flushQuote = () => { if (quote.length) out.push(`<blockquote><p>${quote.map(inline).join('<br>')}</p></blockquote>`); quote = []; };
  const flushList = () => {
    if (!list) return;
    if (list.kind === 'task') out.push(`<ul data-type="taskList">${list.items.join('')}</ul>`);
    else out.push(`<${list.kind}>${list.items.join('')}</${list.kind}>`);
    list = null;
  };
  const flush = () => { flushPara(); flushQuote(); flushList(); };
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      flush();
      const body: string[] = [];
      const close = new RegExp(`^\\s*${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);
      for (n += 1; n < lines.length && !close.test(lines[n]); n++) body.push(lines[n]);
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) { flush(); out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
    const q = line.match(/^\s{0,3}>\s?(.*)$/);
    if (q) { flushPara(); flushList(); quote.push(q[1]); continue; }
    const task = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d{1,9}[.)]\s+(.*)$/);
    if (task || bullet || numbered) {
      flushPara(); flushQuote();
      const kind = task ? 'task' : bullet ? 'ul' : 'ol';
      if (!list || list.kind !== kind) { flushList(); list = { kind, items: [] }; }
      const current = list as { kind: 'ul' | 'ol' | 'task'; items: string[] };
      if (task) current.items.push(`<li data-type="taskItem" data-checked="${task[1] === ' ' ? 'false' : 'true'}"><p>${inline(task[2])}</p></li>`);
      else current.items.push(`<li><p>${inline((bullet || numbered as RegExpMatchArray)[1])}</p></li>`);
      continue;
    }
    flushQuote(); flushList();
    para.push(line.trim());
  }
  flush();
  return out.join('') || '<p></p>';
}

/** The headers of the last answer in a curl header dump (a redirect writes more than one), by lower-case name. */
export function headersOf(dump: string): Record<string, string> {
  const blocks = String(dump || '').replace(/\r/g, '').split(/\n\n+/).filter((b) => /^HTTP\//.test(b.trim()));
  const last = blocks.length ? blocks[blocks.length - 1] : '';
  const out: Record<string, string> = {};
  for (const line of last.split('\n').slice(1)) {
    const at = line.indexOf(':');
    if (at > 0) out[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return out;
}

/** What an answer of Plane says went wrong, in one line: its error, its detail, or the first field it refused. */
export function saidOf(data: any): string {
  if (!data || typeof data !== 'object') return '';
  for (const k of ['error', 'detail', 'error_message']) if (typeof data[k] === 'string' && data[k]) return data[k];
  const words: string[] = [];
  const walk = (v: any, key: string) => {
    if (words.length >= 3) return;
    if (typeof v === 'string') words.push(key && key !== 'non_field_errors' && !/^\d+$/.test(key) ? `${key}: ${v}` : v);
    else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, /^\d+$/.test(k) ? key : k);
  };
  walk(data, '');
  return words.join('; ');
}

interface Member { name: string; display: string; email: string; first: string; full: string; role: number; active: boolean }

export function planeTracker(api: PluginApi): TrackerProvider {
  const lib = api.lib;
  const settings = () => api.settings.read() || {};
  const base = () => configured(settings().url).replace(/\/+$/, '');
  const token = () => configured(settings().token);

  // Who is asking: the site and its key, so that what is kept, and a wait Plane asked for, follow a change of either.
  const asker = () => crypto.createHash('sha1').update(`${base()}\n${token()}`).digest('hex').slice(0, 12);
  // Plane's answer to a key that used its calls: nothing is sent for that key before this time.
  const blocked = new Map<string, number>();
  const blockedFor = () => (blocked.get(asker()) || 0) - Date.now();
  const limitWords = (ms: number) => {
    const s = Math.max(1, Math.ceil(ms / 1000));
    return `Plane's limit of API calls a minute for this key is used up (60 by default): try again in ${s} second${s === 1 ? '' : 's'}. Nothing was sent.`;
  };

  /** One call of the REST API: the key and the body in files only this user reads, removed after. */
  async function call(method: string, p: string, body?: unknown): Promise<{ status: number; data: any }> {
    const wait = blockedFor();
    if (wait > 0) throw new Error(limitWords(wait));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-plane-'));
    try {
      const h = path.join(dir, 'headers');
      fs.writeFileSync(h, `X-API-Key: ${token()}\nAccept: application/json\n`, { mode: 0o600 });
      const answered = path.join(dir, 'answer-headers');
      const args = ['-sS', '-m', '30', '-X', method, '-w', '\n%{http_code}', '-H', `@${h}`, '-D', answered];
      if (body !== undefined) {
        const b = path.join(dir, 'body.json');
        fs.writeFileSync(b, JSON.stringify(body), { mode: 0o600 });
        args.push('-H', 'Content-Type: application/json', '--data-binary', `@${b}`);
      }
      args.push(`${base()}/api/v1${p}`);
      const r = await lib.run('curl', args, process.env.HOME || '/', { timeoutMs: 40 * 1000, env: process.env });
      const out = String(r.stdout || '');
      const at = out.lastIndexOf('\n');
      const status = Number(out.slice(at + 1)) || 0;
      if (!status) throw new Error(lib.cliError(String(r.stderr || 'curl did not answer')));
      let data: any = null;
      try { data = JSON.parse(at >= 0 ? out.slice(0, at) : out); } catch (_) { data = null; }
      if (status === 429) {
        let after = NaN;
        try { after = Number(headersOf(fs.readFileSync(answered, 'utf8'))['retry-after']); } catch (_) { after = NaN; }
        const ms = (Number.isFinite(after) && after > 0 ? Math.min(after, 3600) : 60) * 1000;
        blocked.set(asker(), Date.now() + ms);
        throw new Error(limitWords(ms));
      }
      return { status, data };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  const why = (r: { status: number; data: any }) => { const said = saidOf(r.data); return `Plane answered ${r.status}${said ? `: ${said.slice(0, 200)}` : ''}`; };
  async function get(p: string): Promise<any> {
    const r = await call('GET', p);
    if (r.status < 200 || r.status >= 300) throw new Error(why(r));
    return r.data;
  }
  async function write(method: string, p: string, body: unknown, url: string): Promise<WriteResult & { data?: any }> {
    try {
      const r = await call(method, p, body);
      return r.status >= 200 && r.status < 300 ? { ok: true, error: '', url, data: r.data } : { ok: false, error: why(r) };
    } catch (e) { return { ok: false, error: String((e as Error).message || e) }; }
  }

  /** The rows of a list, a page of 100 at a time, the ones `keep` takes, until `limit` of them or five pages. */
  async function pages(p: string, keep: (row: any) => boolean, limit: number): Promise<any[]> {
    const found: any[] = [];
    let cursor = '';
    for (let n = 0; n < MAX_PAGES && found.length < limit; n++) {
      const d = await get(`${p}${p.includes('?') ? '&' : '?'}per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      const rows: any[] = Array.isArray(d) ? d : (d && Array.isArray(d.results) ? d.results : []);
      for (const row of rows) if (found.length < limit && keep(row)) found.push(row);
      if (Array.isArray(d) || !d || !d.next_page_results || !d.next_cursor) break;
      cursor = String(d.next_cursor);
    }
    return found;
  }

  // What is kept for five minutes: a project's id, its members, states and labels, and the key's own account.
  const kept = new Map<string, { at: number; value: unknown }>();
  async function keep<T>(what: string, make: () => Promise<T>): Promise<T> {
    const key = `${asker()}:${what}`;
    const hit = kept.get(key);
    if (hit && Date.now() - hit.at < KEEP_MS) return hit.value as T;
    const value = await make();
    kept.set(key, { at: Date.now(), value });
    return value;
  }

  const partsOf = (scope: TrackerScope) => { const [slug, ident] = scope.id.split('/'); return { slug, ident }; };
  async function projectOf(scope: TrackerScope): Promise<{ id: string; name: string; path: string }> {
    const { slug, ident } = partsOf(scope);
    return keep(`project:${scope.id}`, async () => {
      const found = await pages(`/workspaces/${slug}/projects/`, (x) => x && x.identifier === ident, 1);
      if (!found.length) throw new Error(`no project ${ident} in the Plane workspace ${slug} that this key can see`);
      return { id: String(found[0].id), name: String(found[0].name || ident), path: `/workspaces/${slug}/projects/${found[0].id}` };
    });
  }
  async function membersOf(scope: TrackerScope): Promise<Map<string, Member> | null> {
    try {
      const project = await projectOf(scope);
      return await keep(`members:${scope.id}`, async () => {
        const rows = await pages(`${project.path}/project-members-lite/`, () => true, 1000);
        return new Map(rows.filter((m) => m && m.id).map((m) => [String(m.id), {
          name: nameOf(m), display: String(m.display_name || ''), email: String(m.email || ''), first: String(m.first_name || ''),
          full: [m.first_name, m.last_name].filter(Boolean).join(' '), role: Number(m.role), active: m.is_active !== false,
        } as Member]));
      });
    } catch (e) {
      if (blockedFor() > 0) throw e;
      return null;
    }
  }
  async function personOf(scope: TrackerScope, who: any): Promise<Person> {
    const uid = idOf(who);
    const members = await membersOf(scope);
    const m = members && uid ? members.get(uid) : undefined;
    const name = who && typeof who === 'object' ? nameOf(who) : m ? m.name : 'unknown';
    if (!uid || !members) return { name, association: 'unknown' };
    return { name, association: m && m.active ? roleAssociation(m.role) : 'outside' };
  }
  const me = () => keep('me', async () => { const u = await get('/users/me/'); return { id: String(u.id || ''), name: nameOf(u) }; });

  /**
   * Someone of the project by what the person typed: "me", the display name Plane shows ("member"), the address, the
   * whole name or its first word. Their id. Work items go to an Admin or a Member: Plane refuses a Guest as assignee.
   */
  async function memberBy(scope: TrackerScope, who: string, toAssign: boolean): Promise<string> {
    const w = who.trim().toLowerCase();
    if (w === 'me') return (await me()).id;
    const list = [...((await membersOf(scope)) || new Map<string, Member>()).entries()].filter(([, m]) => m.active);
    const found = list.find(([id]) => id === w)
      || list.find(([, m]) => m.display.toLowerCase() === w)
      || list.find(([, m]) => m.email.toLowerCase() === w)
      || list.find(([, m]) => m.full.toLowerCase() === w)
      || list.find(([, m]) => m.first.toLowerCase() === w);
    if (!found) throw new Error(`${who} is no member of the project`);
    if (toAssign && found[1].role < 15) throw new Error(`${who} is a Guest of the project: Plane gives work items to its Admins and Members only`);
    return found[0];
  }
  const statesOf = async (scope: TrackerScope) => {
    const project = await projectOf(scope);
    return keep(`states:${scope.id}`, async () => (await pages(`${project.path}/states/`, (s) => s && s.id && !s.is_triage, 1000))
      .map((s: any) => ({ id: String(s.id), name: String(s.name || ''), group: String(s.group || '') })));
  };
  const labelsOf = async (scope: TrackerScope) => {
    const project = await projectOf(scope);
    return keep(`labels:${scope.id}`, async () => new Map((await pages(`${project.path}/labels/`, (l) => l && l.id && l.name, 1000))
      .map((l: any) => [String(l.name).toLowerCase(), String(l.id)] as [string, string])));
  };

  /** The work item behind an id of the scope (its project checked), as the API gives it. */
  async function itemIn(scope: TrackerScope, id: string, expand = ''): Promise<any> {
    const { slug, ident } = partsOf(scope);
    const m = ITEM_RE.exec(id);
    if (!m) throw new Error(`not a work item: ${id}`);
    if (m[1] !== ident) throw new Error(`${id} is not a work item of ${scope.id}`);
    const project = await projectOf(scope);
    const i = await get(`/workspaces/${slug}/work-items/${id}/${expand ? `?${expand}` : ''}`);
    if (!i || String(i.project) !== project.id || !UUID_RE.test(String(i.id || ''))) throw new Error(`${id} is not a work item of ${scope.id}`);
    return i;
  }
  const itemUrl = (scope: TrackerScope, id: string) => `${base()}/${partsOf(scope).slug}/browse/${id}/`;
  const failed = (e: unknown): WriteResult => ({ ok: false, error: String((e as Error).message || e) });

  return {
    id: api.name,
    title: 'Plane',
    label: 'PLANE',
    noun: { one: 'work item', many: 'work items' },
    capabilities: {
      views: ['open', 'mine', 'assigned', 'iteration', 'query'],
      iterationWord: 'cycle',
      comment: true, worklog: false, transition: true, labels: true, assign: true, create: true,
      request: 'none',
    },
    idPattern: ITEM_RE,
    tokenVariables: ['PLANE_API_KEY', 'PLANE_TOKEN'],
    secret: () => token(),
    tokenShapes: [['a Plane API key', KEY_RE]],
    ready: () => (!base() ? `no Plane address in ${api.settings.file} (url)` : !token() ? `no API key in ${api.settings.file} (token)` : ''),
    // A workspace project has no Plane project of its own: it remembers one, or the default is used.
    scopeOf: () => null,
    parseScope: (text) => {
      const t = String(text || '').trim();
      const [slug, ident, more] = t.split('/');
      return more === undefined && SLUG_RE.test(slug || '') && IDENT_RE.test(ident || '') && base()
        ? { id: `${slug}/${ident}`, name: `${slug}/${ident}`, web: `${base()}/${slug}/projects/` }
        : null;
    },
    urlOf: (scope, id) => itemUrl(scope, id),
    account: async () => { try { return (await me()).name; } catch (_) { return ''; } },
    // The projects of the workspaces the settings name (the default scope and the list).
    scopes: async () => {
      const s = settings();
      const named = [configured(s.default_scope), ...(Array.isArray(s.scopes) ? s.scopes.map(configured) : [])];
      const slugs = [...new Set(named.map((x) => x.split('/')[0]).filter((x) => SLUG_RE.test(x)))];
      const all: TrackerScope[] = [];
      for (const slug of slugs) {
        const rows = await pages(`/workspaces/${slug}/projects/`, (x) => x && IDENT_RE.test(String(x.identifier || '')), 500);
        for (const x of rows) all.push({ id: `${slug}/${x.identifier}`, name: String(x.name || x.identifier), web: `${base()}/${slug}/projects/${x.id}/issues/` });
      }
      return all;
    },

    list: async (scope, q) => {
      const { slug, ident } = partsOf(scope);
      const project = await projectOf(scope);
      const limit = Math.max(1, Math.min(q.limit, 100));
      let source = `${project.path}/work-items/?${EXPAND}&order_by=-updated_at`;
      let take = (i: any) => isOpen(i);
      let iteration = '';
      const assignedTo = (i: any, uid: string) => (Array.isArray(i.assignees) ? i.assignees : []).some((a: any) => idOf(a) === uid);
      if (q.view === 'mine') { const mine = (await me()).id; take = (i) => isOpen(i) && assignedTo(i, mine); }
      if (q.view === 'assigned') {
        if (!q.who) return [];
        const uid = await memberBy(scope, q.who, false);
        take = (i) => isOpen(i) && assignedTo(i, uid);
      }
      if (q.view === 'iteration') {
        const cycle = currentCycle(await get(`${project.path}/cycles/?cycle_view=current`));
        if (!cycle) return [];
        source = `${project.path}/cycles/${cycle.id}/cycle-issues/?${EXPAND}&order_by=-updated_at`;
        iteration = `cycle ${cycle.name}`;
      }
      if (q.view === 'query') {
        const words = String(q.text || '').trim().toLowerCase();
        take = (i) => isOpen(i) && String(i.name || '').toLowerCase().includes(words);
      }
      return (await pages(source, take, limit)).map((i) => itemOf(i, base(), slug, ident, iteration));
    },

    get: async (scope, id) => {
      const { slug, ident } = partsOf(scope);
      const project = await projectOf(scope);
      const i = await itemIn(scope, id, `${EXPAND}%2Ccreated_by`);
      const at = `${project.path}/work-items/${i.id}`;
      const members = await membersOf(scope);
      const names = new Map([...(members || new Map<string, Member>()).entries()].map(([uid, m]) => [uid, m.name] as [string, string]));
      const author = await personOf(scope, i.created_by);
      // The last editor: the actor of the newest change of the title or the description, when not the creator.
      const edits = await pages(`${at}/activities/?expand=actor&order_by=-created_at`, (a) => a && a.verb === 'updated' && (a.field === 'name' || a.field === 'description'), 1);
      let lastEditor: Person | undefined;
      if (edits.length && edits[0].actor && idOf(edits[0].actor) !== idOf(i.created_by)) lastEditor = await personOf(scope, edits[0].actor);
      const comments = [];
      for (const c of await pages(`${at}/comments/?expand=actor`, (x) => x && !x.deleted_at, 500)) {
        const body = textOf(String(c.comment_html || ''), names);
        if (body) comments.push({ author: await personOf(scope, c.actor), body, at: String(c.created_at || '') });
      }
      const full: TrackerItemFull = { ...itemOf(i, base(), slug, ident), body: textOf(String(i.description_html || ''), names), author, ...(lastEditor ? { lastEditor } : {}), comments };
      return full;
    },

    comment: async (scope, id, markdown) => {
      try {
        const i = await itemIn(scope, id);
        const project = await projectOf(scope);
        const r = await write('POST', `${project.path}/work-items/${i.id}/comments/`, { comment_html: htmlOf(markdown) }, itemUrl(scope, id));
        const cid = r.ok && r.data && r.data.id ? String(r.data.id) : '';
        return r.ok ? { ok: true, error: '', url: `${itemUrl(scope, id)}${cid ? `#comment-${cid}` : ''}`, ...(cid ? { id: cid } : {}) } : r;
      } catch (e) { return failed(e); }
    },
    transitions: async (scope, id) => {
      const i = await itemIn(scope, id);
      const now = idOf(i.state);
      return (await statesOf(scope)).filter((s) => s.id !== now).map((s) => ({ id: s.id, name: s.name }));
    },
    transition: async (scope, id, to) => {
      if (!UUID_RE.test(to)) return { ok: false, error: `not a state: ${to}` };
      try {
        if (!(await statesOf(scope)).some((s) => s.id === to)) return { ok: false, error: `not a state of ${scope.id}: ${to}` };
        const i = await itemIn(scope, id);
        const project = await projectOf(scope);
        return await write('PATCH', `${project.path}/work-items/${i.id}/`, { state: to }, itemUrl(scope, id));
      } catch (e) { return failed(e); }
    },
    labels: async (scope, id, add, remove) => {
      try {
        const all = await labelsOf(scope);
        const missing = add.filter((n) => !all.has(n.trim().toLowerCase()));
        if (missing.length) return { ok: false, error: `no label ${missing.map((n) => `"${n}"`).join(', ')} in ${scope.id}: Plane's labels belong to the project, so add it there first` };
        const i = await itemIn(scope, id);
        const ids = new Set((Array.isArray(i.labels) ? i.labels : []).map(idOf));
        for (const n of add) ids.add(all.get(n.trim().toLowerCase()) as string);
        for (const n of remove) { const lid = all.get(n.trim().toLowerCase()); if (lid) ids.delete(lid); }
        const project = await projectOf(scope);
        return await write('PATCH', `${project.path}/work-items/${i.id}/`, { labels: [...ids] }, itemUrl(scope, id));
      } catch (e) { return failed(e); }
    },
    assign: async (scope, id, whom) => {
      try {
        const uid = await memberBy(scope, whom, true);
        const i = await itemIn(scope, id);
        const project = await projectOf(scope);
        return await write('PATCH', `${project.path}/work-items/${i.id}/`, { assignees: [uid] }, itemUrl(scope, id));
      } catch (e) { return failed(e); }
    },
    create: async (scope, item) => {
      try {
        const { ident } = partsOf(scope);
        const project = await projectOf(scope);
        const r = await write('POST', `${project.path}/work-items/`, { name: item.title, description_html: htmlOf(item.body) }, '');
        const seq = r.ok && r.data ? Number(r.data.sequence_id) : 0;
        if (!r.ok) return r;
        if (!seq) return { ok: false, error: 'Plane made the work item but did not say its number' };
        const nid = `${ident}-${seq}`;
        return { ok: true, error: '', id: nid, url: itemUrl(scope, nid) };
      } catch (e) { return failed(e); }
    },
  };
}
