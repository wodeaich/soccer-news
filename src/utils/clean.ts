/**
 * 入库前的数据清洗：去 URL、去版主机器人模板话术、压缩空白。
 * 目的：降低垃圾文本对后续大模型 API 的 Token 消耗。
 */
export function cleanRawText(rawText: string): string {
  let text = rawText;

  // 1. 移除所有 URL
  text = text.replace(/https?:\/\/\S+/g, '');

  // 2. 移除 Reddit 常见的版主机器人免责声明
  const botKeywords = [
    'I am a bot, and this action was performed automatically',
    'Please contact the moderators',
    'Your post has been removed',
    'AutoModerator',
  ];
  for (const keyword of botKeywords) {
    text = text.replace(new RegExp(keyword, 'gi'), '');
  }

  // 3. 压缩连续换行和空格
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}
