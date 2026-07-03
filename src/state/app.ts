// Global app state for the mastering web app. Plain Zustand store
// (vanilla — no React middleware to keep imports light).

import { create } from "zustand";
import type { InputHeadroomResult } from "@/audio/inputHeadroom";
import { getPlayer, type AudioRegionEdit } from "@/audio/player";
import {
  DEFAULT_SETTINGS,
  FACTORY_PRESETS,
  normalizeSettings,
  type ColorSettings,
  type CompressorSettings,
  type EqBand,
  type MasterSettings,
  type OutputSettings,
  type WidthSettings,
} from "@/audio/presets";

export type PluginId = "eq" | "compressor" | "color" | "width" | "limiter";

export type HistoryEntry =
  | { type: "settings"; settings: MasterSettings; label: string }
  | { type: "audio-region"; edit: AudioRegionEdit; label: string };

interface AppState {
  fileName: string | null;
  duration: number;
  isPlaying: boolean;
  isLoading: boolean;
  loadingMessage: string;
  currentTime: number;
  inputHeadroom: InputHeadroomResult | null;
  loop: boolean;
  activePlugin: PluginId;
  selectedPresetId: string;
  settings: MasterSettings;
  historyPast: HistoryEntry[];
  historyFuture: HistoryEntry[];
  pendingSettingsEdit: { before: MasterSettings; label: string } | null;
  audioRevision: number;
  bypassLocked: boolean;
  gainMatchLocked: boolean;
  outputGainLocked: boolean;
  // Waveform region selection (seconds). Null when no selection.
  selectionStart: number | null;
  selectionEnd: number | null;
  // A/B compare
  abSlot: "A" | "B";
  abA: MasterSettings;
  abB: MasterSettings;

  setFileName: (n: string | null) => void;
  setDuration: (d: number) => void;
  setIsPlaying: (b: boolean) => void;
  setIsLoading: (b: boolean) => void;
  setLoadingMessage: (message: string) => void;
  setCurrentTime: (t: number) => void;
  setInputHeadroom: (analysis: InputHeadroomResult | null) => void;
  setLoop: (b: boolean) => void;
  setActivePlugin: (p: PluginId) => void;
  setSelection: (start: number | null, end: number | null) => void;
  setBypassLocked: (locked: boolean) => void;
  setGainMatchLocked: (locked: boolean) => void;
  setOutputGainLocked: (locked: boolean) => void;
  undo: () => void;
  redo: () => void;
  beginUserEdit: (label?: string) => void;
  endUserEdit: (label?: string) => void;
  cancelUserEdit: () => void;
  registerAudioEdit: (edit: AudioRegionEdit) => void;

  applyPreset: (presetId: string) => void;
  importSettings: (s: Partial<MasterSettings>) => void;
  setEqEnabled: (b: boolean) => void;
  updateEqBand: (id: string, patch: Partial<EqBand>) => void;
  addEqBand: (band: EqBand) => void;
  removeEqBand: (id: string) => void;
  setCompressor: (patch: Partial<CompressorSettings>) => void;
  setColor: (patch: Partial<ColorSettings>) => void;
  setWidth: (patch: Partial<WidthSettings>) => void;
  setOutput: (patch: Partial<OutputSettings>) => void;

  toggleAB: () => void;
  copyABToOther: () => void;
}

const MAX_HISTORY = 80;

function cloneSettings(settings: MasterSettings): MasterSettings {
  return JSON.parse(JSON.stringify(settings)) as MasterSettings;
}

function settingsChanged(a: MasterSettings, b: MasterSettings) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function settingsEntry(settings: MasterSettings, label: string): HistoryEntry {
  return { type: "settings", settings: cloneSettings(settings), label };
}

function isPresetNeutralOutputPatch(patch: Partial<OutputSettings>) {
  const keys = Object.keys(patch) as Array<keyof OutputSettings>;
  return (
    keys.length > 0 &&
    keys.every((key) =>
      (
        ["bypass", "gainMatchEnabled", "gainMatchGain", "outputGainLock"] as Array<
          keyof OutputSettings
        >
      ).includes(key),
    )
  );
}

