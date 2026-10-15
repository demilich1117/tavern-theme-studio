import { TARGETS } from '../shared/core.js';
import { MESSAGE_PARTS, rolePartIds } from '../shared/message-parts.js';
// Only offer known semantic parts. Body is a valid hit only on the page itself.
// The collapsed title selects the complete reasoning block by default; the
// header remains available in the inner/outer candidates and semantic tree.
const priority = ['avatar', 'input', 'name', 'timestamp', 'reasoning', 'reasoning-block', 'reasoning-header', 'quote', 'code', 'table', 'message-buttons', 'message-text', 'media', 'attachments', 'message-body', 'composer', 'assistant', 'user', 'chat', 'stage', 'left', 'right', 'global'].flatMap(id => Object.hasOwn(MESSAGE_PARTS, id) ? rolePartIds([id]) : [id]);
export function pickCandidates(element) {
  if (!element?.closest || element.closest('[data-tts-ui]')) return [];
  return priority.flatMap(id => {
    const target = TARGETS.find(t => t.id === id);
    const el = id === 'global' ? (element.matches('body') ? element : null) : element.closest(target.elementSelector || target.selector);
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
