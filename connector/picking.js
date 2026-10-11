import { TARGETS } from '../shared/core.js';
// Only offer known semantic parts. Body is a valid hit only on the page itself.
const priority = ['avatar', 'input', 'name', 'timestamp', 'reasoning-header', 'reasoning', 'quote', 'code', 'table', 'message-buttons', 'message-text', 'composer', 'assistant', 'user', 'chat', 'stage', 'left', 'right', 'global'];
export function pickCandidates(element) {
  if (!element?.closest || element.closest('[data-tts-ui]')) return [];
  return priority.flatMap(id => {
    const target = TARGETS.find(t => t.id === id);
    const el = id === 'global' ? (element.matches('body') ? element : null) : element.closest(target.selector);
    return el ? [{ target, el }] : [];
  });
}
export function relatedLayers(project, element, matches = () => true) {
  if (!element || !project?.recipe) return [];
  return project.decorations.filter(layer => {
    const slot = project.recipe.slots.find(s => s.id === layer.slotId);
    if (!slot || (slot.condition && !matches(slot.condition))) return false;
    try { const host = element.closest(slot.selector); return !!host && !slot.exclude?.some(s => host.matches(s)); } catch { return false; }
  }).map(layer => ({ id: layer.id, name: layer.name }));
}
