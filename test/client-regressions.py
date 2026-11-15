"""Public-client regressions: room lifecycle, prompt races, queue budgets and rate rejection.
Requires the same Python Playwright setup as test/browser.py. Uses isolated servers.
"""
import asyncio,json,subprocess,os,time
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML='''<!doctype html><html><body><coact-room id="room" style="display:block;width:1000px;height:700px"></coact-room><script type="module">
import {createCoact} from '/src/coact.js';
const params=new URLSearchParams(location.search);
window.coact=createCoact('#room',{room:params.get('room')});
window.trace={status:[],errors:[],unsaved:[],acks:[],conflicts:[],ready:0};
for(const [event,key] of [['error','errors'],['unsaved','unsaved'],['ack','acks'],['conflict','conflicts'],['status','status']])coact.on('coact:'+event,e=>trace[key].push(e.detail));
coact.on('coact:ready',()=>trace.ready++);
coact.element.registerWindow('notes',{open:params.get('seed')!=='false',content:()=>document.createElement('p')});
coact.element.registerWindow('local-only',{open:false});
</script></body></html>'''
async def run():
 (ROOT/'work').mkdir(exist_ok=True)
 (ROOT/'work'/'client-regression.html').write_text(HTML,encoding='utf-8')
 code="""import {createCoactServer} from './server.js';import {setTimeout as pause} from 'node:timers/promises';import fs from 'node:fs';
const normal=createCoactServer({port:0,host:'127.0.0.1',rateLimit:{messagesPerSecond:100000,burst:100000},authorize:async({message})=>{if(message.type==='frame'&&message.prompt==='Remote version')await pause(50);return {allowed:true,role:'owner'};}});
const limited=createCoactServer({port:0,host:'127.0.0.1',rateLimit:{messagesPerSecond:.01,burst:4}});
const html=fs.readFileSync('work/client-regression.html');
for(const app of [normal,limited]){const original=app.server.listeners('request')[0];app.server.removeAllListeners('request');app.server.on('request',(req,res)=>{if(new URL(req.url,'http://localhost').pathname==='/review.html'){res.writeHead(200,{'content-type':'text/html'});res.end(html);}else original(req,res);});}
console.log(JSON.stringify({normal:(await normal.start()).port,limited:(await limited.start()).port}));"""
 proc=subprocess.Popen(['node','--input-type=module','-e',code],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
 try:
  ports=json.loads(proc.stdout.readline())
  async with async_playwright() as p:
   chrome=os.environ.get('COACT_CHROME')
   default=Path(r'C:\Program Files\Google\Chrome\Application\chrome.exe')
   if not chrome and default.exists():chrome=str(default)
   browser=await p.chromium.launch(headless=True,**({'executable_path':chrome} if chrome else {}))
   errors=[]
   async def tab(room,kind='normal',seed=True):
    a=await browser.new_page(viewport={'width':1200,'height':900})
    a.on('pageerror',lambda error:errors.append(str(error)))
    await a.goto(f'http://127.0.0.1:{ports[kind]}/review.html?room={room}&seed={str(seed).lower()}')
    await a.wait_for_function('window.coact?.self.id && trace.ready===1')
    if seed:await a.wait_for_function('coact.revision>=1')
    return a
   a=await tab('switch-a')
   await a.evaluate("coact.request('sheet',{action:'cell',address:'A1',value:'Room A'})")
   old_id=await a.evaluate('coact.self.id')
   await a.evaluate("coact.disconnect();coact.element.setAttribute('room','switch-b');coact.connect()")
   await a.wait_for_function('id=>coact.self.id!==id && trace.ready===2 && coact.windows.notes',arg=old_id)
   assert await a.evaluate('Object.keys(coact.element.sheet.cells).length')==0
   await a.evaluate("coact.disconnect();coact.element.setAttribute('room','switch-a');coact.connect()")
   await a.wait_for_function("trace.ready===3 && coact.element.sheet.cells.A1==='Room A'")
   await a.close();print('PASS fresh-room initialization and returning without reset',flush=True)

   a=await tab('prompt-race',seed=False);b=await tab('prompt-race',seed=False)
   await a.evaluate("async()=>{await coact.objects.set('race',{kind:'frame',x:.05,y:.05,w:.3,h:.3});await coact.request('frame',{action:'update',id:'race',prompt:'Original'});}")
   await b.wait_for_function("coact.frames.race?.prompt==='Original'")
   await b.evaluate("window.remoteSave=coact.request('frame',{action:'update',id:'race',prompt:'Remote version'});true")
   locked=await a.evaluate("()=>{const input=coact.element.shadowRoot.querySelector('.cw-frame-prompt');input.focus();const locked=input.readOnly;input.value='Local draft from original';input.dispatchEvent(new InputEvent('input',{bubbles:true}));return locked;}")
   assert locked
   await b.evaluate('remoteSave')
   await a.wait_for_function("!coact.element.shadowRoot.querySelector('.cw-frame-prompt').readOnly")
   assert await a.locator('.cw-frame-prompt').input_value()=='Remote version'
   assert await b.evaluate('coact.frames.race.prompt')=='Remote version'
   assert await a.evaluate("trace.unsaved.some(e=>e.code==='edit_access_pending' && e.operations[0].prompt==='Local draft from original')")
   await a.locator('.cw-frame-prompt').fill('Local after latest')
   await b.wait_for_function("coact.frames.race.prompt==='Local after latest'")
   await a.evaluate('coact.disconnect()')
   assert await a.locator('.cw-frame-prompt').evaluate('(e)=>e.readOnly')
   await a.close();await b.close();print('PASS prompt awaits lease/latest content, preserves early draft and rejects offline typing',flush=True)

   a=await tab('queue-limit');b=await tab('queue-limit')
   pressure=await a.evaluate("async()=>{window.saves=Array.from({length:129},(_,i)=>coact.request('sheet',{action:'cell',address:'A1',value:String(i)}));const returned=coact.element.openWindow('local-only');let code;try{await coact.request('sheet',{action:'cell',address:'B1',value:'overflow'});}catch(e){code=e.code;}return {rejected:returned===false,present:!!coact.windows['local-only'],code,unsaved:trace.unsaved};}")
   assert pressure['rejected'] and not pressure['present'] and pressure['code']=='queue_full'
   assert any(e['code']=='queue_full' for e in pressure['unsaved'])
   await a.evaluate('Promise.all(saves)')
   await b.wait_for_function("coact.element.sheet.cells.A1==='128'")
   assert not await b.evaluate("!!coact.windows['local-only']")
   assert await a.evaluate('coact.stats.pendingBytes')==0
   await a.evaluate("coact.element.setAttribute('max-pending-bytes','4096')")
   bounded=await a.evaluate("async()=>{const first=coact.request('sheet',{action:'replace',cells:Object.fromEntries(Array.from({length:8},(_,i)=>[String.fromCharCode(65+i)+'1','x'.repeat(450)]))});let code;try{await coact.request('sheet',{action:'replace',cells:Object.fromEntries(Array.from({length:8},(_,i)=>[String.fromCharCode(65+i)+'2','y'.repeat(450)]))});}catch(e){code=e.code;}const stats=coact.stats;await first;return {code,stats};}")
   assert bounded['code']=='queue_full' and bounded['stats']['pendingBytes']<=4096
   large=await a.evaluate("async()=>{try{await coact.request('sheet',{action:'replace',cells:Object.fromEntries(Array.from({length:400},(_,i)=>[String.fromCharCode(65+i%10)+(1+Math.floor(i/10)),'x'.repeat(500)]))});}catch(e){return e.code;}}")
   assert large=='payload_too_large'
   immutable=await a.evaluate("async()=>{const first=coact.request('sheet',{action:'cell',address:'B1',value:'block'});const cells={C1:'before'};const second=coact.request('sheet',{action:'replace',cells});cells.C1='after';await Promise.all([first,second]);return coact.element.sheet.cells.C1;}")
   assert immutable=='before'
   assert await a.evaluate("coact.element.openWindow('local-only') instanceof HTMLElement")
   await b.wait_for_function("!!coact.windows['local-only']")
   await a.close();await b.close();print('PASS queue count/byte caps, atomic local UI, oversized payload and recovery',flush=True)

   a=await tab('rate-limit',kind='limited',seed=False)
   outcome=await a.evaluate("async()=>{const start=performance.now();for(let i=0;i<8;i++)coact.cursor.publish({x:.5,y:.5});try{await coact.request('sheet',{action:'cell',address:'A1',value:'saved?'});}catch(e){return {code:e.code,ms:performance.now()-start};}}")
   assert outcome['code']=='rate_limited' and outcome['ms']<2000,outcome
   assert await a.evaluate("trace.unsaved.some(e=>e.code==='rate_limited' && e.operations.some(m=>m.address==='A1'))")
   await a.close();assert not errors,errors
   await browser.close();print('PASS immediate rate rejection with recoverable unconfirmed draft',flush=True)
 finally:
  proc.terminate();proc.wait(timeout=8)
if __name__=='__main__':asyncio.run(run())
