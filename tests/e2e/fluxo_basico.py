import asyncio, sys
from playwright.async_api import async_playwright
SHOT='/tmp/e2e/'
async def drag(pg, sel, a, b):
    box=await pg.locator(sel).bounding_box()
    # coordenadas a/b em fração do svg
    await pg.mouse.move(box['x']+box['width']*a[0], box['y']+box['height']*a[1]); await pg.mouse.down()
    await pg.mouse.move(box['x']+box['width']*b[0], box['y']+box['height']*b[1], steps=8); await pg.mouse.up()
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=__import__('os').environ.get('CHROME','/usr/bin/google-chrome'))
        ctx=await b.new_context(viewport={'width':1500,'height':1000}, accept_downloads=True)
        pg=await ctx.new_page(); errs=[]
        pg.on('pageerror',lambda e:errs.append('PAGE:'+str(e)))
        pg.on('console',lambda m:errs.append('CON:'+m.text) if m.type=='error' else None)
        await pg.goto(__import__('os').environ.get('URL','http://localhost:4173/'))
        await pg.fill('input[placeholder^="Ex.:"]','Família de Légua')
        await pg.set_input_files('input[type=file][multiple]','/tmp/e2e/mockup.png')
        await pg.wait_for_selector('.stage-svg')
        # frente: painel 40..600 x 60..940 de 1800x1000
        await pg.click('text=+ Frente'); await drag(pg,'.stage-svg',(40/1800,60/1000),(600/1800,940/1000))
        await pg.click('text=+ Costas'); await drag(pg,'.stage-svg',(640/1800,60/1000),(1200/1800,940/1000))
        await pg.click('text=+ Manga esquerda'); await drag(pg,'.stage-svg',(1260/1800,200/1000),(1500/1800,560/1000))
        await pg.click('text=+ Manga direita'); await drag(pg,'.stage-svg',(1530/1800,200/1000),(1770/1800,560/1000))
        await pg.screenshot(path=SHOT+'1-pecas.png')
        n=await pg.locator('.card').count(); print('pecas',n)
        await pg.click('text=Separar as peças →')
        await pg.wait_for_selector('text=Separar todas as peças')
        await pg.click('text=Separar todas as peças')
        await pg.wait_for_function("!document.querySelector('.busyline')",timeout=180000)
        await pg.wait_for_timeout(500)
        await pg.screenshot(path=SHOT+'2-separar.png')
        print('hint', await pg.locator('.separar .canvasbox .hint').last.text_content())
        await pg.click('text=Ir para o editor →')
        await pg.wait_for_selector('.page-svg')
        await pg.wait_for_timeout(800)
        items=await pg.locator('.layers li').count(); print('objetos',items)
        await pg.screenshot(path=SHOT+'3-editor.png')
        print('ERROS',errs)
        await b.close()
asyncio.run(main())
