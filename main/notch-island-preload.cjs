// The island's page talks to main/notch-island.mjs through this and nothing
// else: like the corner tag's (corner-tag-preload.cjs), a much smaller door
// than preload.cjs, because a window over every other app has no business
// holding the whole bridge.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

const listen = (channel) => (fn) => {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('notchIsland', {
  onState: listen('notch-island:state'),
  // The zoom this page is drawn at, so it can say its sizes in screen points.
  zoom: () => webFrame.getZoomFactor(),
  ready: () => ipcRenderer.invoke('notch-island:ready'),
  // How wide the island gets and how tall it is shut, peeking and open.
  size: (sizes) => ipcRenderer.invoke('notch-island:size', sizes),
  hover: (inside) => ipcRenderer.invoke('notch-island:hover', { inside: !!inside }),
  // Whether what is under the pointer is the island; anywhere else in the
  // window the click must reach whatever is underneath.
  clickable: (on) => ipcRenderer.invoke('notch-island:clickable', { on: !!on }),
  go: (id) => ipcRenderer.invoke('notch-island:go', id),
  dismiss: (id) => ipcRenderer.invoke('notch-island:dismiss', id),
  hide: (choice) => ipcRenderer.invoke('notch-island:hide', choice),
  shut: () => ipcRenderer.invoke('notch-island:shut'),
  settings: () => ipcRenderer.invoke('notch-island:settings'),
  menu: () => ipcRenderer.invoke('notch-island:menu'),
});
