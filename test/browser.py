"""Integration smoke tests against a fresh reference server and two real browser pages.
Setup: python -m pip install playwright; python -m playwright install chromium
Run: npm run test:browser (COACT_CHROME may select an installed Chromium executable).
"""
import asyncio, os, subprocess, tempfile, zipfile
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
TRACE = """window.coactTest={unsaved:[],acks:[],locks:[],actions:[],journals:[]};
for(const [name,key] of [['unsaved','unsaved'],['ack','acks'],['lock','locks'],['action','actions'],['journal','journals']])
 document.addEventListener('coact:'+name,e=>coactTest[key].push(e.detail));"""

async def run():
    code = """import {createCoactServer} from './server.js';
const app=createCoactServer({port:0,host:'127.0.0.1',lockTtlMs:3000,maintenanceMs:100,
authenticate:async (_r,u)=>({id:u.searchParams.get('user')||'demo'}),
authorize:async ({user})=>({allowed:true,role:user.id==='viewer'?'viewer':'owner'})});
console.log((await app.start()).port);"""
    server = subprocess.Popen(['node','--input-type=module','-e',code],cwd=ROOT,
        stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,
        creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    try:
        port = int(server.stdout.readline().strip())
        url = f'http://127.0.0.1:{port}/?room=integration'
        async with async_playwright() as p:
            chrome = os.environ.get('COACT_CHROME')
            windows_chrome = Path(r'C:\Program Files\Google\Chrome\Application\chrome.exe')
            if not chrome and windows_chrome.exists(): chrome = str(windows_chrome)
            browser = await p.chromium.launch(headless=True, **({'executable_path':chrome} if chrome else {}))
            errors = []
            async def page(url=url, mobile=False):
                tab = await browser.new_page(viewport={'width':390,'height':844} if mobile else {'width':1440,'height':900},reduced_motion='reduce')
                tab.on('pageerror',lambda error: errors.append(str(error)))
                await tab.add_init_script(TRACE)
                await tab.goto(url)
                await tab.wait_for_function("window.__coact?.self.id && document.querySelector('#room').hasAttribute('data-state-loaded')")
                return tab
            async def wait_cell(tab,address,value):
                await tab.wait_for_function("([address,value])=>__coact.element.sheet.cells[address]===value",arg=[address,value])
            async def save(tab,address,value,base=None):
                return await tab.evaluate("async ([address,value,base])=>{try{return await __coact.request('sheet',{action:'cell',address,value,...(base==null?{}:{baseRevision:base})});}catch(e){return {code:e.code};}}",[address,value,base])
            async def unlocked(tab,path):
                await tab.wait_for_function("path=>!__coact.locks[path]",arg=path)
            a = await page(); await a.wait_for_function('__coact.revision>=3')
            b = await page(); await b.wait_for_function('__coact.online===2')
            assert await a.evaluate('__coact.self.color') != await b.evaluate('__coact.self.color')
            assert await a.evaluate('__coact.self.name') != await b.evaluate('__coact.self.name')
            assert await b.locator('[data-window=board]').get_attribute('aria-pressed') == 'true'
            print('PASS hydration, sidebar state and distinct identities')

            results = await a.evaluate("async()=>Promise.all(Array.from({length:12},(_,i)=>__coact.request('sheet',{action:'cell',address:'E2',value:'draft-'+i})))")
            assert all(r['accepted'] for r in results)
            await wait_cell(b,'E2','draft-11')
            base = await a.evaluate('__coact.revision')
            results = await asyncio.gather(save(a,'E3','Ada',base),save(b,'F3','Kai',base))
            assert all(r.get('accepted') for r in results)
            results = await asyncio.gather(save(a,'E4','one',base),save(b,'E4','two',base))
            assert sum(bool(r.get('accepted')) for r in results)==1
            assert sum(r.get('code')=='stale_revision' for r in results)==1
            expected_unsaved=sum([await tab.evaluate('coactTest.unsaved.length') for tab in [a,b]])
            print('PASS sequential queue, independent cells and simultaneous same-cell conflict')

            # A real focused input holds a lease. The other page can inspect but cannot type.
            ca=a.locator('input[data-cell=F2]'); cb=b.locator('input[data-cell=F2]')
            await ca.focus()
            await a.wait_for_function("__coact.locks['sheet.F2']?.actorId===__coact.self.id")
            await a.wait_for_function("!document.querySelector('input[data-cell=F2]').readOnly")
            await ca.fill('共同創作')
            await wait_cell(b,'F2','共同創作')
            await cb.focus()
            assert await cb.evaluate('(e)=>e.readOnly')
            expiry = await a.evaluate("__coact.locks['sheet.F2'].expiresAt")
            await a.wait_for_function("expiry=>__coact.locks['sheet.F2']?.expiresAt>expiry",arg=expiry,timeout=6000)
            assert not await ca.evaluate('(e)=>e.readOnly')
            await a.locator('#code-button').focus()
            await b.wait_for_function("__coact.locks['sheet.F2']?.actorId===__coact.self.id")
            await b.wait_for_function("!document.querySelector('input[data-cell=F2]').readOnly")
            await cb.fill('Passed on'); await wait_cell(a,'F2','Passed on')
            await b.locator('#code-button').focus(); await unlocked(a,'sheet.F2')
            print('PASS input lock, renewal, release and peer handoff')

            # Cell-to-formula focus keeps the same lease; changes recalculate on both pages.
            await a.locator('input[data-cell=D2]').focus()
            await a.wait_for_function("__coact.locks['sheet.D2']?.actorId===__coact.self.id")
            await a.locator('.formula-input').focus()
            await a.locator('.formula-input').fill('10')
            await wait_cell(b,'D2','10')
            await b.wait_for_function("document.querySelector('input[data-cell=D6]').value==='23'")
            await a.locator('#code-button').focus(); await unlocked(b,'sheet.D2')
            print('PASS formula bar lease and SUM recomputation')

            # Registered window motion must retain its element and avoid repeating animation.
            board=a.locator('coact-room').locator('.cw-window').first
            head=board.locator('.cw-window-head')
            oldx=await a.evaluate('__coact.windows.board.x')
            await b.evaluate("window.boardNode=document.querySelector('coact-room').shadowRoot.querySelector('.cw-window')")
            box=await head.bounding_box(); await a.mouse.move(box['x']+80,box['y']+20); await a.mouse.down()
            await a.wait_for_function("__coact.locks['window.board']?.actorId===__coact.self.id")
            await a.mouse.move(box['x']+150,box['y']+75,steps=10); await a.mouse.up()
            await b.wait_for_function('old=>Math.abs(__coact.windows.board.x-old)>.01',arg=oldx)
            await unlocked(b,'window.board')
            motion=await b.evaluate("({same:boardNode===document.querySelector('coact-room').shadowRoot.querySelector('.cw-window'),dragging:boardNode.classList.contains('is-dragging'),animations:boardNode.getAnimations().map(a=>a.playState),unsaved:coactTest.unsaved})")
            assert motion['same'] and not motion['dragging'] and all(s in ['finished','idle'] for s in motion['animations']),motion
            print('PASS window drag, lease release and stable remote element')

            await a.evaluate("document.addEventListener('pointerdown',e=>window.lastPointer=e.pointerId,true)")
            async def gesture(handle,scope,dx=25,dy=20,ending='up'):
                box=await handle.bounding_box()
                await a.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);await a.mouse.down()
                await a.wait_for_function('scope=>__coact.locks[scope]?.actorId===__coact.self.id',arg=scope)
                await a.mouse.move(box['x']+box['width']/2+dx,box['y']+box['height']/2+dy,steps=5)
                if ending=='cancel': await handle.evaluate("e=>e.dispatchEvent(new PointerEvent('pointercancel',{pointerId:lastPointer,bubbles:true}))")
                elif ending=='lost': await handle.evaluate("e=>e.closest('.cw-window,.cw-image-frame').releasePointerCapture(lastPointer)")
                elif ending=='blur': await a.evaluate("dispatchEvent(new Event('blur'))")
                await a.mouse.up()
                await unlocked(b,scope)
                assert await a.locator('.is-dragging').count()==0
            width=await a.evaluate('__coact.windows.board.w')
            await gesture(board.locator('.cw-resize'),'window.board')
            assert await a.evaluate('__coact.windows.board.w')>width
            for ending in ['cancel','lost','blur','up']:
                await gesture(head,'window.board',8,6,ending)
            print('PASS resize, pointer cancellation, lost capture, blur and next drag')

            await a.evaluate('__coact.element.startFrameDraw(); __coact.element.cancelFrameDraw()')
            assert await a.evaluate('__coact.revision') >= base
            assert await a.evaluate('__coact.journal.length') > 0
            fid=await a.evaluate("__coact.element.addImageFrame({x:.15,y:.78,w:.25,h:.18})")
            await b.wait_for_function('id=>!!__coact.frames[id]',arg=fid)
            prompt=a.locator('.cw-frame-prompt').last
            await prompt.focus()
            await a.wait_for_function("id=>__coact.locks[`frame.${id}.prompt`]?.actorId===__coact.self.id",arg=fid)
            await prompt.fill('Coact convergence')
            await prompt.press('Enter')
            await b.wait_for_function("id=>__coact.frames[id]?.status==='generated'",arg=fid)
            await a.wait_for_function("id=>__coact.frames[id]?.status==='generated'",arg=fid)
            assert await a.evaluate('id=>__coact.frames[id].seed',fid)==await b.evaluate('id=>__coact.frames[id].seed',fid)
            await a.locator('#code-button').focus();await unlocked(b,f'frame.{fid}.prompt')
            frame=a.locator('.cw-image-frame').last
            await gesture(frame.locator('.cw-frame-head'),f'frame.{fid}',20,-8)
            frame_width=await a.evaluate('id=>__coact.frames[id].w',fid)
            await gesture(frame.locator('.cw-frame-resize'),f'frame.{fid}',22,12)
            assert await a.evaluate('id=>__coact.frames[id].w',fid)>frame_width
            assert sum([await tab.evaluate('coactTest.unsaved.length') for tab in [a,b]])==expected_unsaved
            print('PASS frame prompt, placeholder sync and cancelled drawing preserves state')

            # Failed writes restore server state and expose the rejected draft for copying.
            latest=await a.evaluate('__coact.revision')
            assert (await save(a,'F5','latest'))['accepted']
            await wait_cell(b,'F5','latest')
            result=await save(b,'F5','keep my draft',latest)
            assert result['code']=='stale_revision'
            await wait_cell(b,'F5','latest')
            assert await b.locator('#draft-recovery').is_visible()
            assert await b.evaluate("coactTest.unsaved.some(e=>e.operations.some(m=>m.value==='keep my draft'))")
            await b.locator('#dismiss-drafts').click()
            assert not await b.locator('#draft-recovery').is_visible()
            await a.evaluate("__coact.action('review.requested',{id:'review-1'})")
            await b.wait_for_function("coactTest.actions.some(a=>a.name==='review.requested' && a.payload.id==='review-1')")
            await b.locator('#activity-button').click()
            assert await b.locator('#activity-sheet').get_attribute('aria-hidden')=='false'
            assert await b.locator('.activity-item').count()>0
            await b.locator('#code-button').click()
            assert await b.locator('#activity-sheet').get_attribute('aria-hidden')=='true'
            await b.keyboard.press('Escape')
            assert await b.locator('#code-button').evaluate('(e)=>e===document.activeElement')
            print('PASS conflict recovery, action delivery, Activity and panel keyboard behavior')

            c=await page()
            await wait_cell(c,'F5','latest')
            assert fid in await c.evaluate('Object.keys(__coact.frames)')
            await b.reload();await b.wait_for_function("window.__coact?.self.id && __coact.element.hasAttribute('data-state-loaded')")
            await wait_cell(b,'F5','latest')
            assert await b.locator('[data-window=board]').get_attribute('aria-pressed')=='true'
            assert fid in await b.evaluate('Object.keys(__coact.frames)')
            print('PASS newcomer and reload keep edited data, frames and active navigation')

            # A viewer joins through a separate public facade with an authenticated endpoint.
            await c.evaluate("async()=>{__coact.disconnect(); await new Promise(r=>setTimeout(r,60)); __coact.element.setAttribute('endpoint','/ws?user=viewer'); __coact.connect();}")
            await c.wait_for_function("__coact.self.role==='viewer' && document.querySelector('#connection-dot').dataset.state==='online'")
            assert not await c.evaluate("__coact.element.updateSheetCell('A1','forbidden')")
            assert (await save(c,'A1','forbidden'))['code']=='forbidden'
            assert await c.locator('input[data-cell=A1]').evaluate('(e)=>e.readOnly')
            print('PASS viewer cannot write through UI or public request API')

            # Disconnect releases a lock and reconnect hydrates rather than resets.
            await a.locator('input[data-cell=F6]').focus()
            await a.wait_for_function("__coact.locks['sheet.F6']?.actorId===__coact.self.id")
            await a.evaluate('__coact.disconnect()');await unlocked(b,'sheet.F6')
            await a.evaluate('__coact.connect()');await a.wait_for_function("document.querySelector('#connection-dot').dataset.state==='online'")
            await wait_cell(a,'F5','latest')
            print('PASS disconnect cleanup and reconnect hydration')

            # Export includes formulas; CSV import goes through the same acknowledged mutation.
            await b.evaluate("__coact.element.focusWindow('sheet')")
            with tempfile.TemporaryDirectory() as tmp:
                async with b.expect_download() as download:
                    await b.locator('[data-sheet-action=export]').click()
                target=Path(tmp)/'coact.xlsx';await (await download.value).save_as(target)
                with zipfile.ZipFile(target) as workbook:
                    assert 'SUM(D2:D5)' in workbook.read('xl/worksheets/sheet1.xml').decode()
            await b.locator('input.sheet-import').set_input_files({'name':'shared.csv','mimeType':'text/csv','buffer':b'Team,Status\nCoact,Ready'})
            await b.wait_for_function("coactTest.unsaved.some(e=>e.code==='locked' && e.operations.some(m=>m.action==='replace'))")
            assert await a.evaluate('__coact.element.sheet.cells.A1')=='Workstream'
            await a.locator('#code-button').focus();await unlocked(b,'sheet.F6')
            await b.locator('input.sheet-import').set_input_files({'name':'shared.csv','mimeType':'text/csv','buffer':b'Team,Status\nCoact,Ready'})
            await wait_cell(a,'A1','Team');await wait_cell(a,'B2','Ready')
            print('PASS real XLSX export, locked bulk protection and acknowledged import')

            # Inspect each changed surface at desktop/mobile in the same bounded QA round.
            if os.environ.get('COACT_SCREENSHOTS'):
                dest=Path(os.environ['COACT_SCREENSHOTS']);dest.mkdir(parents=True,exist_ok=True)
                await b.locator('#activity-button').click()
                await b.screenshot(path=str(dest/'activity-desktop.png'))
                m=await page(url+'&mobile=1',True)
                await m.locator('#activity-button').click()
                assert await m.evaluate('document.documentElement.scrollWidth<=innerWidth')
                await m.screenshot(path=str(dest/'activity-mobile.png'))
                await m.close()
            # Reset and intentional empty state must not be confused with a new room.
            await b.evaluate("__coact.request('reset')")
            await wait_cell(b,'A1','Workstream')
            await b.wait_for_function("__coact.windows.board && __coact.windows.sheet && __coact.element.dataset.canSeed==='false'")
            assert await b.evaluate('Object.keys(__coact.frames).length')==0
            await b.evaluate("async()=>{await __coact.request('window',{action:'close',id:'board'});await __coact.request('window',{action:'close',id:'sheet'});await __coact.request('sheet',{action:'replace',cells:{}});}")
            d=await page();assert await d.evaluate('Object.keys(__coact.windows).length')==0
            assert await d.evaluate('Object.keys(__coact.element.sheet.cells).length')==0
            await d.close()
            print('PASS owner reset, default reseeding and intentional empty-room hydration')
            assert not errors, errors
            await browser.close()
            print('PASS no uncaught browser errors')
    finally:
        server.terminate();server.wait(timeout=8)

if __name__=='__main__': asyncio.run(run())
