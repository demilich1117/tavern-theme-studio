import { attachBridge } from '/connector/bridge.js';
const session = new URLSearchParams(location.hash.slice(1)).get('session');
const chat = document.querySelector('#chat'), original = chat.innerHTML;
function names() {
  for (const name of document.querySelectorAll('.ch_name')) {
    const text = [...name.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (text) { const span = document.createElement('span'); span.className = 'name_text'; span.textContent = text.textContent; text.replaceWith(span); }
    name.querySelector('small')?.classList.add('timestamp');
    const actions = name.querySelector('span:last-child'); if (actions && !actions.classList.contains('name_text')) actions.classList.add('mes_buttons');
  }
}
function scene(value) {
  const allowed = ['chat', 'long', 'rich', 'reasoning', 'sidebar', 'composer'];
  const selected = allowed.includes(value) ? value : 'chat'; document.body.dataset.scene = selected;
  chat.innerHTML = original; const text = chat.querySelector('.mes_text');
  const textarea = document.querySelector('#send_textarea'); textarea.value = ''; textarea.style.height = '';
  if (selected === 'long') {
    text.replaceChildren();
    for (let i = 0; i < 10; i++) { const p = document.createElement('p'); p.textContent = `第 ${i + 1} 段 · 路沿着河岸延伸，风从树梢吹过。我们停下来辨认远处的山峰，在地图上标记下一处营地。这是一段用于检查行宽、段落间距和长消息滚动的独立示例文字。`; text.append(p); }
  }
  if (selected === 'rich') text.innerHTML = '<p>文字、引用、代码与表格应能在同一条消息中阅读。</p><blockquote>路标写着：沿河向北，在第三座桥前转弯。</blockquote><pre><code>const journey = {\n  destination: "north-bank",\n  companions: ["traveler", "guide"],\n  note: "A deliberately long line for checking horizontal scrolling in a code block."\n};</code></pre><table><thead><tr><th>地点</th><th>路线</th><th>预计时间</th></tr></thead><tbody><tr><td>林间小路</td><td>沿河向北</td><td>二十分钟</td></tr><tr><td>山顶营地</td><td>经过石桥与旧驿站</td><td>一个小时</td></tr></tbody></table><p>正文在表格后继续，检查是否被遮挡。</p>';
  if (selected === 'reasoning') {
    const details = document.createElement('details'); details.className = 'mes_reasoning_details'; details.open = true;
    details.innerHTML = '<summary class="mes_reasoning_summary"><span class="mes_reasoning_header_title">思考示例 · 点击折叠</span></summary><div class="mes_reasoning">这是独立的思考区域样例，用于检查字体、留白和展开状态。它不包含模型的实际推理记录。</div>';
    text.before(details);
  }
  if (selected === 'composer') { textarea.value = '第一行：描述眼前的景色。\n第二行：补充人物的动作。\n第三行：提出下一步的选择。\n第四行：检查多行输入和按钮对齐。'; textarea.style.height = '120px'; }
  names(); chat.scrollTop = 0;
}
scene('chat');
document.querySelector('#send_form').addEventListener('submit', e => e.preventDefault());
if (session && window.parent !== window) attachBridge({ peer: window.parent, origin: location.origin, session, isDemo: true, onScene: scene, hostName: '示例场景', readTheme: async () => ({ name: '林间夜话', custom_css: '', main_text_color: '#d5d7d7', chat_tint_color: '#252a2d', blur_tint_color: '#23282b' }) });
