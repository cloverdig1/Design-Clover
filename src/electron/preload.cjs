
const { contextBridge, ipcRenderer } = require("electron");

let openProjectFileHandler = null;
const pendingProjectFiles = [];

ipcRenderer.on("design-clover:open-project", (_event, file) => {
  if (openProjectFileHandler) {
    openProjectFileHandler(file);
  } else {
    pendingProjectFiles.push(file);
  }
});

contextBridge.exposeInMainWorld("designClover", {
  version: "1.0.0",
  onOpenProjectFile: (callback) => {
    openProjectFileHandler = callback;
    pendingProjectFiles.splice(0).forEach(callback);
    return () => {
      if (openProjectFileHandler === callback) openProjectFileHandler = null;
    };
  },
});
