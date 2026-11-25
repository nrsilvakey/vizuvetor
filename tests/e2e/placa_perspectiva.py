import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=__import__('os').environ.get('CHROME','/usr/bin/google-chrome'))
        pg=await (await b.new_context(viewport={'width':1500,'height':1000},accept_downloads=True)).new_page(); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
        await pg.goto(__import__('os').environ.get('URL','http://localhost:4173/'))
        await pg.fill('input[placeholder^="Ex.:"]','Placa Open')
        await pg.click('label.mode:has-text("Placa")')
        await pg.set_input_files('input[type=file][multiple]','/tmp/e2e/placa.png')
        await pg.wait_for_selector('.stage-svg')
        print('perspectiva marcada:', await pg.is_checked('label.chk:has-text("4 cantos") input'))
        await pg.click('text=+ Placa')
        box=await pg.locator('.stage-svg').bounding_box()
        for (x,y) in [(1300,900),(300,200),(260,1000),(1350,320)]:  # fora de ordem de propósito
            await pg.mouse.click(box['x']+box['width']*x/1600, box['y']+box['height']*y/1100)
        await pg.locator('.card input[type=number]').first.fill('1000')
        await pg.locator('.card input[type=number]').nth(1).fill('500')
        await pg.screenshot(path='/tmp/e2e/8-placa-cantos.png')
        await pg.click('text=Separar as peças →'); await pg.wait_for_selector('text=Separar esta peça')
        await pg.click('text=Separar esta peça'); await pg.wait_for_function("!document.querySelector('.busyline')",timeout=120000)
        await pg.wait_for_timeout(400)
        dims=await pg.evaluate("(()=>{const i=document.querySelector('.paint img');return [i.naturalWidth,i.naturalHeight]})()")
        print('recorte retificado px:', dims, 'proporção', round(dims[0]/dims[1],3), '(esperado 2.0)')
        print(await pg.locator('.separar .canvasbox .hint').last.text_content())
        await pg.screenshot(path='/tmp/e2e/9-placa-separada.png')
        print('ERROS',errs); await b.close()
asyncio.run(main())
