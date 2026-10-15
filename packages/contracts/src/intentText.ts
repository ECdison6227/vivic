/** An explicit new command must not be consumed as an answer to an old question. */
export function startsNewInstruction(text: string): boolean {
  return /^(?:请帮我|帮我|请|给我)?\s*(?:搜索|搜|查|创建|新建|添加|新增|(?:加|列)(?:一?[个张条]|几条|下)?\s*待办|删除|取消|打开|显示|恢复|撤销|聚焦|放大|展开|收起|折叠|待办(?:事项|列表|卡片|卡)?\s*[:：])/.test(text.trim());
}
