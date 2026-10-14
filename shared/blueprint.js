import { validateAnchor } from './tickets.js';
import { applyCommand, normalizeValue } from './core.js';
import { CANVAS_PROPERTIES, CANVAS_TARGETS } from './canvas.js';

// The same commands and selector compiler as actual-layout editing, in memory.
export function blueprintProject(project, items) {
  return items.reduce((draft,item)=>applyCommand(draft,{type:'canvas-set',scope:item.scope,target:item.anchor.target,props:item.props}),project);
}

export function validateBlueprint(value) {
  if (value?.kind !== 'blueprint' || !Array.isArray(value.items) || !value.items.length || value.items.length > 30) throw new Error('蓝图需包含 1–30 个部件。');
  const dimension = n => { if (!Number.isFinite(n) || n < 1 || n > 20000) throw new Error('蓝图视口无效。'); return Math.round(n); };
  const rect = r => Object.fromEntries(['left', 'top', 'width', 'height'].map(k => {
    const n = r?.[k]; if (!Number.isFinite(n) || Math.abs(n) > 100000 || (['width', 'height'].includes(k) && n < 1)) throw new Error('蓝图部件尺寸无效。');
    return [k, Math.round(n * 100) / 100];
  }));
  const ids = new Set();
  return { kind: 'blueprint', version: 1, viewport: { width: dimension(value.viewport?.width), height: dimension(value.viewport?.height) },
    appearance: value.appearance === 'wireframe' ? 'wireframe' : 'content', items: value.items.map(item => {
      if (!/^[a-z0-9-]{1,80}$/i.test(item.id || '') || ids.has(item.id)) throw new Error('蓝图部件标识无效或重复。'); ids.add(item.id);
      if (typeof item.note !== 'string' || item.note.length > 1000) throw new Error('部件备注最多 1000 字。');
      const result={ id: item.id, anchor: validateAnchor(item.anchor), before: rect(item.before), after: rect(item.after), note: item.note.trim() };
      if(item.props!==undefined){
        if(!CANVAS_TARGETS.includes(result.anchor.target)||!item.props||typeof item.props!=='object'||Array.isArray(item.props)||!Object.keys(item.props).length||Object.keys(item.props).some(k=>!CANVAS_PROPERTIES.includes(k)))throw new Error('蓝图布局属性无效。');
        if(typeof item.scope!=='string'||!/^([a-z][\w-]{0,47}|base)$/.test(item.scope))throw new Error('蓝图编辑范围无效。');
        result.scope=item.scope;result.props=Object.fromEntries(Object.entries(item.props).map(([k,v])=>{const normalized=normalizeValue(k,v);if(normalized===null)throw new Error('蓝图布局属性缺少值。');return [k,normalized];}));result.appliesTo='matching-elements';
      }
      return result;
    }) };
}
