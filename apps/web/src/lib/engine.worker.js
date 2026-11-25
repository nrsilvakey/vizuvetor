/* Motor de separação do VizuVetor (vetor / imagem / fundo).
   Portado de apps/vizuvetor. Entrada: {id,w,h,buf(RGBA),S,force?}. */

/* ===== motor: roda num Web Worker quando dá; senão, na própria página ===== */
let post=function(m,t){self.postMessage(m,t||[])},prog=function(t){self.postMessage({progress:t})};

function integral(a,w,h){const W=w+1,I=new Float64Array(W*(h+1));for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=a[y*w+x];I[(y+1)*W+x+1]=I[y*W+x+1]+row}}return I}
function boxMean(a,w,h,r){const I=integral(a,w,h),o=new Float32Array(w*h),W=w+1;
  for(let y=0;y<h;y++){const y0=Math.max(0,y-r),y1=Math.min(h,y+r+1);for(let x=0;x<w;x++){const x0=Math.max(0,x-r),x1=Math.min(w,x+r+1);
    o[y*w+x]=(I[y1*W+x1]-I[y0*W+x1]-I[y1*W+x0]+I[y0*W+x0])/((y1-y0)*(x1-x0))}}return o}

/* componentes pequenos herdam o rótulo vizinho mais comum */
function despeckle(lab,w,h,minA,keepNeg,protect,protectMin){const N=w*h,comp=new Int32Array(N).fill(-1),q=new Int32Array(N);let nc=0;
  for(let s=0;s<N;s++){if(comp[s]!==-1||(lab[s]<0&&!keepNeg))continue;const L=lab[s];let qh=0,qt=0;q[qt++]=s;comp[s]=nc;
    while(qh<qt){const p=q[qh++],x=p%w;
      if(x>0&&comp[p-1]===-1&&lab[p-1]===L){comp[p-1]=nc;q[qt++]=p-1}
      if(x<w-1&&comp[p+1]===-1&&lab[p+1]===L){comp[p+1]=nc;q[qt++]=p+1}
      if(p>=w&&comp[p-w]===-1&&lab[p-w]===L){comp[p-w]=nc;q[qt++]=p-w}
      if(p+w<N&&comp[p+w]===-1&&lab[p+w]===L){comp[p+w]=nc;q[qt++]=p+w}}
    if(qt<minA&&!(protect!==undefined&&L===protect&&qt>=protectMin)){const cnt=new Map();for(let i=0;i<qt;i++){const p=q[i],x=p%w;
        for(const nb of[x>0?p-1:-1,x<w-1?p+1:-1,p-w,p+w]){if(nb<0||nb>=N||comp[nb]===nc)continue;const l=lab[nb];if(l<0&&!keepNeg)continue;cnt.set(l,(cnt.get(l)||0)+1)}}
      let best=L,bc=0;for(const[l,c]of cnt)if(c>bc){bc=c;best=l}
      if(best!==L)for(let i=0;i<qt;i++)lab[q[i]]=best}
    nc++}}

/* componentes de um valor que tocam a borda da imagem */
function touchBorder(cls,w,h,val){const N=w*h,seen=new Uint8Array(N),out=new Uint8Array(N),st=[];
  const push=p=>{if(!seen[p]&&cls[p]===val){seen[p]=1;st.push(p)}};
  for(let x=0;x<w;x++){push(x);push((h-1)*w+x)}for(let y=0;y<h;y++){push(y*w);push(y*w+w-1)}
  while(st.length){const p=st.pop();out[p]=1;const x=p%w;if(x>0)push(p-1);if(x<w-1)push(p+1);if(p>=w)push(p-w);if(p+w<N)push(p+w)}return out}

function kmeans(P,n,k,iters){k=Math.min(k,n);const C=[[P[0],P[1],P[2]]],md=new Float32Array(n).fill(1e12);
  while(C.length<k){const c=C[C.length-1];let best=0,bd=-1;for(let j=0;j<n;j++){const a=P[j*3]-c[0],b=P[j*3+1]-c[1],e=P[j*3+2]-c[2],dd=a*a+b*b+e*e;if(dd<md[j])md[j]=dd;if(md[j]>bd){bd=md[j];best=j}}
    if(bd<=1)break;C.push([P[best*3],P[best*3+1],P[best*3+2]])}
  const nd=new Float32Array(n);
  for(let it=0;it<iters;it++){const s=C.map(()=>[0,0,0,0]);
    for(let j=0;j<n;j++){let bi=0,bd=1e12;for(let c=0;c<C.length;c++){const a=P[j*3]-C[c][0],b=P[j*3+1]-C[c][1],e=P[j*3+2]-C[c][2],dd=a*a+b*b+e*e;if(dd<bd){bd=dd;bi=c}}
      nd[j]=bd;const t=s[bi];t[0]+=P[j*3];t[1]+=P[j*3+1];t[2]+=P[j*3+2];t[3]++}
    let mv=0;s.forEach((t,c)=>{if(t[3]){const v=[t[0]/t[3],t[1]/t[3],t[2]/t[3]];mv+=Math.abs(v[0]-C[c][0])+Math.abs(v[1]-C[c][1])+Math.abs(v[2]-C[c][2]);C[c]=v}});
    if(mv<0.2)break}
  return{C,nd}}

