import type { ProjectEntry, User } from './instance';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `
:root { color-scheme: dark; --bg: #16181d; --panel: #1f232b; --line: #2e3440; --text: #d8dee9; --dim: #8b93a3; --accent: #e3a33b; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 640px; margin: 0 auto; padding: 48px 16px; }
h1 { font-size: 24px; margin: 0 0 4px; }
p.dim { color: var(--dim); margin: 0 0 24px; }
ul { list-style: none; padding: 0; margin: 0 0 32px; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
li { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--panel); }
li + li { border-top: 1px solid var(--line); }
li a.name { flex: 1; color: var(--text); font-weight: 600; text-decoration: none; }
li a.name:hover { color: var(--accent); }
a { color: var(--accent); }
form { display: flex; flex-wrap: wrap; gap: 8px; }
input, select, button { font: inherit; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel); color: var(--text); }
input { flex: 1; min-width: 180px; }
button { background: var(--accent); color: #1b1b1b; border: 0; font-weight: 600; cursor: pointer; }
.error { color: #ff7b72; min-height: 1.5em; }
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

export function messagePage(title: string, text: string): string {
  return page(title, `<h1>${esc(title)}</h1><p class="dim">${esc(text)}</p>`);
}

export function homePage(user: User, projects: ProjectEntry[], templates: Record<string, { label: string }>): string {
  const list = projects.length
    ? `<ul>${projects
        .map((p) => {
          const href = `/p/${encodeURIComponent(p.slug)}/`;
          return `<li><a class="name" href="${href}">${esc(p.name)}</a><a href="${href}play.html" target="_blank">▶ Play</a></li>`;
        })
        .join('')}</ul>`
    : '<p class="dim">No projects yet: start one below.</p>';
  const options = Object.entries(templates)
    .map(([k, t]) => `<option value="${esc(k)}">${esc(t.label)}</option>`)
    .join('');
  return page(
    'Projects',
    `<h1>Hi, ${esc(user.name)}!</h1>
<p class="dim">Pick a project to work on. Everyone in a project shares it: save often, and get the latest to see what the others did.</p>
${list}
<h2>Start a project</h2>
<form id="new">
  <input name="name" placeholder="Name of the game" required maxlength="60">
  <select name="template">${options}</select>
  <button>Start</button>
</form>
<p class="error" id="error"></p>
<script>
document.getElementById('new').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: f.get('name'), template: f.get('template') }) });
  const body = await res.json();
  if (!res.ok) { document.getElementById('error').textContent = body.error; return; }
  location.href = '/p/' + encodeURIComponent(body.slug) + '/';
});
</script>`,
  );
}
