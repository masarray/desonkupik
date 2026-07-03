export {};

type DeSonKuPikDesktopSaveKind = "wav" | "mp3" | "json" | "binary";
type DeSonKuPikDesktopMenuCommand =
  | "open-audio"
  | "export-wav"
  | "export-mp3"
  | "new-session"
  | "help"
  | "about";

interface DeSonKuPikDesktopSaveResult {
  canceled: boolean;
  filePath?: string;
}

interface DeSonKuPikDesktopBridge {
  isDesktop: true;
  platform: NodeJS.Platform;
  openAudioFile: () => Promise<File | null>;
  openSettingsFile: () => Promise<File | null>;
  saveBlob: (
    blob: Blob,
    defaultName: string,
    kind?: DeSonKuPikDesktopSaveKind,
  ) => Promise<DeSonKuPikDesktopSaveResult>;
  onMenuCommand: (callback: (command: DeSonKuPikDesktopMenuCommand) => void) => () => void;
}

declare global {
  interface Window {
    desonkupikDesktop?: DeSonKuPikDesktopBridge;
  }
}
