chrome.action.setBadgeText({ text: "RDY" });
chrome.action.onClicked.addListener(async tab => {
  const { isOnToolbar } = await chrome.action.getUserSettings();
  const text = !tab?.id || !tab.active || "url" in tab ? "ERR" : isOnToolbar ? "PIN" : "RUN";
  await chrome.action.setBadgeText({ text });
});