function rdp(xs,ys,a0,b0,eps,keep){const st=[[a0,b0]];
  while(st.length){const[a,b]=st.pop();if(b-a<2)continue;const ax=xs[a],ay=ys[a],dx=xs[b]-ax,dy=ys[b]-ay,L=Math.hypot(dx,dy);let md=0,mi=-1;
    for(let i=a+1;i<b;i++){const d=L>1e-9?Math.abs(dy*(xs[i]-ax)-dx*(ys[i]-ay))/L:Math.hypot(xs[i]-ax,ys[i]-ay);if(d>md){md=d;mi=i}}
    if(md>eps){keep[mi]=1;st.push([a,mi],[mi,b])}}}
function simplifyClosed(xs,ys,eps){const n=xs.length;let fi=0,fd=-1;for(let i=1;i<n;i++){const d=(xs[i]-xs[0])**2+(ys[i]-ys[0])**2;if(d>fd){fd=d;fi=i}}
  const X=xs.concat([xs[0]]),Y=ys.concat([ys[0]]),keep=new Uint8Array(n+1);keep[0]=keep[fi]=keep[n]=1;
  rdp(X,Y,0,fi,eps,keep);rdp(X,Y,fi,n,eps,keep);const p=[];for(let i=0;i<n;i++)if(keep[i])p.push([X[i],Y[i]]);return p}

const f2=v=>{const r=Math.round(v*100)/100;return''+r};
/* Bézier cúbica tipo Catmull-Rom, com cantos vivos preservados */
function bezier(p,cornerCos){const n=p.length;if(n<3)return'';const corner=new Uint8Array(n);
  for(let i=0;i<n;i++){const a=p[(i+n-1)%n],b=p[i],c=p[(i+1)%n],ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-b[0],vy=c[1]-b[1],l=Math.hypot(ux,uy)*Math.hypot(vx,vy);corner[i]=l>0&&(ux*vx+uy*vy)/l<cornerCos?1:0}
  let s='M'+f2(p[0][0])+' '+f2(p[0][1]);
  for(let i=0;i<n;i++){const P0=p[i],P1=p[(i+1)%n],len=Math.hypot(P1[0]-P0[0],P1[1]-P0[1]);
    if(corner[i]&&corner[(i+1)%n]){s+='L'+f2(P1[0])+' '+f2(P1[1]);continue}
    const tan=(j,A,B)=>{let tx,ty;if(corner[j]){tx=B[0]-A[0];ty=B[1]-A[1]}else{const pr=p[(j+n-1)%n],nx=p[(j+1)%n];tx=nx[0]-pr[0];ty=nx[1]-pr[1]}const l=Math.hypot(tx,ty)||1;return[tx/l*len/3,ty/l*len/3]};
    const t0=tan(i,P0,P1),t1=tan((i+1)%n,P0,P1);
    s+='C'+f2(P0[0]+t0[0])+' '+f2(P0[1]+t0[1])+' '+f2(P1[0]-t1[0])+' '+f2(P1[1]-t1[1])+' '+f2(P1[0])+' '+f2(P1[1])}
  return s+'Z'}

