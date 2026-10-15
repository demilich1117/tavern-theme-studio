// Stable legacy IDs describe shared rules. New picks always use a role ID.
export const MESSAGE_PARTS = Object.freeze({
  avatar: '头像', 'message-text': '正文', name: '名字', timestamp: '时间戳',
  'message-body': '消息内容组', 'reasoning-block': '整个推理块',
  reasoning: '思考正文', 'reasoning-header': '思考折叠栏', quote: '引用块',
  media: '图片与媒体区', attachments: '附件区',
  code: '代码块', table: '表格', 'message-buttons': '消息操作栏',
});
export const MESSAGE_ROLES = Object.freeze({ assistant: '角色', user: '用户' });
export function messagePart(id) {
  const part = id?.replace(/^(?:assistant|user)-/, '');
  return Object.hasOwn(MESSAGE_PARTS, part) ? part : undefined;
}
export const rolePartIds = parts => Object.keys(MESSAGE_ROLES).flatMap(role => parts.map(part => `${role}-${part}`));
