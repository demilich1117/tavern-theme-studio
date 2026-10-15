// Native drawer IDs verified against SillyTavern 1.19.0 public/index.html.
export const DRAWERS = [
  ['left', '生成设置', '#left-nav-panel'], ['right', '角色管理', '#right-nav-panel'],
  ['drawer-api', '连接设置', '#rm_api_block'], ['drawer-format', '高级格式', '#AdvancedFormatting'],
  ['drawer-world', '世界书', '#WorldInfo'], ['drawer-settings', '用户设置', '#user-settings-block'],
  ['drawer-background', '背景', '#Backgrounds'], ['drawer-extensions', '扩展', '#rm_extensions_block'],
  ['drawer-persona', '用户角色', '#PersonaManagement'],
];
export const isDrawer = id => DRAWERS.some(([key]) => key === id);
export const drawerParts = DRAWERS.flatMap(([id, name, selector]) => {
  const range = `${selector} input[type="range"]`, checkbox = `${selector} input[type="checkbox"]`;
  return [
    ...(!['left', 'right'].includes(id) ? [{ id, name: `${name}抽屉`, selector, drawer: true, icon: '▣', note: '先用浏览工具打开此抽屉，再切回选择；位置以预览视口为准，高度可还原为随内容变化。' }] : []),
    { id: `${id}-range`, name: `${name} · 滑块轨道`, selector: range, control: 'range', parent: id, icon: '━', note: '仅调整此抽屉内的原生滑块；手柄从相关部件或目录选择。' },
    { id: `${id}-thumb`, name: `${name} · 滑块手柄`, selector: `${range}::-webkit-slider-thumb`, elementSelector: range, pseudo: '::-webkit-slider-thumb', alternateSelector: `${range}::-moz-range-thumb`, control: 'thumb', parent: `${id}-range`, icon: '●', note: '调整此抽屉内所有滑块手柄；选框标出所属滑块，尺寸在属性中编辑。' },
    { id: `${id}-checkbox`, name: `${name} · 复选框`, selector: checkbox, control: 'checkbox', parent: id, icon: '☐', note: '调整此抽屉内所有复选框外框，保留原生点击和选中状态。' },
    { id: `${id}-checked`, name: `${name} · 已勾选外框`, selector: `${checkbox}:checked`, elementSelector: checkbox, control: 'checked', parent: `${id}-checkbox`, icon: '☑', note: '仅在勾选状态生效；用浏览工具切换状态查看。' },
    { id: `${id}-tick`, name: `${name} · 勾选图案`, selector: `${checkbox}::before`, elementSelector: checkbox, pseudo: '::before', control: 'tick', parent: `${id}-checkbox`, icon: '✓', note: '图案只在原生勾选时显示；可调尺寸、颜色和形状。' },
  ];
});
export const controlKind = id => drawerParts.find(t => t.id === id)?.control;
export const TICK_SHAPES = {
  check: 'polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%)',
  circle: 'circle(50%)', square: 'inset(0)', diamond: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
  cross: 'polygon(20% 0,50% 30%,80% 0,100% 20%,70% 50%,100% 80%,80% 100%,50% 70%,20% 100%,0 80%,30% 50%,0 20%)',
};
export function drawerDeclarations(target, props) {
  const extra = [];
  if (isDrawer(target.id)) {
    if ('left' in props || 'top' in props) extra.push('position: fixed', 'transform: none');
    if ('left' in props) extra.push('right: auto', 'margin-left: 0', 'margin-right: 0');
    if ('top' in props) extra.push('bottom: auto', 'margin-top: 0', 'margin-bottom: 0');
    if ('width' in props) { extra.push('min-width: 0', 'box-sizing: border-box'); if (!('max-width' in props)) extra.push('max-width: 100vw'); }
    if ('height' in props) extra.push('min-height: 0', 'box-sizing: border-box');
  }
  if (target.control === 'tick') {
    if (props['background-color']) extra.push('box-shadow: none');
    if (props['--tts-tick-shape']) extra.push(`clip-path: ${TICK_SHAPES[props['--tts-tick-shape']]}`);
  }
  return extra.map(d => `  ${d} !important;`);
}
