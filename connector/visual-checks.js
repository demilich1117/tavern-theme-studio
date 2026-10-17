// Read only measurements. Reports contain DOM identifiers and styles, never field values/chat text.
export const DIAGNOSTIC_EXTRAS = [
  ['background-image', '背景图 / 渐变'], ['filter', '滤镜'], ['font-family', '图标 / 文字字体'],
  ['display', '显示方式'], ['position', '定位方式'], ['z-index', '层级'],
  ['--SmartThemeCheckboxTickColor', '原生勾选颜色'],
  ...['R', 'G', 'B'].map(c => [`--SmartThemeCheckboxBgColor${c}`, `原生勾选底色通道 ${c}`]),
];
export function finiteRunning(animation) {
  return ['running', 'pending'].includes(animation.playState) && animation.effect?.getTiming().iterations !== Infinity;
}
export async function waitForVisualStability({ doc = document, timeout = 1800, signal } = {}) {
  const start = performance.now(); let previous = '', stable = 0;
  while (performance.now() - start < timeout) {
    if (signal?.aborted) throw new Error('检查已取消');
    // Timer is bounded even in background tabs where requestAnimationFrame is suspended.
    await new Promise(resolve => setTimeout(resolve, 50));
    const geometry = [...doc.querySelectorAll('#sheld,#send_form,.drawer-content.openDrawer,dialog[open]')]
      .map(el => { const r = el.getBoundingClientRect(); return [r.x,r.y,r.width,r.height].map(n=>Math.round(n*10)).join(','); }).join(';');
    const animating = (doc.getAnimations?.() || []).some(finiteRunning);
    stable = geometry === previous && !animating && doc.fonts?.status !== 'loading' ? stable + 1 : 0;
    previous = geometry;
    if (stable >= 3) return { stable: true, waitedMs: Math.round(performance.now() - start) };
  }
  return { stable: false, waitedMs: Math.round(performance.now() - start) };
}
export const controlVisible = el => !!el?.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
const identify = el => el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}` : '视口外';
const controlName = el => ({send_but:'发送',mes_stop:'停止生成',stscript_pause:'暂停脚本',stscript_continue:'继续脚本',stscript_stop:'停止脚本'})[el.id] || (el.matches('.drawer-toggle') ? '菜单入口 · '+(el.getAttribute('title')||el.parentElement?.id||'当前菜单') : el.matches('input') ? '选择控件 · '+(el.id||el.type) : identify(el));
export function hitSample(el) {
  const r = el.getBoundingClientRect(), doc = el.ownerDocument;
  const points = [[.5,.5],[.2,.2],[.8,.8]].map(([x,y]) => {
    const hit = doc.elementFromPoint(r.x+r.width*x, r.y+r.height*y);
    return { onControl: !!hit && (el.contains(hit) || (hit.tagName === 'LABEL' && hit.control === el)), hit: identify(hit) };
  });
  return { covered: !points[0].onControl, points };
}
export function contrastRatio(a, b) {
  const parse = value => {
    const m = value.match(/^rgba?\(([^)]+)\)$/); if (!m) return null;
    const n = m[1].split(/[\s,/]+/).map(Number);
    if (![3,4].includes(n.length) || n.length > 3 && n[3] !== 1 || n.slice(0,3).some(v=>!Number.isFinite(v)||v<0||v>255)) return null;
    return n.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  };
  const x=parse(a), y=parse(b); return x===null||y===null ? null : (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
export function controlAppearance(el) {
  const s=getComputedStyle(el), before=getComputedStyle(el,'::before'), after=getComputedStyle(el,'::after');
  const markColor=before.boxShadow.match(/rgba?\([^)]+\)/)?.[0] || before.color;
  let complex = s.backgroundImage !== 'none' || s.filter !== 'none' || Number(s.opacity) !== 1;
  for(let p=el.parentElement;p;p=p.parentElement){const ps=getComputedStyle(p);if(Number(ps.opacity)!==1||ps.filter!=='none')complex=true;}
  const markVisible = before.content !== 'none' && before.content !== 'normal' && before.opacity === '1' && before.backgroundImage === 'none' && before.boxShadow.includes('inset') && before.clipPath !== 'none' && !/^matrix\(0,/.test(before.transform);
  const r=el.getBoundingClientRect(), icon=el.querySelector('i'), ir=icon?.getBoundingClientRect();
  return { element: identify(el), checked: el.checked ?? null, disabled: !!el.disabled, focus: el.matches(':focus-visible'),
    iconOffset:ir?{x:Math.abs(ir.x+ir.width/2-r.x-r.width/2),y:Math.abs(ir.y+ir.height/2-r.y-r.height/2)}:null,
    background: s.backgroundColor, backgroundImage: s.backgroundImage, filter:s.filter, font:s.fontFamily,
    before:{content:before.content,transform:before.transform,color:markColor}, after:{content:after.content,transform:after.transform},
    contrast: !complex && el.checked && markVisible ? contrastRatio(s.backgroundColor,markColor) : null,
    ...hitSample(el) };
}
export function auditControls() {
  const checks=[], samples=[];
  const selectors='input[type="checkbox"],input[type="radio"],#send_but,#mes_stop,#stscript_pause,#stscript_continue,#stscript_stop,.drawer-toggle,.popup .menu_button';
  const modal=[...document.querySelectorAll('dialog[open]')].at(-1);
  const visible=[...document.querySelectorAll(selectors)].filter(el=>!el.closest('[data-tts-ui]')&&(!modal||modal.contains(el))&&controlVisible(el));
  for(const el of visible.slice(0,60)) {
    const r=el.getBoundingClientRect();
    if(r.bottom<=0||r.top>=innerHeight||r.right<=0||r.left>=innerWidth){checks.push({name:identify(el),status:'skip',detail:'控件在视口外，请滚动到可见区域'});continue;}
    const sample=controlAppearance(el); samples.push(sample);
    const low=sample.contrast!==null&&sample.contrast<3;
    const offCenter=el.matches('#mes_stop,#stscript_pause,#stscript_continue,#stscript_stop')&&sample.iconOffset&&(sample.iconOffset.x>2||sample.iconOffset.y>2);
    checks.push({name:controlName(el),status:sample.covered||low||offCenter?'warn':'pass',detail:`${sample.checked===null?'按钮':sample.checked?'已勾选':'未勾选'}${sample.disabled?' · 禁用':''}${sample.covered?' · 中心被 '+sample.points[0].hit+' 遮挡':''}${offCenter?' · 内部图标偏离中心':''}${sample.contrast!==null?' · 勾选对比 '+sample.contrast.toFixed(2)+':1':sample.checked?' · 勾色未判定':''}`});
  }
  if(!visible.length)checks.push({name:'控件状态',status:'skip',detail:'当前没有可见的目标控件，请打开对应抽屉或弹窗'});
  if(visible.length>60)checks.push({name:'采样上限',status:'skip',detail:'仅检查前 60 个可见控件，其余请分面板检查'});
  checks.push({name:'操作与颜色范围',status:'skip',detail:'命中采样不代替真实点击、空格和焦点验证；复杂背景、透明度及未出现的状态不作对比度通过结论'});
  return {checks,samples};
}