/* contorno subpixel (marching squares) de uma máscara suavizada */
function contour(inS,w,h,minA,eps){let x0=w,y0=h,x1=-1,y1=-1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(inS[y*w+x]){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}
  if(x1<0)return{d:'',nodes:0};
  const GW=x1-x0+5,GH=y1-y0+5,G=GW*GH,m=new Float32Array(G),t=new Float32Array(G),F=new Float32Array(G);
  for(let gy=2;gy<GH-2;gy++)for(let gx=2;gx<GW-2;gx++)m[gy*GW+gx]=inS[(y0+gy-2)*w+x0+gx-2];
  for(let gy=0;gy<GH;gy++)for(let gx=1;gx<GW-1;gx++){const i=gy*GW+gx;t[i]=(m[i-1]+2*m[i]+m[i+1])/4}
  for(let gy=1;gy<GH-1;gy++)for(let gx=0;gx<GW;gx++){const i=gy*GW+gx;F[i]=(t[i-GW]+2*t[i]+t[i+GW])/4}
  const nb=new Int32Array(G*4).fill(-1),touched=[];
  const link=(a,b)=>{if(nb[a*2]<0){nb[a*2]=b;touched.push(a)}else nb[a*2+1]=b;if(nb[b*2]<0){nb[b*2]=a;touched.push(b)}else nb[b*2+1]=a};
  for(let gy=0;gy<GH-1;gy++)for(let gx=0;gx<GW-1;gx++){const i=gy*GW+gx,tl=F[i],tr=F[i+1],br=F[i+GW+1],bl=F[i+GW];
    const c=(tl>=.5?8:0)|(tr>=.5?4:0)|(br>=.5?2:0)|(bl>=.5?1:0);if(c===0||c===15)continue;
    const T=i*2,R=(i+1)*2+1,B=(i+GW)*2,L=i*2+1,ctr=(tl+tr+br+bl)/4>=.5;
    switch(c){case 1:case 14:link(L,B);break;case 2:case 13:link(B,R);break;case 3:case 12:link(L,R);break;
      case 4:case 11:link(T,R);break;case 6:case 9:link(T,B);break;case 7:case 8:link(T,L);break;
      case 5:if(ctr){link(T,L);link(B,R)}else{link(T,R);link(L,B)}break;
      case 10:if(ctr){link(T,R);link(L,B)}else{link(T,L);link(B,R)}break}}
  const vis=new Uint8Array(G*2),loops=[];let nodes=0;
  const pt=(e,xs,ys)=>{const n=e>>1,hz=(e&1)===0,n2=hz?n+1:n+GW,a=F[n],b=F[n2],tt=(.5-a)/(b-a),gx=n%GW,gy=(n/GW)|0;
    xs.push(x0+gx-2+.5+(hz?tt:0));ys.push(y0+gy-2+.5+(hz?0:tt))};
  for(const e0 of touched){if(vis[e0])continue;const xs=[],ys=[];let e=e0,prev=-1;
    while(e>=0&&!vis[e]){vis[e]=1;pt(e,xs,ys);let nx=nb[e*2];if(nx<0||vis[nx])nx=nb[e*2+1];if(nx<0||vis[nx])break;prev=e;e=nx}
    if(xs.length<3)continue;let ar=0;for(let i=0,n=xs.length;i<n;i++){const j=(i+1)%n;ar+=xs[i]*ys[j]-xs[j]*ys[i]}
    if(Math.abs(ar/2)<minA)continue;const p=simplifyClosed(xs,ys,eps);if(p.length<3)continue;nodes+=p.length;
    let bx0=1e9,by0=1e9,bx1=-1e9,by1=-1e9;for(const q of p){if(q[0]<bx0)bx0=q[0];if(q[0]>bx1)bx1=q[0];if(q[1]<by0)by0=q[1];if(q[1]>by1)by1=q[1]}
    loops.push({p,a:Math.abs(ar/2),bb:[bx0,by0,bx1,by1]})}
  /* estrutura: cada contorno externo vira um objeto, com seus furos dentro dele */
  loops.sort((a,b)=>a.a-b.a);
  const inside=(x,y,p)=>{let c=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])c=!c}return c};
  for(let i=0;i<loops.length;i++){const L=loops[i],[x,y]=L.p[0];L.parent=-1;
    for(let j=i+1;j<loops.length;j++){const P=loops[j],b=P.bb;if(L.bb[0]<b[0]||L.bb[1]<b[1]||L.bb[2]>b[2]||L.bb[3]>b[3])continue;if(inside(x,y,P.p)){L.parent=j;break}}}
  for(let i=loops.length-1;i>=0;i--){const L=loops[i];L.depth=L.parent<0?0:loops[L.parent].depth+1}
  const objs=[],own=new Map();
  for(let i=loops.length-1;i>=0;i--){const L=loops[i];if(L.depth%2===0){own.set(i,objs.length);objs.push({d:bezier(L.p,0.57),a:L.a})}}
  for(let i=0;i<loops.length;i++){const L=loops[i];if(L.depth%2===1&&own.has(L.parent))objs[own.get(L.parent)].d+=bezier(L.p,0.57)}
  return{objs:objs.map(o=>o.d),nodes}}

