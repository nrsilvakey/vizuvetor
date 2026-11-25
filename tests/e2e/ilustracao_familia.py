import asyncio, sys, json
from playwright.async_api import async_playwright
YEL=json.loads(sys.argv[1])
async def canvas_path(pg, pts, rw, rh, close=True):
    box=await pg.locator('.paint canvas').bounding_box()
    sx=box['width']/rw; sy=box['height']/rh
    await pg.mouse.move(box['x']+pts[0][0]*sx, box['y']+pts[0][1]*sy); await pg.mouse.down()
    for x,y in pts[1:]+[pts[0]]: await pg.mouse.move(box['x']+x*sx, box['y']+y*sy, steps=6)
    await pg.mouse.up()
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=__import__('os').environ.get('CHROME','/usr/bin/google-chrome'))
        pg=await (await b.new_context(viewport={'width':1500,'height':1000},accept_downloads=True)).new_page(); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
        await pg.goto(__import__('os').environ.get('URL','http://localhost:4173/'))
        await pg.fill('input[placeholder^="Ex.:"]','Família de Légua')
        await pg.set_input_files('input[type=file][multiple]',__import__('os').environ.get('ARTE','/tmp/e2e/familia.png')); await pg.wait_for_selector('.stage-svg')
        box=await pg.locator('.stage-svg').bounding_box()
        await pg.click('text=+ Frente')
        await pg.mouse.move(box['x']+box['width']*22/1774, box['y']+box['height']*22/887); await pg.mouse.down()
        await pg.mouse.move(box['x']+box['width']*614/1774, box['y']+box['height']*864/887, steps=8); await pg.mouse.up()
        await pg.click('text=Separar as peças →'); await pg.wait_for_selector('.paint img')
        await pg.select_option('select[aria-label="Tipo de arte"]','ilustracao')
        await pg.wait_for_timeout(300)
        rw,rh=await pg.evaluate("(()=>{const i=document.querySelector('.paint img');return [i.naturalWidth,i.naturalHeight]})()")
        print('recorte px',rw,rh)
        await pg.screenshot(path='/tmp/e2e/dbg.png')
        await pg.click('.brushes button:has-text("Laço")')
        # 1) laço rente no grupo de personagens
        await pg.fill('label:has-text("Nome do próximo recorte") input','Imagem principal')
        await canvas_path(pg,[[175,150],[210,100],[330,100],[440,165],[430,240],[400,300],[560,300],[565,575],[55,575],[60,400],[110,380],[140,300],[150,250]],rw,rh)
        await pg.wait_for_function("!document.querySelector('.busyline')",timeout=120000); await pg.wait_for_timeout(300)
        # 2) caixa no letreiro
        await pg.click('.brushes button:has-text("Caixa")')
        await pg.fill('label:has-text("Nome do próximo recorte") input','Letreiro Família de Légua')
        bx=await pg.locator('.paint canvas').bounding_box(); s=bx['width']/rw
        await pg.mouse.move(bx['x']+50*s,bx['y']+580*s); await pg.mouse.down(); await pg.mouse.move(bx['x']+570*s,bx['y']+712*s,steps=8); await pg.mouse.up()
        await pg.wait_for_function("!document.querySelector('.busyline')",timeout=120000); await pg.wait_for_timeout(500)
        await pg.screenshot(path='/tmp/e2e/10-ilustracao.png')
        await pg.click('text=Aprovar tudo desta peça')
        await pg.click('text=Ir para o editor →'); await pg.wait_for_selector('.page-svg'); await pg.wait_for_timeout(600)
        # 3) vetorizar o amarelo das letras
        await pg.click('.layers li:has-text("Letreiro")')
        await pg.click('button:has-text("Vetorizar uma cor")')
        pw=await pg.evaluate("document.querySelector('.props') && 300")
        pt=await pg.evaluate(f"""(()=>{{const s=document.querySelector('.page-svg');const m=s.getScreenCTM();const k=300/{rw};
            const p=new DOMPoint({YEL[0]}*k,{YEL[1]}*k).matrixTransform(m);return [p.x,p.y]}})()""")
        await pg.mouse.click(pt[0],pt[1])
        await pg.wait_for_function("!document.querySelector('.props button[disabled]')",timeout=60000); await pg.wait_for_timeout(800)
        print('objetos:', await pg.locator('.layers li').all_inner_texts())
        await pg.screenshot(path='/tmp/e2e/11-editor-vetor.png')
        await pg.click('nav >> text=5 Exportar'); await pg.wait_for_selector('text=Gerar PDF de 3 páginas')
        await pg.screenshot(path='/tmp/e2e/12-exportar.png', full_page=True)
        async with pg.expect_download(timeout=300000) as di: await pg.click('text=Gerar PDF de 3 páginas')
        d=await di.value; await d.save_as('/tmp/e2e/familia.pdf'); print('pdf ok')
        print('ERROS',errs); await b.close()
asyncio.run(main())
