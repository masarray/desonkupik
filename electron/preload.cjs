const { contextBridge, ipcRenderer } = require("electron");

function bytesToFile(result) {
  if (!result) return null;
  const bytes = result.bytes instanceof Uint8Array ? result.bytes : new Uint8Array(result.bytes);
  return new File([bytes], result.name, { type: result.type || "application/octet-stream" });
}

contextBridge.exposeInMainWorld("desonkupikDesktop", {
  isDesktop: true,
  platform: process.platform,

  openAudioFile: async () => bytesToFile(await ipcRenderer.invoke("desktop:open-audio")),
  openSettingsFile: async () => bytesToFile(await ipcRenderer.invoke("desktop:open-settings")),

  saveBlob: async (blob, defaultName, kind = "binary") => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return ipcRenderer.invoke("desktop:save-file", { defaultName, kind, bytes });
  },

  onMenuCommand: (callback) => {
    const handler = (_event, command) => callback(command);
    ipcRenderer.on("desktop:menu-command", handler);
    return () => ipcRenderer.removeListener("desktop:menu-command", handler);
  },
});
