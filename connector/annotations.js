import { TARGETS, FIELDS } from '../shared/core.js';
import { validateAnchor } from '../shared/tickets.js';
import { validateCanvasProposal } from '../shared/canvas.js';

export function captureAnchor(target, element, event, fixture = false) {
  const rect = element.getBoundingClientRect(), computed = getComputedStyle(element, target.pseudo || null);
  const matches = [...document.querySelectorAll(target.elementSelector || target.selector)];
  const message = element.closest('#chat .mes[mesid]');
  return validateAnchor({ target: target.id, occurrence: Math.max(0, matches.indexOf(element)), fixture,
    messageIndex: fixture && message ? Number(message.getAttribute('mesid')) : undefined,
    point: { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / (rect.width || 1))), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / (rect.height || 1))) },
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    values: target.control === 'thumb' ? {} : Object.fromEntries(FIELDS.map(f => [f.key, computed.getPropertyValue(f.key)])) });
}
export function createAnnotationPins({ send, fixtureActive, onReveal, getBasis = () => ({}) }) {
  const host = document.createElement('div'); host.id = 'tts-annotation-pins'; host.dataset.ttsUi = '';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = ':host{all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483645!important}button{all:initial;box-sizing:border-box;position:fixed;width:32px;height:32px;border-radius:50% 50% 50% 0;background:#e6aa64;color:#241c12;border:2px solid #17191d;box-shadow:0 2px 8px #0005;font:600 13px Segoe UI,sans-serif;text-align:center;cursor:pointer;pointer-events:auto;transform:translate(-4px,-28px)}button:hover,button:focus-visible{outline:2px solid #fff;outline-offset:2px}button[hidden]{display:none}';
  style.textContent += ':host([hidden]){display:none!important}.proposal{position:fixed;box-sizing:border-box;border:2px dashed #e6aa64;background:#e6aa6408;color:#e6aa64;font:12px/1.5 Segoe UI,sans-serif;pointer-events:none}.proposal[hidden]{display:none}.proposal span{position:absolute;top:0;left:0;padding:2px 6px;background:#17191de8}';
  shadow.append(style); document.body.append(host);
  let entries = [], frame = 0;
  function locate(anchor) {
    if (anchor.fixture !== fixtureActive()) return null;
    const target = TARGETS.find(t => t.id === anchor.target); if (!target) return null;
    const matches = [...document.querySelectorAll(target.elementSelector || target.selector)];
    return anchor.messageIndex !== undefined ? matches.find(el => el.closest('.mes')?.getAttribute('mesid') === String(anchor.messageIndex)) : matches[anchor.occurrence];
  }
  function draw() {
    frame = 0;
    for (const entry of entries) {
      const element = locate(entry.anchor), rect = element?.getBoundingClientRect();
      const x = rect ? rect.left + rect.width * entry.anchor.point.x : 0, y = rect ? rect.top + rect.height * entry.anchor.point.y : 0;
      entry.button.hidden = !rect || !rect.width || !rect.height || x < 0 || x > innerWidth || y < 0 || y > innerHeight || !element.checkVisibility();
      entry.button.style.left = `${x}px`; entry.button.style.top = `${y}px`;
      if (entry.proposal) {
        const p = entry.canvas, r = p.after, before = p.before;
        const matching = entry.basis?.fingerprint === getBasis()?.fingerprint && Math.abs(entry.anchor.viewport.width - innerWidth) < 1 && Math.abs(entry.anchor.viewport.height - innerHeight) < 1;
        entry.proposal.hidden = entry.button.hidden || !matching;
        if (rect) Object.assign(entry.proposal.style, { left: `${rect.left + r.left - before.left}px`, top: `${rect.top + r.top - before.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      }
    }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
  document.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
  const observer = new ResizeObserver(schedule); observer.observe(document.body);
  const timer = setInterval(schedule, 1000);
  return {
    setVisible(visible) { host.hidden = !visible; },
    set(tickets) {
      for (const entry of entries) { entry.button.remove(); entry.proposal?.remove(); } entries = [];
      for (const ticket of tickets.slice(0, 200)) {
        if (ticket.state === 'done') continue;
        const anchor = validateAnchor(ticket.anchor), button = document.createElement('button'); button.textContent = ticket.number;
        button.setAttribute('aria-label', `打开标注小票 ${ticket.number}`); button.title = `标注 #${ticket.number}`;
        button.addEventListener('click', () => { onReveal(); send('annotation-ticket', { id: ticket.id }); });
        let proposal, canvas;
        if (ticket.canvas && ticket.canvas.kind !== 'blueprint') { canvas = validateCanvasProposal(ticket.canvas); proposal = document.createElement('div'); proposal.className = 'proposal'; proposal.hidden = true; const label = document.createElement('span'); label.textContent = `#${ticket.number} 布局提案`; proposal.append(label); shadow.append(proposal); }
        shadow.append(button); entries.push({ anchor, button, id: ticket.id, proposal, canvas, basis: ticket.basis });
      }
      schedule();
    },
    focus(anchor) {
      const element = locate(validateAnchor(anchor));
      if (!element) throw new Error('当前场景找不到标注部件，请打开对应测试场景。');
      element.scrollIntoView({ block: 'center', behavior: 'instant' }); schedule();
    },
    dispose() { clearInterval(timer); cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); host.remove(); },
  };
}
