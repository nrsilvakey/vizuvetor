import asyncio, os
from playwright.async_api import async_playwright
IMG=1254
FRENTE_RECT=(0,0,745,790)
CONTORNO=[(250,5),(300,40),(360,55),(430,40),(470,5),(560,25),(650,60),(700,180),(740,330),(735,375),(615,390),(612,780),(160,780),(150,400),(20,370),(15,330),(60,170),(110,60),(200,25)]
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=os.environ.get('CHROME','/usr/bin/google-chrome'))
        pg=await (await b.new_context(viewport={'width':1500,'height':1000},accept_downloads=True)).new_page(); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
        await pg.goto(os.environ.get('URL','http://localhost:4173/'))
        await pg.fill('input[placeholder^="Ex.:"]','Lyon Futebol Clube')
        await pg.set_input_files('input[type=file][multiple]', os.environ.get('ARTE','/tmp/e2e/lyon.jpg')); await pg.wait_for_selector('.stage-svg')
        async def scr(x,y):
            return await pg.evaluate(f"(()=>{{const m=document.querySelector('.stage-svg').getScreenCTM();const q=new DOMPoint({x},{y}).matrixTransform(m);return [q.x,q.y]}})()")
        await pg.click('text=+ Frente')
        a=await scr(FRENTE_RECT[0]+1,FRENTE_RECT[1]+1); b_=await scr(FRENTE_RECT[2],FRENTE_RECT[3])
        await pg.mouse.move(*a); await pg.mouse.down(); await pg.mouse.move(*b_, steps=8); await pg.mouse.up()
        await pg.click('button:has-text("Contornar a peça")')
        await pg.mouse.move(*(await scr(*CONTORNO[0]))); await pg.mouse.down()
        for x,y in CONTORNO[1:]+[CONTORNO[0]]: await pg.mouse.move(*(await scr(x,y)), steps=10)
        await pg.mouse.up(); await pg.wait_for_timeout(300)
        await pg.screenshot(path='/tmp/e2e/13-lyon-contorno.png')
        await pg.click('text=Separar as peças →'); await pg.wait_for_selector('.paint img')
        await pg.select_option('select[aria-label="Tipo de arte"]','uniforme'); await pg.wait_for_timeout(300)
        await pg.click('text=Separar esta peça')
        await pg.wait_for_function("!document.querySelector('.busyline')",timeout=180000); await pg.wait_for_timeout(500)
        print(await pg.locator('.separar .canvasbox .hint').last.text_content())
        await pg.screenshot(path='/tmp/e2e/14-lyon-separado.png')
        await pg.click('text=Ir para o editor →'); await pg.wait_for_selector('.page-svg'); await pg.wait_for_timeout(500)
        print('objetos:', [t.replace('\n',' | ') for t in await pg.locator('.layers li').all_inner_texts()])
        await pg.click('nav >> text=5 Exportar'); await pg.wait_for_selector('text=Gerar PDF de 3 páginas')
        async with pg.expect_download(timeout=300000) as di: await pg.click('text=Gerar PDF de 3 páginas')
        d=await di.value; await d.save_as('/tmp/e2e/lyon.pdf'); print('pdf ok')
        print('ERROS',errs); await b.close()
asyncio.run(main())