function commitMonitorOutputPatch(
  state: AppState,
  settings: MasterSettings,
  patch: Partial<OutputSettings>,
): Partial<AppState> {
  // Bypass, Gain Match, Gain Match auto-offset, and output-lock are monitoring
  // controls. They must not create undo history. In particular, gainMatchGain
  // is updated repeatedly by the meter loop while playback runs; recording that
  // would make Undo appear to click forever before reaching the user's last edit.
  return {
    settings,
    selectedPresetId: state.selectedPresetId,
    pendingSettingsEdit: state.pendingSettingsEdit,
    ...(patch.outputGainLock !== undefined ? { outputGainLocked: patch.outputGainLock } : {}),
    ...(state.abSlot === "A" ? { abA: settings } : { abB: settings }),
  };
}

function commitSettings(
  state: AppState,
  settings: MasterSettings,
  extra: Partial<AppState> = {},
  label = "Change settings",
): Partial<AppState> {
  const selectedPresetId = extra.selectedPresetId ?? "custom";
  // During a drag/gesture, update the live engine every move, but record only
  // one undo point when the gesture ends. This matches DAW/plugin behavior:
  // one user operation = one undo step.
  if (state.pendingSettingsEdit) {
    return {
      ...extra,
      settings,
      selectedPresetId,
      ...(state.abSlot === "A" ? { abA: settings } : { abB: settings }),
    };
  }
  if (!settingsChanged(state.settings, settings)) {
    return { ...extra, settings, selectedPresetId };
  }
  return {
    ...extra,
    settings,
    selectedPresetId,
    historyPast: [...state.historyPast, settingsEntry(state.settings, label)].slice(-MAX_HISTORY),
    historyFuture: [],
    ...(state.abSlot === "A" ? { abA: settings } : { abB: settings }),
  };
}

