"""Gera as imagens de entrada dos testes e2e em /tmp/e2e/."""
import math, os
import numpy as np
import numpy.linalg as la
from PIL import Image, ImageDraw, ImageFont
os.makedirs('/tmp/e2e', exist_ok=True)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

# mockup de camiseta: frente, costas (céu em degradê, moldura, esfera sombreada, estrela) e 2 mangas isoladas
W,H=1800,1000
y,x=np.mgrid[0:H,0:W]
im=Image.fromarray(np.stack([235-y/H*40,230-y/H*30,220-y/H*20],-1).astype('uint8'),'RGB');d=ImageDraw.Draw(im)
font=ImageFont.truetype(FONT,46)
def painel(x0,y0,w,h,titulo,seed):
    rng=np.random.default_rng(seed); yy,xx=np.mgrid[0:h,0:w]
    sky=np.stack([120+yy/h*80,170+yy/h*50,230-yy/h*20],-1)+rng.normal(0,3,(h,w,1))
    im.paste(Image.fromarray(np.clip(sky,0,255).astype('uint8')),(x0,y0))
    d.rounded_rectangle((x0+15,y0+15,x0+w-15,y0+h-15),40,outline=(138,28,28),width=22)
    d.text((x0+w//2,y0+80),titulo,font=font,fill=(20,20,20),anchor='mm')
    cx,cy,r=x0+w//2,y0+h//2+40,140
    for k in range(r,0,-2):
        c=int(80+(r-k)/r*150); d.ellipse((cx-k,cy-k,cx+k,cy+k),fill=(c,int(c*0.6),40))
    pts=[(x0+w//2+(70 if i%2==0 else 30)*math.cos(-math.pi/2+i*math.pi/5), y0+h-110+(70 if i%2==0 else 30)*math.sin(-math.pi/2+i*math.pi/5)) for i in range(10)]
    d.polygon(pts,fill=(212,160,23))
painel(40,60,560,880,"FRENTE",1); painel(640,60,560,880,"COSTAS",2)
for x0 in (1260,1530):
    d.rounded_rectangle((x0,200,x0+240,560),20,fill=(138,28,28)); d.ellipse((x0+70,300,x0+170,400),fill=(212,160,23))
im.save('/tmp/e2e/mockup.png')

# foto de placa 1000x500 mm em perspectiva
PW,PH=1000,500
pl=Image.new('RGB',(PW,PH),(250,250,245));dp=ImageDraw.Draw(pl)
dp.rectangle((0,0,PW-1,PH-1),outline=(20,60,140),width=30)
dp.text((PW//2,PH//2),"OPEN",font=ImageFont.truetype(FONT,120),fill=(228,0,58),anchor='mm')
photo=Image.new('RGB',(1600,1100),(90,95,100))
dst=[(300,200),(1350,320),(1300,900),(260,1000)]
A=[];B=[]
for (x,y),(u,v) in zip(dst,[(0,0),(PW,0),(PW,PH),(0,PH)]):
    A+=[[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]];B+=[u,v]
c=la.solve(np.array(A,float),np.array(B,float))
warped=pl.transform(photo.size,Image.PERSPECTIVE,tuple(c),Image.BICUBIC,fillcolor=(90,95,100))
mask=Image.new('L',photo.size,0);ImageDraw.Draw(mask).polygon(dst,fill=255)
photo.paste(warped,(0,0),mask);photo.save('/tmp/e2e/placa.png')
print('imagens em /tmp/e2e')
