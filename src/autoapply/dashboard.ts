import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';

export interface ReviewCard {
  id: string;
  employerKey: string;
  company: string;
  title: string;
  reason?: string;
  questions: string[];
}

/** Loopback-only review UI. It never serves credentials, cookies or evidence files. */
export async function startReviewDashboard(options: {
  port?: number;
  cards: () => ReviewCard[];
  jobs: () => Array<{ id: string; employerKey: string; company: string; title: string; status: string }>;
  open: (id: string) => Promise<void>;
  resume: (id: string) => void;
  step: (id: string) => void;
  answer: (id: string, question: string, value: string | boolean | number, scope?: 'role' | 'company') => void;
}): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  const token = randomBytes(24).toString('hex');
  let origin = '';
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const send = (status: number, data: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
    if (!origin || request.headers.host !== new URL(origin).host) { send(403, { error: 'Forbidden host' }); return; }
    try {
      if (request.method === 'GET' && request.url === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Applications</title><style>body{font:16px system-ui;max-width:960px;margin:32px auto;padding:0 16px;color:#17212b}article{border:1px solid #ccc;border-radius:8px;padding:16px;margin:16px 0}button,textarea{font:inherit;padding:8px;margin:6px 6px 6px 0}textarea{display:block;width:95%}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:8px;border-bottom:1px solid #ddd}#error{color:#a00}</style><h1>Applications</h1><p id="summary" role="status"></p><p id="error" role="alert"></p><main id="reviews"></main><h2>Application history</h2><table><thead><tr><th>Company</th><th>Role</th><th>Status</th></tr></thead><tbody id="history"></tbody></table><script>
const token=${JSON.stringify(token)};let previous='';const drafts=new Map();
async function api(path,data){const r=await fetch(path,data?{method:'POST',headers:{'Content-Type':'application/json','X-Review-Token':token},body:JSON.stringify(data)}:{});if(!r.ok)throw Error('Could not save this change. Refresh and try again.');return r.json()}
function button(text,run){const b=document.createElement('button');b.textContent=text;b.onclick=()=>Promise.resolve().then(run).catch(e=>document.querySelector('#error').textContent=e.message);return b}
function questionKey(text){return text.normalize('NFKC').toLowerCase().replace(/[^\\p{L}\\p{N}+#]+/gu,' ').trim()}
function answerField(parent,card,question,scope,key){
  const label=document.createElement('label');label.textContent=question;
  const input=document.createElement('textarea');input.rows=2;input.value=drafts.get(key)||'';
  input.oninput=()=>drafts.set(key,input.value);label.append(input);parent.append(label);
  parent.append(button(scope==='company'?'Save for company':'Save for this role',async()=>{
    const raw=input.value.trim();if(!raw)return;
    const value=/^(yes|true)$/i.test(raw)?true:/^(no|false)$/i.test(raw)?false:/^\\d+(?:\\.\\d+)?$/.test(raw)?Number(raw):raw;
    await api('/api/answer',{id:card.id,question,value,scope});drafts.delete(key);input.value='';
    document.querySelector('#summary').textContent='Answer saved';
  }));
}
async function refresh(){try{
  const state=await api('/api/state');const signature=JSON.stringify(state);if(signature===previous)return;previous=signature;
  const groups=new Map();for(const card of state.cards){if(!groups.has(card.employerKey))groups.set(card.employerKey,[]);groups.get(card.employerKey).push(card)}
  document.querySelector('#summary').textContent=state.cards.length+' applications across '+groups.size+' companies need attention';
  document.title=state.cards.length?'('+state.cards.length+') Applications':'Applications';
  const reviews=document.querySelector('#reviews');reviews.replaceChildren();
  for(const [companyKey,cards] of groups){
    const section=document.createElement('section');section.className='company-group';section.dataset.employerKey=companyKey;
    const heading=document.createElement('h2');heading.textContent=cards[0].company+' · '+cards.length+' applications';section.append(heading);
    const shared=new Map();for(const card of cards)for(const question of card.questions){const key=questionKey(question);if(!shared.has(key))shared.set(key,{card,question,roles:new Set()});shared.get(key).roles.add(card.id)}
    const common=[...shared.values()].filter(item=>item.roles.size>1);
    if(common.length){const title=document.createElement('h3');title.textContent='Answer once for this company';section.append(title);for(const item of common)answerField(section,item.card,item.question,'company',JSON.stringify([companyKey,questionKey(item.question),'company']))}
    for(const card of cards){
      const article=document.createElement('article');article.dataset.jobId=card.id;const title=document.createElement('h3');title.textContent=card.title;article.append(title);
      const reason=document.createElement('p');reason.textContent=card.reason||'Review required';article.append(reason);
      article.append(button('Open application',()=>api('/api/open',{id:card.id})));
      let overrides;for(const question of card.questions){
        let parent=article;
        if(shared.get(questionKey(question)).roles.size>1){if(!overrides){overrides=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Different answers for this role';overrides.append(summary);article.append(overrides)}parent=overrides}
        answerField(parent,card,question,'role',JSON.stringify([card.id,question,'role']));
      }
      article.append(button('Fill next step',()=>api('/api/step',{id:card.id})));
      article.append(button('Continue after review',()=>api('/api/resume',{id:card.id})));section.append(article);
    }
    reviews.append(section);
  }
  const history=document.querySelector('#history');history.replaceChildren();const companies=new Map();
  for(const job of state.jobs){if(!companies.has(job.employerKey))companies.set(job.employerKey,[]);companies.get(job.employerKey).push(job)}
  for(const jobs of companies.values())for(const [index,job] of jobs.entries()){
    const row=document.createElement('tr');if(index===0){const company=document.createElement('td');company.textContent=job.company;company.rowSpan=jobs.length;row.append(company)}
    for(const value of [job.title,job.status]){const cell=document.createElement('td');cell.textContent=value;row.append(cell)}history.append(row);
  }
}catch(error){document.querySelector('#error').textContent=error.message}}
refresh();setInterval(refresh,2000);
</script></html>`);
        return;
      }
      if (request.method === 'GET' && request.url === '/api/state') { send(200, { cards: options.cards(), jobs: options.jobs() }); return; }
      if (request.method !== 'POST' || request.headers['x-review-token'] !== token || (request.headers.origin && request.headers.origin !== origin) || !request.headers['content-type']?.startsWith('application/json')) { send(403, { error: 'Forbidden' }); return; }
      let raw = '';
      for await (const chunk of request) { raw += chunk.toString(); if (Buffer.byteLength(raw) > 16000) { send(413, { error: 'Request too large' }); return; } }
      const body = JSON.parse(raw) as Record<string, unknown>;
      if (typeof body.id !== 'string' || !options.cards().some(card => card.id === body.id)) { send(404, { error: 'Unknown review' }); return; }
      if (request.url === '/api/open') await options.open(body.id);
      else if (request.url === '/api/resume') options.resume(body.id);
      else if (request.url === '/api/step') options.step(body.id);
      else if (request.url === '/api/answer') {
        if (typeof body.question !== 'string' || !options.cards().find(card => card.id === body.id)!.questions.includes(body.question) || !['string', 'number', 'boolean'].includes(typeof body.value) || (typeof body.value === 'number' && !Number.isFinite(body.value)) || String(body.value).length > 4000) { send(400, { error: 'Invalid answer' }); return; }
        if (body.scope !== undefined && body.scope !== 'role' && body.scope !== 'company') { send(400, { error: 'Invalid answer scope' }); return; }
        options.answer(body.id, body.question, body.value as string | number | boolean, body.scope === 'company' ? 'company' : 'role');
      } else { send(404, { error: 'Not found' }); return; }
      send(200, { saved: true });
    } catch { if (!response.headersSent) send(400, { error: 'Request could not be completed' }); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local dashboard did not bind');
  origin = `http://127.0.0.1:${address.port}`;
  return { server, url: origin, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

