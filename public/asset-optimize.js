export async function createImageVariant(asset, { api, width = 256, quality = 0.88, kind = 'thumbnail' }) {
  const info = await api('/api/assets/inspect?id=' + encodeURIComponent(asset.id));
  if (info.animated) throw new Error('动画保留原文件，不能自动转成静态图。');
  if (!Number.isFinite(width) || width < 16 || width > 8192) throw new Error('宽度需为 16–8192 px。');
  const response = await fetch('/assets/' + asset.id); if (!response.ok) throw new Error('原图读取失败。');
  const image = await createImageBitmap(await response.blob());
  try {
    const ratio = Math.min(1, width / image.width), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * ratio)); canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob) throw new Error('浏览器无法编码图片。');
    return api(`/api/assets/variant?original=${asset.id}&kind=${kind}`, blob, true);
  } finally { image.close(); }
}
