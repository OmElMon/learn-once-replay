import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';

/** Synthetic legacy portal. State remains in the same browser session during handoff. */
export function startDemo(port = 3100): Server {
  const sessions = new Map<string, { recovered: boolean; verified: boolean }>();
  const members: Record<string, { name: string; balance: string }> = {
    '12345': { name: 'Alex Morgan', balance: '$1,250.00' },
    '67890': { name: 'Sam Rivera', balance: '$8,420.50' },
  };
  const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>
  :root{font:16px Arial,sans-serif;color:#172c3c;background:#edf0f2}body{margin:0}header{background:#173b52;color:white;padding:20px 28px}header p{margin:6px 0 0;color:#cce0eb}main{margin:24px;background:white;border:1px solid #bcc7cf;padding:24px;max-width:900px}h1{font-size:24px;margin:0 0 18px}h2{font-size:20px}label{display:block;font-weight:bold;margin-bottom:8px}input,button{font:inherit;padding:10px;border:1px solid #8599a6;border-radius:3px}button{background:#174f70;color:white;cursor:pointer}a{color:#14557b}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{text-align:left;padding:12px;border:1px solid #cbd3d9}th{background:#eaf0f4}.notice{padding:15px;border-left:4px solid #b77910;background:#fff7e5}iframe{border:0;width:100%;height:650px}footer{margin:24px;color:#596c78;font-size:13px}[role=status]{font-size:30px;font-weight:bold}</style></head><body>${body}</body></html>`;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (req.method !== 'GET' && req.method !== 'POST') { res.writeHead(405).end(); return; }
    const incoming = /(?:^|;\s*)lor_session=([a-f0-9-]+)/.exec(req.headers.cookie ?? '')?.[1];
    const id = incoming && sessions.has(incoming) ? incoming : randomUUID();
    if (!sessions.has(id)) sessions.set(id, { recovered: false, verified: false });
    const state = sessions.get(id)!;
    const scenario = ['transient', 'handoff', 'denied'].includes(url.searchParams.get('scenario') ?? '') ? url.searchParams.get('scenario')! : '';
    const memberId = url.searchParams.get('member_id') ?? '';
    const hidden = `<input type="hidden" name="scenario" value="${escape(scenario)}">`;
    const route = (path: string, fields: Record<string, string> = {}) => `${path}?${new URLSearchParams({ scenario, ...fields })}`;
    res.setHeader('Set-Cookie', `lor_session=${id}; HttpOnly; SameSite=Strict; Path=/`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const send = (title: string, body: string) => res.end(page(title, `<main>${body}</main>`));
    const redirect = (path: string) => { res.writeHead(303, { Location: path }); res.end(); };
    if (url.pathname === '/') {
      res.end(page('Cedar Community Bank — Training', `<header><strong>Cedar Community Bank</strong><p>Member services · Training environment</p></header><iframe title="Banking workspace" src="${escape(route('/workspace'))}"></iframe><footer>Synthetic data only. This portal does not connect to a real financial institution.</footer>`));
      return;
    }
    if (url.pathname === '/retry' && req.method === 'POST') {
      state.recovered = true; redirect(route('/member', { member_id: memberId })); return;
    }
    if (url.pathname === '/verify' && req.method === 'POST') {
      state.verified = true; redirect(route('/member', { member_id: memberId })); return;
    }
    if (url.pathname === '/workspace') {
      send('Member lookup', `<h1>Member lookup</h1><p>Find a member by their five-digit member ID.</p><form action="/member" method="get">${hidden}<label for="member-id">Member ID</label><input id="member-id" name="member_id" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" required autocomplete="off"> <button type="submit">Search</button></form>`);
      return;
    }
    if (url.pathname !== '/member' && url.pathname !== '/balance') { res.statusCode = 404; send('Not found', '<h1>Page not found</h1>'); return; }
    if (scenario === 'denied') { send('Permission denied', '<h1>Permission denied</h1><p>Your session does not have access to member records.</p>'); return; }
    if (scenario === 'transient' && !state.recovered) {
      send('Service interruption', `<h1>Temporary service interruption</h1><p class="notice">The member service is temporarily unavailable. Retry to continue.</p><form action="${escape(route('/retry', { member_id: memberId }))}" method="post"><button type="submit">Retry</button></form>`); return;
    }
    if (scenario === 'handoff' && !state.verified) {
      send('Operator verification', `<h1>Operator verification required</h1><p class="notice">Automation must pause. A human operator must verify this training session before member records can be viewed.</p><form action="${escape(route('/verify', { member_id: memberId }))}" method="post"><button type="submit">Verify session</button></form>`); return;
    }
    const member = members[memberId];
    if (!member) { send('Member not found', `<h1>Member not found</h1><p>No member matches the supplied ID.</p><a href="${escape(route('/workspace'))}">Return to lookup</a>`); return; }
    if (url.pathname === '/member') {
      send('Member details', `<h1>Member details</h1><table><tbody><tr><th scope="row">Member ID</th><td>${escape(memberId)}</td></tr><tr><th scope="row">Name</th><td>${member.name}</td></tr></tbody></table><h2>Accounts</h2><table><thead><tr><th>Account</th><th>Status</th></tr></thead><tbody><tr><td><a href="${escape(route('/balance', { member_id: memberId }))}">Savings account</a></td><td>Active</td></tr></tbody></table>`); return;
    }
    send('Savings balance', `<h1>Savings balance</h1><p>Member ${escape(memberId)} · ${member.name}</p><p role="status" aria-label="Account balance">${member.balance}</p><a href="${escape(route('/workspace'))}">Return to lookup</a>`);
  });
  server.listen(port, '127.0.0.1');
  return server;
}