export const useApp = create<AppState>((set, get) => ({
  fileName: null,
  duration: 0,
  isPlaying: false,
  isLoading: false,
  loadingMessage: "Preparing audio…",
  currentTime: 0,
  inputHeadroom: null,
  loop: false,
  activePlugin: "eq",
  selectedPresetId: FACTORY_PRESETS[0].id,
  settings: DEFAULT_SETTINGS,
  historyPast: [],
  historyFuture: [],
  pendingSettingsEdit: null,
  audioRevision: 0,
  bypassLocked: false,
  gainMatchLocked: false,
  outputGainLocked: DEFAULT_SETTINGS.output.outputGainLock !== false,
  selectionStart: null,
  selectionEnd: null,
  abSlot: "A",
  abA: DEFAULT_SETTINGS,
  abB: DEFAULT_SETTINGS,

  setFileName: (fileName) => set({ fileName }),
  setDuration: (duration) => set({ duration }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setLoadingMessage: (loadingMessage) => set({ loadingMessage }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setInputHeadroom: (inputHeadroom) => set({ inputHeadroom }),
  setLoop: (loop) => set({ loop }),
  setActivePlugin: (activePlugin) => set({ activePlugin }),
  setSelection: (selectionStart, selectionEnd) => set({ selectionStart, selectionEnd }),
  setBypassLocked: (bypassLocked) => set({ bypassLocked }),
  setGainMatchLocked: (gainMatchLocked) => set({ gainMatchLocked }),
  setOutputGainLocked: (outputGainLocked) =>
    set((s) => {
      const settings = {
        ...s.settings,
        output: { ...s.settings.output, outputGainLock: outputGainLocked },
      };
      return {
        settings,
        outputGainLocked,
        selectedPresetId: s.selectedPresetId,
        ...(s.abSlot === "A" ? { abA: settings } : { abB: settings }),
      };
    }),
  undo: () =>
    set((s) => {
      const previous = s.historyPast.at(-1);
      if (!previous) return s;
      if (previous.type === "audio-region") {
        const result = getPlayer().applyAudioRegionEdit(previous.edit, "undo");
        return {
          historyPast: s.historyPast.slice(0, -1),
          historyFuture: [previous, ...s.historyFuture].slice(0, MAX_HISTORY),
          audioRevision: s.audioRevision + 1,
          duration: result?.duration ?? s.duration,
          currentTime: result?.currentTime ?? s.currentTime,
          selectionStart: null,
          selectionEnd: null,
        };
      }
      const settings = cloneSettings(previous.settings);
      return {
        settings,
        historyPast: s.historyPast.slice(0, -1),
        historyFuture: [
          settingsEntry(s.settings, "Redo settings change"),
          ...s.historyFuture,
        ].slice(0, MAX_HISTORY),
        selectedPresetId: "custom",
        pendingSettingsEdit: null,
        ...(s.abSlot === "A" ? { abA: settings } : { abB: settings }),
      };
    }),
  redo: () =>
    set((s) => {
      const next = s.historyFuture[0];
      if (!next) return s;
      if (next.type === "audio-region") {
        const result = getPlayer().applyAudioRegionEdit(next.edit, "redo");
        return {
          historyPast: [...s.historyPast, next].slice(-MAX_HISTORY),
          historyFuture: s.historyFuture.slice(1),
          audioRevision: s.audioRevision + 1,
          duration: result?.duration ?? s.duration,
          currentTime: result?.currentTime ?? s.currentTime,
          selectionStart: null,
          selectionEnd: null,
        };
      }
      const settings = cloneSettings(next.settings);
      return {
        settings,
        historyPast: [...s.historyPast, settingsEntry(s.settings, "Undo settings change")].slice(
          -MAX_HISTORY,
        ),
        historyFuture: s.historyFuture.slice(1),
        selectedPresetId: "custom",
        pendingSettingsEdit: null,
        ...(s.abSlot === "A" ? { abA: settings } : { abB: settings }),
      };
    }),

  beginUserEdit: (label = "Adjust parameter") =>
    set((s) =>
      s.pendingSettingsEdit
        ? s
        : { pendingSettingsEdit: { before: cloneSettings(s.settings), label } },
    ),
  endUserEdit: (label) =>
    set((s) => {
      const pending = s.pendingSettingsEdit;
      if (!pending) return s;
      if (!settingsChanged(pending.before, s.settings)) return { pendingSettingsEdit: null };
      return {
        pendingSettingsEdit: null,
        historyPast: [
          ...s.historyPast,
          settingsEntry(pending.before, label ?? pending.label),
        ].slice(-MAX_HISTORY),
        historyFuture: [],
      };
    }),
  cancelUserEdit: () => set({ pendingSettingsEdit: null }),
  registerAudioEdit: (edit) =>
    set((s) => ({
      historyPast: [
        ...s.historyPast,
        { type: "audio-region" as const, edit, label: edit.label },
      ].slice(-MAX_HISTORY),
      historyFuture: [],
      audioRevision: s.audioRevision + 1,
    })),

  applyPreset: (presetId) => {
    const p = FACTORY_PRESETS.find((x) => x.id === presetId);
    if (!p) return;
    set((s) => {
      const presetSettings = normalizeSettings(p.settings);
      // Smart file headroom is file-specific. Presets change the mastering
      // tone, but must not erase the calibrated source pre-gain stage.
      const settings = {
        ...presetSettings,
        output: {
          ...presetSettings.output,
          fileGain: s.inputHeadroom ? s.settings.output.fileGain : presetSettings.output.fileGain,
          outputGainLock: s.outputGainLocked,
          ...(s.outputGainLocked ? { outputGain: s.settings.output.outputGain } : {}),
          ...(s.bypassLocked ? { bypass: s.settings.output.bypass } : {}),
          ...(s.gainMatchLocked
            ? {
                gainMatchEnabled: s.settings.output.gainMatchEnabled,
                gainMatchGain: s.settings.output.gainMatchGain,
              }
            : {}),
        },
      };
      return commitSettings(s, settings, { selectedPresetId: presetId });
    });
  },

  importSettings: (s) => {
    const current = get();
    const imported = normalizeSettings({ ...current.settings, ...s });
    const settings = {
      ...imported,
      output: {
        ...imported.output,
        fileGain: current.inputHeadroom
          ? current.settings.output.fileGain
          : imported.output.fileGain,
        outputGainLock: current.outputGainLocked,
        ...(current.outputGainLocked ? { outputGain: current.settings.output.outputGain } : {}),
        ...(current.bypassLocked ? { bypass: current.settings.output.bypass } : {}),
        ...(current.gainMatchLocked
          ? {
              gainMatchEnabled: current.settings.output.gainMatchEnabled,
              gainMatchGain: current.settings.output.gainMatchGain,
            }
          : {}),
      },
    };
    set((state) => commitSettings(state, settings));
  },

  setEqEnabled: (eqEnabled) =>
    set((s) => {
      const settings = { ...s.settings, eqEnabled };
      return commitSettings(s, settings);
    }),

  updateEqBand: (id, patch) =>
    set((s) => {
      const eq = s.settings.eq.map((b) => (b.id === id ? { ...b, ...patch } : b));
      const settings = { ...s.settings, eq };
      return commitSettings(s, settings);
    }),

  addEqBand: (band) =>
    set((s) => {
      // Insert keeping the list sorted by frequency (FabFilter-style).
      const eq = [...s.settings.eq, band].sort((a, b) => a.frequency - b.frequency);
      const settings = { ...s.settings, eq, eqEnabled: true };
      return commitSettings(s, settings);
    }),

  removeEqBand: (id) =>
    set((s) => {
      if (s.settings.eq.length <= 1) return s;
      const eq = s.settings.eq.filter((b) => b.id !== id);
      const settings = { ...s.settings, eq };
      return commitSettings(s, settings);
    }),

  setCompressor: (patch) =>
    set((s) => {
      const settings = { ...s.settings, compressor: { ...s.settings.compressor, ...patch } };
      return commitSettings(s, settings);
    }),

  setColor: (patch) =>
    set((s) => {
      const settings = { ...s.settings, color: { ...s.settings.color, ...patch } };
      return commitSettings(s, settings);
    }),

  setWidth: (patch) =>
    set((s) => {
      const settings = { ...s.settings, width: { ...s.settings.width, ...patch } };
      return commitSettings(s, settings);
    }),

  setOutput: (patch) =>
    set((s) => {
      const settings = { ...s.settings, output: { ...s.settings.output, ...patch } };
      if (patch.fileGain !== undefined || patch.inputGain !== undefined) {
        const sticky: Partial<OutputSettings> = {};
        if (patch.fileGain !== undefined) sticky.fileGain = patch.fileGain;
        if (patch.inputGain !== undefined) sticky.inputGain = patch.inputGain;
        const abA = { ...s.abA, output: { ...s.abA.output, ...sticky } };
        const abB = { ...s.abB, output: { ...s.abB.output, ...sticky } };
        return {
          settings,
          selectedPresetId: s.selectedPresetId,
          abA: s.abSlot === "A" ? settings : abA,
          abB: s.abSlot === "B" ? settings : abB,
        };
      }
      if (isPresetNeutralOutputPatch(patch)) {
        return commitMonitorOutputPatch(s, settings, patch);
      }
      return commitSettings(s, settings);
    }),

  toggleAB: () =>
    set((s) => {
      const next = s.abSlot === "A" ? "B" : "A";
      const settings = next === "A" ? s.abA : s.abB;
      return { abSlot: next, settings, outputGainLocked: settings.output.outputGainLock !== false };
    }),

  copyABToOther: () => set((s) => (s.abSlot === "A" ? { abB: s.settings } : { abA: s.settings })),
}));
