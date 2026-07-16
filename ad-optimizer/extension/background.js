// 点击工具栏图标即打开侧边栏。无任何对广告平台页面的权限/脚本注入 → 零封号风险。
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