function engine(J){const{w,h,S}=J,d=new Uint8ClampedArray(J.buf),N=w*h,t0=Date.now();
  prog('Convertendo cores…');
  const lin=new Float32Array(256);for(let i=0;i<256;i++){const v=i/255;lin[i]=v<=.04045?v/12.92:((v+.055)/1.055)**2.4}
  const Lc=new Float32Array(N),Ac=new Float32Array(N),Bc=new Float32Array(N),ff=t=>t>.008856?Math.cbrt(t):7.787*t+16/116;
  for(let i=0;i<N;i++){const r=lin[d[i*4]],g=lin[d[i*4+1]],b=lin[d[i*4+2]],X=ff((r*.4124+g*.3576+b*.1805)/.95047),Y=ff(r*.2126+g*.7152+b*.0722),Z=ff((r*.0193+g*.1192+b*.9505)/1.08883);
    Lc[i]=116*Y-16;Ac[i]=500*(X-Y);Bc[i]=200*(Y-Z)}
  /* uniforme: pouco peso para claro/escuro -> dobras e luz do tecido viram a mesma cor; preto x amarelo continua separado */
  if(S.flat)for(let i=0;i<N;i++)Lc[i]*=0.2;
  const dE=(i,j)=>{const a=Lc[i]-Lc[j],b=Ac[i]-Ac[j],c=Bc[i]-Bc[j];return Math.sqrt(a*a+b*b+c*c)};
  /* classes: -1 transparente/removido, 0 vetor, 1 imagem (degradê), 2 fundo */
  const cls=new Int16Array(N);for(let i=0;i<N;i++)cls[i]=d[i*4+3]<128?-1:0;
  const bgVal=S.bgm==='img'?2:S.bgm==='del'?-1:0;
  prog('Procurando o fundo…');
  /* fundo: cresce a partir da borda passo a passo (acompanha degradê suave, para em borda nítida);
     só vale a região que ocupa boa parte da borda da imagem */
  if(S.bgm!=='vec'){const sL=boxMean(boxMean(Lc,w,h,1),w,h,1),sA=boxMean(boxMean(Ac,w,h,1),w,h,1),sB=boxMean(boxMean(Bc,w,h,1),w,h,1);
    const stp=(i,j)=>{const a=sL[i]-sL[j],b=sA[i]-sA[j],c=sB[i]-sB[j];return Math.sqrt(a*a+b*b+c*c)};
    const B=[];for(let x=0;x<w;x++)B.push(x,(h-1)*w+x);for(let y=1;y<h-1;y++)B.push(y*w,y*w+w-1);
    const comp=new Int32Array(N).fill(-1),isB=new Uint8Array(N);for(const p of B)isB[p]=1;
    /* além do passo local, cada pixel é comparado a uma "cor de referência" que segue o caminho devagar:
       acompanha degradê de fundo, mas não escorre por pontas finas (estrelas, serifas) */
    const st=new Int32Array(N),rL=new Float32Array(N),rA=new Float32Array(N),rB=new Float32Array(N),big=S.tol*4;let nc=0;
    for(const s of B){if(comp[s]>=0||cls[s]!==0)continue;let top=0,members=[],bcount=0;st[top++]=s;comp[s]=nc;rL[s]=sL[s];rA[s]=sA[s];rB[s]=sB[s];
      while(top){const p=st[--top];members.push(p);if(isB[p])bcount++;const x=p%w;
        for(const q of[x>0?p-1:-1,x<w-1?p+1:-1,p-w,p+w]){if(q<0||q>=N||comp[q]>=0||cls[q]!==0||stp(p,q)>=S.tol)continue;
          const a=sL[q]-rL[p],b=sA[q]-rA[p],c=sB[q]-rB[p];if(a*a+b*b+c*c>=big*big)continue;
          comp[q]=nc;rL[q]=rL[p]*.95+sL[q]*.05;rA[q]=rA[p]*.95+sA[q]*.05;rB[q]=rB[p]*.95+sB[q]*.05;st[top++]=q}}
      if(bcount>=B.length*0.12&&bgVal!==0)for(const p of members)cls[p]=bgVal;nc++}}
  /* degradês em qualquer lugar (ex.: céu dentro de uma moldura, esfera sombreada):
     região contínua, sem borda nítida, cuja cor varia além do limite -> não é cor chapada.
     Grande (>8% da peça) vira fundo; menor vira imagem. Cor chapada continua vetor. */
  if(S.thr>0){prog('Procurando degradês…');
    const sL=boxMean(boxMean(Lc,w,h,1),w,h,1),sA=boxMean(boxMean(Ac,w,h,1),w,h,1),sB=boxMean(boxMean(Bc,w,h,1),w,h,1);
    const stp=(i,j)=>{const a=sL[i]-sL[j],b=sA[i]-sA[j],c=sB[i]-sB[j];return Math.sqrt(a*a+b*b+c*c)};
    const seg=new Uint8Array(N),st=new Int32Array(N),mem=new Int32Array(N),rL=new Float32Array(N),rA=new Float32Array(N),rB=new Float32Array(N);
    const big=S.tol*4,spread=Math.max(3.5,S.de*0.8)*(1.6-S.thr/100),minA=N*0.002;
    for(let s=0;s<N;s++){if(seg[s]||cls[s]!==0)continue;let top=0,n=0;st[top++]=s;seg[s]=1;rL[s]=sL[s];rA[s]=sA[s];rB[s]=sB[s];
      let s1L=0,s1A=0,s1B=0,s2=0,bx0=w,bx1=0,by0=h,by1=0;
      while(top){const p=st[--top];mem[n++]=p;const L=Lc[p],A=Ac[p],Bb=Bc[p];s1L+=L;s1A+=A;s1B+=Bb;s2+=L*L+A*A+Bb*Bb;const x=p%w,y=(p/w)|0;
        if(x<bx0)bx0=x;if(x>bx1)bx1=x;if(y<by0)by0=y;if(y>by1)by1=y;
        for(const q of[x>0?p-1:-1,x<w-1?p+1:-1,p-w,p+w]){if(q<0||q>=N||seg[q]||cls[q]!==0||stp(p,q)>=S.tol)continue;
          const a=sL[q]-rL[p],b=sA[q]-rA[p],c=sB[q]-rB[p];if(a*a+b*b+c*c>=big*big)continue;
          seg[q]=1;rL[q]=rL[p]*.95+sL[q]*.05;rA[q]=rA[p]*.95+sA[q]*.05;rB[q]=rB[p]*.95+sB[q]*.05;st[top++]=q}}
      if(n<minA)continue;
      /* desvio-padrão da cor (robusto a bordas suavizadas): chapado ~1-3, degradê >> */
      const sd=Math.sqrt(Math.max(0,s2/n-(s1L*s1L+s1A*s1A+s1B*s1B)/(n*n)));
      if(sd<=spread)continue;
      /* fundo = grande e espalhado pela peça; senão é imagem (personagem, objeto sombreado) */
      const spreadOut=(bx1-bx0)>=0.7*w&&(by1-by0)>=0.7*h;
      const v=n>N*0.15&&spreadOut&&S.bgm==='img'?2:1;for(let i=0;i<n;i++)cls[mem[i]]=v}}
  prog('Separando degradês…');
  const r=Math.max(2,Math.round(Math.max(w,h)/200)),g=new Float32Array(N);
  for(let c=0;c<3;c++){let a=new Float32Array(N);for(let i=0;i<N;i++)a[i]=d[i*4+c];a=boxMean(boxMean(a,w,h,1),w,h,1);
    for(let y=0;y<h;y++){const ya=Math.max(0,y-r)*w,yb=Math.min(h-1,y+r)*w;for(let x=0;x<w;x++){const xa=Math.max(0,x-r),xb=Math.min(w-1,x+r),i=y*w+x;
      const v=(Math.abs(a[y*w+xb]-a[y*w+xa])+Math.abs(a[yb+x]-a[ya+x]))/2;if(v>g[i])g[i]=v}}}
  /* textura/degradê: variação suave e persistente; borda nítida fica de fora */
  const tt=S.thr/100,lo=1.5+(1-tt)*8,fr=0.8-tt*0.5;
  let soft=new Float32Array(N);for(let i=0;i<N;i++)soft[i]=cls[i]===0&&g[i]>lo&&g[i]<50?1:0;
  const sm=boxMean(soft,w,h,r*3);
  /* fundo texturizado: área "imagem" que encosta na borda conta como fundo */
  const isTex=new Int16Array(N);for(let i=0;i<N;i++)isTex[i]=cls[i]===0&&sm[i]>Math.min(fr,0.5)?1:0;
  {const m=boxMean(Float32Array.from(isTex),w,h,r);for(let i=0;i<N;i++)isTex[i]=isTex[i]&&m[i]>0.5?1:0}
  if(S.bgm!=='vec'){const tb=touchBorder(isTex,w,h,1);for(let i=0;i<N;i++)if(tb[i]){isTex[i]=0;cls[i]=bgVal}}
  if(S.thr>0)for(let i=0;i<N;i++)if(isTex[i]&&sm[i]>fr&&cls[i]===0)cls[i]=1;
  /* limpa manchas de classificação, mas preserva formas vetoriais (letras, detalhes) acima de um mínimo */
  despeckle(cls,w,h,Math.round(N*0.0012),true,0,Math.max(12,Math.round(N*0.00004)));
  /* correções manuais do operador (pincel): 1=vetor, 2=imagem, 3=fundo — prevalecem sobre o automático */
  if(J.force){const F=new Uint8Array(J.force);for(let i=0;i<N;i++){const f=F[i];if(!f||d[i*4+3]<128)continue;cls[i]=f===1?0:f===2?1:(bgVal===0?0:bgVal)}}

  prog('Escolhendo as cores…');
  const edge=new Uint8Array(N);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if(cls[i]!==0)continue;if(dE(i-1,i+1)>10||dE(i-w,i+w)>10)edge[i]=1}
  const idx=[];for(let i=0;i<N;i++)if(cls[i]===0&&!edge[i])idx.push(i);
  const step=Math.max(1,Math.floor(idx.length/40000)),n=Math.ceil(idx.length/step),P=new Float32Array(n*3);
  for(let j=0,k=0;j<idx.length;j+=step,k++){const p=idx[j];P[k*3]=Lc[p];P[k*3+1]=Ac[p];P[k*3+2]=Bc[p]}
  let C=[];
  if(n){if(S.auto){let K=4;for(;;){const res=kmeans(P,n,K,12);C=res.C;const ds=Array.from(res.nd).sort((a,b)=>a-b),p95=Math.sqrt(ds[Math.floor(n*.95)]||0);
        prog('Cores: '+C.length+' (ΔE '+p95.toFixed(1)+')');if(p95<=S.de||K>=48||C.length<K)break;K+=K<12?2:4}}
    else C=kmeans(P,n,S.k,16).C}
  /* uniforme: tons da mesma cor (luz e sombra do tecido) viram uma cor só.
     Coloridas: mesmo matiz (±20°). Neutras (preto/cinza/branco): luminância real próxima. */
  if(S.flat&&C.length>1){const info=C.map(c=>({L:c[0]/0.2,ch:Math.hypot(c[1],c[2]),h:Math.atan2(c[2],c[1])}));
    const par=C.map((_,i)=>i),f=i=>par[i]===i?i:(par[i]=f(par[i]));
    for(let i=0;i<C.length;i++)for(let j=i+1;j<C.length;j++){const a=info[i],b=info[j];let same=false;
      if(a.ch>18&&b.ch>18){let dh=Math.abs(a.h-b.h);if(dh>Math.PI)dh=2*Math.PI-dh;same=dh<0.35}
      else if(a.ch<12&&b.ch<12)same=Math.abs(a.L-b.L)<28;
      if(same)par[f(i)]=f(j)}
    const groups=new Map();C.forEach((c,i)=>{const r=f(i);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(c)});
    C=[...groups.values()].map(g=>g.reduce((a,c)=>Math.hypot(c[1],c[2])>Math.hypot(a[1],a[2])?c:a))}
  prog('Atribuindo cores…');
  const lab=new Int16Array(N).fill(-1),K=C.length;
  for(let i=0;i<N;i++){if(cls[i]!==0||edge[i])continue;let bi=0,bd=1e12;for(let c=0;c<K;c++){const a=Lc[i]-C[c][0],b=Ac[i]-C[c][1],e=Bc[i]-C[c][2],dd=a*a+b*b+e*e;if(dd<bd){bd=dd;bi=c}}lab[i]=bi}
  /* pixels de borda (antialias): herdam a cor vizinha mais parecida, nunca uma cor intermediária */
  /* e se o pixel de borda for mais parecido com o fundo/imagem ao lado, ele vai para o bitmap */
  for(let pass=0;pass<3;pass++){const R=pass<2?3:7;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(cls[i]!==0||lab[i]>=0)continue;
    let best=-1,bd=1e12,rc=0,rd=1e12;for(let yy=Math.max(0,y-R);yy<=Math.min(h-1,y+R);yy++)for(let xx=Math.max(0,x-R);xx<=Math.min(w-1,x+R);xx++){const j=yy*w+xx,l=lab[j];
      if(cls[j]>0){const a=Lc[i]-Lc[j],b=Ac[i]-Ac[j],e=Bc[i]-Bc[j],dd=a*a+b*b+e*e;if(dd<rd){rd=dd;rc=cls[j]}continue}
      if(l<0||edge[j]&&pass===0)continue;
      const a=Lc[i]-C[l][0],b=Ac[i]-C[l][1],e=Bc[i]-C[l][2],dd=a*a+b*b+e*e;if(dd<bd){bd=dd;best=l}}
    if(rc&&rd<bd)cls[i]=rc;else if(best>=0)lab[i]=best}}
  for(let i=0;i<N;i++)if(cls[i]===0&&lab[i]<0&&K){let bi=0,bd=1e12;for(let c=0;c<K;c++){const a=Lc[i]-C[c][0],b=Ac[i]-C[c][1],e=Bc[i]-C[c][2],dd=a*a+b*b+e*e;if(dd<bd){bd=dd;bi=c}}lab[i]=bi}
  const errS=new Float64Array(K),errN=new Float64Array(K);
  for(let i=0;i<N;i++){const l=lab[i];if(l<0||edge[i])continue;const a=Lc[i]-C[l][0],b=Ac[i]-C[l][1],c=Bc[i]-C[l][2];errS[l]+=Math.sqrt(a*a+b*b+c*c);errN[l]++}
  const minA=Math.max(2,S.speck*(Math.max(w,h)/1000)**2);
  despeckle(lab,w,h,minA,false);
  /* uniforme: o pincel "Fundo" pinta a cor base (apaga sombras/dobras que o operador marcar) */
  if(S.flat&&J.force&&K>1){const F=new Uint8Array(J.force),cnt=new Int32Array(K);for(let i=0;i<N;i++)if(lab[i]>=0)cnt[lab[i]]++;
    let base=0;for(let c=1;c<K;c++)if(cnt[c]>cnt[base])base=c;for(let i=0;i<N;i++)if(F[i]===3&&lab[i]>=0)lab[i]=base}
  /* cor final = média real dos pixels (sem borda) */
  const sum=Array.from({length:K},()=>[0,0,0,0,0]);
  for(let i=0;i<N;i++){const l=lab[i];if(l<0)continue;const s=sum[l];s[4]++;if(!edge[i]){s[0]+=d[i*4];s[1]+=d[i*4+1];s[2]+=d[i*4+2];s[3]++}}
  if(S.flat){const hist=Array.from({length:K},()=>[new Uint32Array(256),new Uint32Array(256),new Uint32Array(256)]);
    for(let i=0;i<N;i++){const l=lab[i];if(l<0||edge[i])continue;for(let c=0;c<3;c++)hist[l][c][d[i*4+c]]++}
    for(let l=0;l<K;l++){const s0=sum[l];if(!s0[3])continue;const med=[0,0,0];for(let c=0;c<3;c++){let acc=0,half=s0[3]/2,v=0;for(;v<256;v++){acc+=hist[l][c][v];if(acc>=half)break}med[c]=v}
      s0[0]=med[0]*s0[3];s0[1]=med[1]*s0[3];s0[2]=med[2]*s0[3]}}
  const order=[...Array(K).keys()].filter(c=>sum[c][4]>0).sort((a,b)=>sum[b][4]-sum[a][4]),rank=new Int16Array(K).fill(-1);order.forEach((c,j)=>rank[c]=j);
  const hex=c=>{const s=sum[c],m=s[3]||1,v=s[3]?[s[0]/m,s[1]/m,s[2]/m]:(()=>{const L=C[c][0],A=C[c][1],B=C[c][2],fy=(L+16)/116,fx=fy+A/500,fz=fy-B/200,iv=t=>t**3>.008856?t**3:(t-16/116)/7.787,X=iv(fx)*.95047,Y=iv(fy),Z=iv(fz)*1.08883,
      g=u=>{u=Math.max(0,Math.min(1,u));return 255*(u<=.0031308?12.92*u:1.055*u**(1/2.4)-.055)};return[g(X*3.2406-Y*1.5372-Z*.4986),g(-X*.9689+Y*1.8758+Z*.0415),g(X*.0557-Y*.204+Z*1.057)]})();
    return'#'+v.map(x=>Math.round(x).toString(16).padStart(2,'0')).join('')};
  const layers=[],inS=new Uint8Array(N),eps=S.prec*Math.max(w,h)/1000;let nodes=0;
  order.forEach((c,j)=>{prog('Contornando cor '+(j+1)+' de '+order.length+'…');
    for(let i=0;i<N;i++){const l=lab[i];inS[i]=l<0?0:S.stack?(rank[l]>=j?1:0):(l===c?1:0)}
    const res=contour(inS,w,h,minA,Math.max(.15,eps));nodes+=res.nodes;
    if(res.objs.length)layers.push({hex:hex(c),area:sum[c][4],objs:res.objs,nodes:res.nodes,conf:Math.max(0,Math.min(1,1-(errN[c]?errS[c]/errN[c]:0)/20))})});
  /* máscaras dos bitmaps, avançando 2 px por baixo do vetor para não abrir fresta */
  prog('Recortando bitmaps…');
  const mk=k=>{const a=new Float32Array(N);let any=0;for(let i=0;i<N;i++)if(cls[i]===k){a[i]=1;any=1}if(!any)return null;
    const m=boxMean(a,w,h,2),o=new Uint8Array(N);for(let i=0;i<N;i++)o[i]=cls[i]===k||(cls[i]===0&&m[i]>0)?255:0;return o};
  const mImg=mk(1);let mBg=mk(2),fill=null;
  /* fundo completo: reconstrói o fundo por trás da arte (pull-push multiescala a partir do fundo visível) */
  if(S.fillBg&&mBg){prog('Reconstruindo o fundo…');
    const kn=new Float32Array(N);for(let i=0;i<N;i++)kn[i]=cls[i]===2?1:0;const er=boxMean(kn,w,h,Math.max(3,Math.round(Math.max(w,h)/350)));
    const lv=[];let cw=w,ch=h,C=new Float32Array(N*4);for(let i=0;i<N;i++){const k=er[i]>0.999?1:0;C[i*4]=d[i*4]*k;C[i*4+1]=d[i*4+1]*k;C[i*4+2]=d[i*4+2]*k;C[i*4+3]=k}
    lv.push({C,w:cw,h:ch});
    while(cw>1||ch>1){const nw=Math.max(1,(cw+1)>>1),nh=Math.max(1,(ch+1)>>1),P=lv[lv.length-1].C,Q=new Float32Array(nw*nh*4);
      for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){const s=(y*cw+x)*4,t=((y>>1)*nw+(x>>1))*4;Q[t]+=P[s];Q[t+1]+=P[s+1];Q[t+2]+=P[s+2];Q[t+3]+=P[s+3]}
      for(let i=0;i<nw*nh;i++){const a=Q[i*4+3];if(a>1){Q[i*4]/=a;Q[i*4+1]/=a;Q[i*4+2]/=a;Q[i*4+3]=1}}
      lv.push({C:Q,w:nw,h:nh});cw=nw;ch=nh}
    for(let l=lv.length-2;l>=0;l--){const F=lv[l],Cc=lv[l+1];for(let y=0;y<F.h;y++)for(let x=0;x<F.w;x++){const i=(y*F.w+x)*4,a=F.C[i+3];if(a>=1)continue;
        const fx=Math.min(Cc.w-1,Math.max(0,(x-.5)/2)),fy=Math.min(Cc.h-1,Math.max(0,(y-.5)/2)),x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(Cc.w-1,x0+1),y1=Math.min(Cc.h-1,y0+1),tx=fx-x0,ty=fy-y0;
        for(let k=0;k<3;k++){const g=(xx,yy)=>{const j=(yy*Cc.w+xx)*4,b=Cc.C[j+3]||1;return Cc.C[j+k]/(b>1?b:1)};
          const v=(g(x0,y0)*(1-tx)+g(x1,y0)*tx)*(1-ty)+(g(x0,y1)*(1-tx)+g(x1,y1)*tx)*ty;F.C[i+k]=F.C[i+k]+(1-a)*v}F.C[i+3]=1}}
    fill=new Uint8ClampedArray(N*4);const T=lv[0].C;for(let i=0;i<N;i++){fill[i*4]=T[i*4];fill[i*4+1]=T[i*4+1];fill[i*4+2]=T[i*4+2];fill[i*4+3]=cls[i]<0?0:255}
    mBg=new Uint8Array(N);for(let i=0;i<N;i++)mBg[i]=er[i]>0.999?255:0}
  const cnt=[0,0,0,0];for(let i=0;i<N;i++)cnt[cls[i]+1]++;
  const map=new Uint8Array(N);for(let i=0;i<N;i++)map[i]=cls[i]<0?0:cls[i]+1;
  const tr=[map.buffer];if(mImg)tr.push(mImg.buffer);if(mBg)tr.push(mBg.buffer);if(fill)tr.push(fill.buffer);
  post({done:true,id:J.id,w,h,layers,nodes,mImg,mBg,fill,map,cnt,ms:Date.now()-t0},tr)}

self.onmessage=function(ev){try{const J=ev.data;
  if(J.type==='trace'){const m=new Uint8Array(J.mask),res=contour(m,J.w,J.h,J.minA||4,J.eps||0.5);self.postMessage({done:true,id:J.id,objs:res.objs,nodes:res.nodes});return}
  engine(J)}catch(err){self.postMessage({error:String(err&&err.stack||err)})}};
