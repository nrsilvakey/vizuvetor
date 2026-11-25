import asyncio, os
from playwright.async_api import async_playwright
CONTORNO=[(800,40),(900,10),(1000,15),(1090,10),(1200,60),(1250,330),(1245,380),(1150,390),(1150,790),(820,790),(800,400),(745,390),(745,300),(760,100)]
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=os.environ.get('CHROME','/usr/bin/google-chrome'))
        pg=await (await b.new_context(viewport={'width':1500,'height':1100},accept_downloads=True)).new_page(); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
        await pg.goto(os.environ.get('URL','http://localhost:4173/'))
        await pg.fill('input[placeholder^="Ex.:"]','Lyon costas')
        await pg.set_input_files('input[type=file][multiple]', os.environ.get('ARTE','/tmp/e2e/lyon.jpg')); await pg.wait_for_selector('.stage-svg')
        async def scr(x,y): return await pg.evaluate(f"(()=>{{const m=document.querySelector('.stage-svg').getScreenCTM();const q=new DOMPoint({x},{y}).matrixTransform(m);return [q.x,q.y]}})()")
        await pg.click('text=+ Costas'); a=await scr(746,1); c=await scr(1253,790)
        await pg.mouse.move(*a); await pg.mouse.down(); await pg.mouse.move(*c, steps=8); await pg.mouse.up()
        await pg.click('button:has-text("Contornar a peça")')
        await pg.mouse.move(*(await scr(*CONTORNO[0]))); await pg.mouse.down()
        for x,y in CONTORNO[1:]+[CONTORNO[0]]: await pg.mouse.move(*(await scr(x,y)), steps=10)
        await pg.mouse.up()
        await pg.click('text=Separar as peças →'); await pg.wait_for_selector('.paint img')
        await pg.select_option('select[aria-label="Tipo de arte"]','uniforme'); await pg.wait_for_timeout(200)
        await pg.click('text=Separar esta peça'); await pg.wait_for_function("!document.querySelector('.busyline')",timeout=180000)
        rw=await pg.evaluate("document.querySelector('.paint img').naturalWidth")
        await pg.click('.brushes button:has-text("Texto")')
        for nome,(x0,y0,x1,y1) in [('LYON',(845,152,1132,236)),('FUTEBOL CLUBE',(848,236,1130,280)),('10',(862,292,1118,598))]:
            cb=await pg.locator('.paint canvas').bounding_box(); k=cb['width']/rw
            await pg.mouse.move(cb['x']+(x0-745)*k, cb['y']+y0*k); await pg.mouse.down(); await pg.mouse.move(cb['x']+(x1-745)*k, cb['y']+y1*k, steps=6); await pg.mouse.up()
            await pg.wait_for_function("(()=>{const b=[...document.querySelectorAll('.card.on button')].find(x=>x.textContent.includes('Identificar')||x.textContent.includes('Lendo'));return b&&!b.disabled})()",timeout=120000)
            lido=await pg.locator('.card.on input').first.input_value()
            if lido.replace(' ','').upper()!=nome.replace(' ',''): await pg.locator('.card.on input').first.fill(nome)
            await pg.click('.card.on button:has-text("Identificar a fonte")')
            await pg.wait_for_selector('.fontrank li', timeout=120000)
            top=await pg.locator('.fontrank li').all_inner_texts()
            print(f'{nome}: OCR leu "{lido}" | top3:', [t.split("\n")[0]+' '+t.split("\n")[1][:4] for t in top[:3]])
            await pg.locator('.fontrank li button').first.click(); await pg.wait_for_timeout(400)
        await pg.screenshot(path='/tmp/e2e/15-texto.png')
        await pg.click('text=Ir para o editor →'); await pg.wait_for_selector('.page-svg'); await pg.wait_for_timeout(600)
        print('objetos:', [t.replace('\n',' | ') for t in await pg.locator('.layers li').all_inner_texts()])
        await pg.click('nav >> text=5 Exportar'); await pg.wait_for_selector('text=Gerar PDF de 3 páginas')
        async with pg.expect_download(timeout=300000) as di: await pg.click('text=Gerar PDF de 3 páginas')
        d=await di.value; await d.save_as('/tmp/e2e/lyon_texto.pdf'); print('pdf ok')
        print('ERROS',errs); await b.close()
asyncio.run(main())
