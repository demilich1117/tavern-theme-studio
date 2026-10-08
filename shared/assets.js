export const ASSET_ID = /^[a-f0-9]{64}\.(png|jpg|webp|gif)$/;
export const ASSET_RE = /tts-asset:\/\/([a-f0-9]{64}\.(?:png|jpg|webp|gif))/g;
export function assetReference(id) {
  if (!ASSET_ID.test(id)) throw new Error('素材编号无效。');
  return `tts-asset://${id}`;
}
export function resolveAssetUrls(css, origin) {
  const base = new URL(origin);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('素材服务地址无效。');
  return css.replace(ASSET_RE, (_, id) => `${base.origin}/assets/${id}`);
}
export function externalImageUrl(value) {
  if (typeof value !== 'string' || value.length > 4000) throw new Error('图片 URL 过长。');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('请使用不含账号密码的 HTTP / HTTPS 图片直链。');
  const github = url.hostname === 'github.com' && url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (github) return `https://raw.githubusercontent.com/${github[1]}/${github[2]}/${github[3]}`;
  return url.href;
}
export const cssImage = url => `url(${JSON.stringify(url)})`;
