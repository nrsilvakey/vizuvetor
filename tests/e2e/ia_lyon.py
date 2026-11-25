# Testa "Identificar elementos (IA)" com resposta simulada (sem chamar a API de verdade).
import asyncio, os, json
from playwright.async_api import async_playwright
CONTORNO=[(800,40),(900,10),(1000,15),(1090,10),(1200,60),(1250,330),(1245,380),(1150,390),(1150,790),(820,790),(800,400),(745,390),(745,300),(760,100)]
PX0,PY0,PW,PH=746,1,507,789
def cx(x0,y0,x1,y1): return [round((x0-PX0)/PW*1000),round((y0-PY0)/PH*1000),round((x1-PX0)/PW*1000),round((y1-PY0)/PH*1000)]
RESP={'ok':True,'modelo':'simulado','resultado':{'tipo_de_arte':'uniforme','cor_base':'#F5B703','elementos':[
 {'tipo':'texto','rotulo':'LYON','caixa':cx(845,152,1132,236),'texto':'LYON','estilo_fonte':'serifa grossa','cor':'#1A1A1A','tratamento':'texto_vivo','confianca':0.93},
 {'tipo':'texto','rotulo':'FUTEBOL CLUBE','caixa':cx(848,236,1130,280),'texto':'FUTEBOL CLUBE','tratamento':'texto_vivo','confianca':0.9},
 {'tipo':'numero','rotulo':'10','caixa':cx(862,292,1118,598),'texto':'10','tratamento':'texto_vivo','confianca':0.95},
 {'tipo':'etiqueta_mockup','rotulo':'Etiqueta da gola','caixa':cx(960,20,1040,60),'tratamento':'descartar','confianca':0.6},
 {'tipo':'listra','rotulo':'Listras das mangas','caixa':cx(1150,60,1250,380),'tratamento':'vetor','confianca':0.8}]}}
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=os.environ.get('CHROME','/usr/bin/google-chrome'))
        pg=await (await b.new_context(viewport={'width':1500,'height':1100})).new_page(); errs=[]; pedidos=[]
        pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
        async def rota(route):
            body=json.loads(route.request.post_data); pedidos.append((len(body['imagem']),body['contexto']))
            await route.fulfill(status=200,content_type='application/json',body=json.dumps(RESP))
        await pg.route('**/api/analisar.php',rota)
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
        await pg.click('text=Identificar elementos com IA'); await pg.wait_for_selector('.ialist li')
        print('pedido:', pedidos)
        print('lista:', [t.replace('\n',' | ') for t in await pg.locator('.ialist li').all_inner_texts()])
        await pg.screenshot(path='/tmp/e2e/16-ia-caixas.png')
        await pg.click('text=Aplicar sugestões marcadas')
        await pg.wait_for_function("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Aplicar sugestões'));return b&&!b.disabled&&document.querySelectorAll('.ialist li.feito').length>=4})()",timeout=300000)
        await pg.screenshot(path='/tmp/e2e/17-ia-aplicado.png')
        await pg.click('text=Ir para o editor →'); await pg.wait_for_selector('.page-svg'); await pg.wait_for_timeout(600)
        print('objetos:', [t.replace('\n',' | ') for t in await pg.locator('.layers li').all_inner_texts()])
        print('ERROS',errs); await b.close()
asyncio.run(main())
