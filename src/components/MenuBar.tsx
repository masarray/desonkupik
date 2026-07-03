// Top menu bar: File / Settings / Preset, plus app name + current file.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/state/app";
import { getPlayer } from "@/audio/player";
import { renderToMp3, renderToWav } from "@/audio/render";
import { formatHeadroomToast } from "@/audio/inputHeadroom";
import { FACTORY_PRESETS, normalizeSettings } from "@/audio/presets";
import desonIconUrl from "@/assets/desonkupik-icon.png";
import {
  FileAudio,
  Download,
  Upload,
  Settings as SettingsIcon,
  Save,
  HelpCircle,
  Info,
  Undo2,
  Redo2,
  X,
} from "lucide-react";

type InfoModal = "help" | "about" | null;

export function MenuBar() {
  const fileName = useApp((s) => s.fileName);
  const [modal, setModal] = useState<InfoModal>(null);
  // Read settings imperatively in handlers — subscribing here re-renders the
  // top bar on every knob movement (~60 fps), which was a real CPU sink.
  const selectedPresetId = useApp((s) => s.selectedPresetId);
  const importSettings = useApp((s) => s.importSettings);
  const applyPreset = useApp((s) => s.applyPreset);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const canUndo = useApp((s) => s.historyPast.length > 0);
  const canRedo = useApp((s) => s.historyFuture.length > 0);
  const selectedPreset = FACTORY_PRESETS.find((p) => p.id === selectedPresetId);
  const presetName = selectedPreset?.name ?? "Custom";

  const audioInputRef = useRef<HTMLInputElement>(null);
  const settingsInputRef = useRef<HTMLInputElement>(null);
  const isDesktop = Boolean(window.desonkupikDesktop?.isDesktop);

  const handleAudio = async (file: File) => {
    try {
      const store = useApp.getState();
      store.setIsLoading(true);
      store.setLoadingMessage("Preparing audio file…");
      store.setFileName(file.name);
      const p = getPlayer();
      const headroom = await p.loadFile(file, store.settings, (message) => {
        useApp.getState().setLoadingMessage(message);
      });
      store.setInputHeadroom(headroom);
      store.setOutput({ fileGain: headroom.recommendedFileGainDb });
      store.setDuration(p.duration);
      store.setCurrentTime(0);
      store.setIsPlaying(false);
      toast.success(`Loaded ${file.name}`, { id: "audio-load", duration: 1600 });
      toast.message(formatHeadroomToast(headroom), { id: "headroom-info", duration: 2300 });
    } catch (err) {
      toast.error(`Failed to decode: ${(err as Error).message}`);
      useApp.getState().setFileName(null);
      useApp.getState().setInputHeadroom(null);
    } finally {
      useApp.getState().setIsLoading(false);
    }
  };

  const handleSettingsFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const normalized = normalizeSettings(parsed.settings ?? parsed);
      importSettings(normalized);
      toast.success("Settings imported");
    } catch (err) {
      toast.error(`Invalid settings file: ${(err as Error).message}`);
    }
  };

  const openAudio = async () => {
    const desktopFile = await window.desonkupikDesktop?.openAudioFile();
    if (desktopFile) {
      await handleAudio(desktopFile);
      return;
    }
    if (!window.desonkupikDesktop) audioInputRef.current?.click();
  };

  const importSettingsClick = async () => {
    const desktopFile = await window.desonkupikDesktop?.openSettingsFile();
    if (desktopFile) {
      await handleSettingsFile(desktopFile);
      return;
    }
    if (!window.desonkupikDesktop) settingsInputRef.current?.click();
  };

  useEffect(() => {
    return window.desonkupikDesktop?.onMenuCommand((command) => {
      if (command === "open-audio") void openAudio();
      if (command === "export-wav") void exportWavAudio();
      if (command === "export-mp3") void exportMp3Audio();
      if (command === "new-session") location.reload();
      if (command === "help") setModal("help");
      if (command === "about") setModal("about");
    });
  });

  const exportSettings = async () => {
    const payload = {
      app: "DeSonKuPik",
      version: 1,
      preset: selectedPresetId,
      settings: useApp.getState().settings,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const saved = await saveBlob(blob, `desonkupik-${selectedPresetId}-${stamp()}.json`, "json");
    if (saved) toast.success("Settings exported");
  };

  const exportWavAudio = async () => {
    const p = getPlayer();
    if (!p.audioBuffer) {
      toast.error("Load an audio file first");
      return;
    }
    const tId = toast.loading("Rendering master…");
    try {
      const result = await renderToWav(p.audioBuffer, useApp.getState().settings, (v) => {
        toast.loading(`Rendering master… ${Math.round(v * 100)}%`, { id: tId });
      });
      const base = (fileName ?? "master").replace(/\.[^.]+$/, "");
      const saved = await saveBlob(result.blob, `${base}-desonkupik-master.wav`, "wav");
      if (!saved) {
        toast.info("WAV export canceled", { id: tId });
        return;
      }
      toast.success(
        `Mastered WAV exported · ${result.loudnessAfterLufs.toFixed(1)} LUFS · ${result.truePeakAfterDb.toFixed(1)} dBTP · final ${result.studioGainDb > 0 ? "+" : ""}${result.studioGainDb.toFixed(1)} dB`,
        { id: tId },
      );
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`, { id: tId });
    }
  };

  const exportMp3Audio = async () => {
    const p = getPlayer();
    if (!p.audioBuffer) {
      toast.error("Load an audio file first");
      return;
    }
    const tId = toast.loading("Rendering MP3 master…");
    try {
      const result = await renderToMp3(p.audioBuffer, useApp.getState().settings, (v) => {
        const label = v < 0.72 ? "Rendering master" : "Encoding MP3";
        toast.loading(`${label}… ${Math.round(v * 100)}%`, { id: tId });
      });
      const base = (fileName ?? "master").replace(/\.[^.]+$/, "");
      const saved = await saveBlob(result.blob, `${base}-desonkupik-master-320k.mp3`, "mp3");
      if (!saved) {
        toast.info("MP3 export canceled", { id: tId });
        return;
      }
      const verifyText = result.mp3Verified
        ? ` · MP3 verified${result.mp3VerificationAttempts && result.mp3VerificationAttempts > 1 ? ` · safe trim ${result.mp3VerificationGainDb?.toFixed(1)} dB` : ""}`
        : result.mp3VerificationWarning
          ? " · MP3 verification skipped"
          : "";
      toast.success(
        `Mastered MP3 exported · ${result.bitrateKbps ?? 320} kbps · ${result.loudnessAfterLufs.toFixed(1)} LUFS · ${result.truePeakAfterDb.toFixed(1)} dBTP${verifyText}`,
        { id: tId, duration: 4800 },
      );
      if (result.mp3VerificationWarning) {
        toast.message(result.mp3VerificationWarning, { id: "mp3-verify-warning", duration: 4200 });
      }
    } catch (err) {
      toast.error(`MP3 export failed: ${(err as Error).message}`, { id: tId });
    }
  };

  return (
    <>
      <div className="flex h-12 items-center gap-1 border-b border-border bg-panel-soft px-3">
        <div className="mr-3 flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center overflow-hidden rounded-lg bg-primary/10 ring-1 ring-primary/30">
            <img src={desonIconUrl} alt="DeSonKuPik" className="h-8 w-8 object-contain" />
          </div>
          <div className="leading-none">
            <div className="text-sm font-semibold tracking-tight">DeSonKuPik</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {isDesktop ? "Desktop Mastering" : "Online Mastering"}
            </div>
          </div>
        </div>

        {/* File */}
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-md px-3 py-1.5 text-sm text-foreground/85 hover:bg-accent">
            File
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={openAudio}>
              <FileAudio className="mr-2 h-4 w-4" /> Open audio…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportWavAudio}>
              <Download className="mr-2 h-4 w-4" /> Export WAV (mastered)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportMp3Audio}>
              <Download className="mr-2 h-4 w-4" /> Export MP3 320 kbps
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => location.reload()}>New session</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Edit */}
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-md px-3 py-1.5 text-sm text-foreground/85 hover:bg-accent">
            Edit
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem disabled={!canUndo} onClick={undo}>
              <Undo2 className="mr-2 h-4 w-4" /> Undo
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canRedo} onClick={redo}>
              <Redo2 className="mr-2 h-4 w-4" /> Redo
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Settings */}
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-md px-3 py-1.5 text-sm text-foreground/85 hover:bg-accent">
            Settings
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={exportSettings}>
              <Save className="mr-2 h-4 w-4" /> Export settings…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={importSettingsClick}>
              <Upload className="mr-2 h-4 w-4" /> Import settings…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => applyPreset(FACTORY_PRESETS[0].id)}>
              <SettingsIcon className="mr-2 h-4 w-4" /> Reset to default
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Preset */}
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-foreground/85 hover:bg-accent">
            <span
              className={
                selectedPreset
                  ? "h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(0,229,255,0.8)]"
                  : "h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.65)]"
              }
            />
            Preset
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Factory presets
            </DropdownMenuLabel>
            {FACTORY_PRESETS.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onClick={() => {
                  applyPreset(p.id);
                  toast.success(`Preset: ${p.name}`, { id: "preset-load", duration: 1300 });
                }}
                className="flex flex-col items-start gap-0.5 py-2"
              >
                <div className="flex w-full items-center gap-2">
                  <span
                    className={
                      selectedPresetId === p.id
                        ? "h-1.5 w-1.5 rounded-full bg-primary"
                        : "h-1.5 w-1.5 rounded-full bg-transparent"
                    }
                  />
                  <span className="text-sm">{p.name}</span>
                </div>
                <span className="ml-3.5 text-[11px] text-muted-foreground">{p.description}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Help */}
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-md px-3 py-1.5 text-sm text-foreground/85 hover:bg-accent">
            Help
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem onClick={() => setModal("help")}>
              <HelpCircle className="mr-2 h-4 w-4" /> Quick Guide
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setModal("about")}>
              <Info className="mr-2 h-4 w-4" /> About DeSonKuPik
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex items-center gap-3">
          <div className="ms-mono text-xs text-foreground/55">
            {fileName ? fileName : "No audio loaded"}
          </div>
          <div
            className="inline-flex items-center gap-1.5 rounded-md bg-panel px-2 py-1 text-[10px] uppercase tracking-wider text-foreground/70 ring-1 ring-border"
            title={selectedPreset ? `Active preset: ${presetName}` : "Custom settings"}
          >
            <span
              className={
                selectedPreset
                  ? "h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(0,229,255,0.8)]"
                  : "h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.65)]"
              }
            />
            {presetName}
          </div>
        </div>

        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aac"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleAudio(f);
            e.target.value = "";
          }}
        />
        <input
          ref={settingsInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleSettingsFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {modal && <HelpAboutModal mode={modal} onClose={() => setModal(null)} />}
    </>
  );
}

type GuidePageId =
  | "start"
  | "headroom"
  | "chain"
  | "colorWidth"
  | "compare"
  | "monitor"
  | "export"
  | "seo";

type GuidePage = {
  id: GuidePageId;
  title: string;
  kicker: string;
  summary: string;
  steps: string[];
  proTip: string;
};

const GUIDE_PAGES: GuidePage[] = [
  {
    id: "start",
    title: "Start fast",
    kicker: "Workflow cepat",
    summary:
      "DeSonKuPik dirancang untuk user yang ingin buka file, dengar hasil mastering yang langsung terasa, lalu export tanpa workflow DAW yang berat.",
    steps: [
      "Buka audio lewat File → Open audio, atau drag & drop file ke area aplikasi.",
      "Tunggu Smart Headroom selesai membaca loudness dan peak file.",
      "Tekan Play. Preset Mastering sudah aktif sebagai starting point utama.",
      "Gunakan Bypass untuk mendengar perbedaan sebelum/sesudah processing.",
    ],
    proTip:
      "Untuk mayoritas lagu, jangan langsung mengubah semua knob. Dengarkan dulu 10–20 detik bagian chorus atau bagian paling ramai.",
  },
  {
    id: "headroom",
    title: "Smart Headroom",
    kicker: "Input sebelum chain",
    summary:
      "Smart Headroom menstandardkan gain file sebelum masuk Input Volume dan sebelum FX chain, sehingga preset bekerja dari level yang lebih aman dan konsisten.",
    steps: [
      "File terlalu keras akan diturunkan agar chain tidak mudah clip.",
      "File terlalu pelan bisa dinaikkan secukupnya, tetapi tetap dibatasi oleh peak guard.",
      "File Pre-Gain berlaku untuk bypass dan active chain, jadi A/B tidak jomplang karena gain staging.",
      "Input Volume tetap menjadi kontrol manual user, bukan tempat koreksi otomatis file.",
    ],
    proTip:
      "Headroom yang rapi membuat EQ, compressor, color, width, dan limiter terdengar lebih clean serta lebih mudah diprediksi.",
  },
  {
    id: "chain",
    title: "Mastering Chain",
    kicker: "Urutan processing",
    summary:
      "Chain utama dibuat ringan tetapi mengikuti alur mastering: corrective EQ, glue compression, harmonic color, stereo width, lalu limiter/finalizer.",
    steps: [
      "EQ: bentuk tonal balance, bersihkan low rumble, jaga body vocal/gitar/piano.",
      "Compressor: beri glue ringan agar lagu terasa lebih menyatu tanpa gepeng.",
      "Color: tambah body, harmonics, dan air dengan porsi parallel.",
      "Width: lebarkan image secara source-protected agar vocal tetap center.",
      "Limiter: kontrol peak dan loudness akhir tanpa merusak transient berlebihan.",
    ],
    proTip:
      "Mastering yang baik biasanya perubahan kecil namun tepat. Kalau semua knob ekstrem, hasil bisa cepat terasa besar tetapi melelahkan.",
  },
  {
    id: "colorWidth",
    title: "Color & Width",
    kicker: "Body + image",
    summary:
      "Color dan Width adalah area rasa. Color menambah body dan sparkles, Width mengatur ruang stereo tanpa membuat vocal melayang.",
    steps: [
      "Geser node Color horizontal untuk memilih frekuensi, vertical untuk intensitas.",
      "Lower Body membantu vocal bawah, piano body, gitar akustik, dan warmth.",
      "Vocal Body menjaga suara utama tetap bulat dan dekat.",
      "Width Mix mengatur porsi efek stereo secara parallel; turunkan jika vocal mulai mundur.",
    ],
    proTip:
      "Kalau vocal terasa kabur, turunkan Width Mix atau mid image, bukan langsung menaikkan treble.",
  },
  {
    id: "compare",
    title: "Bypass, Gain Match, A/B",
    kicker: "Perbandingan sehat",
    summary:
      "Bypass dipakai untuk mengecek benefit processing. Gain Match membantu membandingkan lebih fair, tetapi hasil processed tetap dibuat sedikit lebih terasa.",
    steps: [
      "Bypass Off = chain aktif. Bypass On = sinyal melewati chain.",
      "Gain Match On akan menurunkan/menyesuaikan loudness preview untuk komparasi lebih fair.",
      "Lock icon menjaga state Bypass/Gain Match agar tidak berubah saat load preset.",
      "A/B slot membantu menyimpan dua versi setting untuk dibandingkan cepat.",
    ],
    proTip:
      "Matikan Gain Match saat ingin merasakan impact mastering. Aktifkan Gain Match saat ingin audit tonal quality secara lebih objektif.",
  },
  {
    id: "monitor",
    title: "Monitor Output",
    kicker: "Dengar tanpa merusak master",
    summary:
      "Monitor Volume hanya mengatur loudness speaker/headphone user. Ini tidak mengubah chain, meter mastering, limiter, atau file export.",
    steps: [
      "Gunakan slider Monitor untuk menurunkan volume dengar tanpa menyentuh Output Gain.",
      "Double-click slider Monitor untuk reset ke 100%.",
      "Pilih output device untuk routing ke speaker, headphone, DAC, atau audio interface yang didukung browser.",
      "Fitur output device bersifat output-only dan tidak meminta akses microphone.",
    ],
    proTip:
      "Monitor yang nyaman membuat keputusan mastering lebih akurat. Jangan mixing/mastering terlalu keras terlalu lama.",
  },
  {
    id: "export",
    title: "Export Mastered Audio",
    kicker: "File final",
    summary:
      "Saat export, DeSonKuPik membuat render offline lalu menjalankan Studio Loudness Finalizer agar output lebih aman untuk distribusi digital; MP3 memakai encoder 320 kbps dengan ceiling lebih aman untuk lossy/transcoding.",
    steps: [
      "Pilih File → Export WAV (mastered) untuk arsip kualitas penuh, atau Export MP3 320 kbps untuk file praktis siap share.",
      "App merender chain penuh secara offline dari audio buffer asli.",
      "Finalizer mengecek loudness dan true-peak estimate sebelum file WAV/MP3 dibuat.",
      "Nama file export otomatis diberi suffix desonkupik-master.",
    ],
    proTip:
      "Preview dibuat exciting, export dibuat lebih aman. Ini menjaga user experience sekaligus kesiapan file untuk platform global.",
  },
  {
    id: "seo",
    title: "SEO Guide Pages",
    kicker: "Discoverability",
    summary:
      "Quick Guide di dalam app bagus untuk user, tetapi SEO lebih kuat jika guide juga tersedia sebagai halaman publik dengan URL sendiri.",
    steps: [
      "Halaman /quick-guide/ memberi Google dan user konten penjelasan yang bisa dibuka langsung.",
      "Subhalaman guide memakai title, meta description, canonical, dan struktur heading yang jelas.",
      "Sitemap mencantumkan halaman guide agar crawler lebih mudah menemukan konten.",
      "Konten tetap people-first: membantu user memahami workflow mastering, bukan sekadar menumpuk keyword.",
    ],
    proTip: "Modal Help membantu UX; static Quick Guide pages membantu SEO dan shareability.",
  },
];

function HelpAboutModal({
  mode,
  onClose,
}: {
  mode: Exclude<InfoModal, null>;
  onClose: () => void;
}) {
  const isHelp = mode === "help";
  const [guidePageId, setGuidePageId] = useState<GuidePageId>("start");
  const guidePage = GUIDE_PAGES.find((p) => p.id === guidePageId) ?? GUIDE_PAGES[0];

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-background/72 px-4 backdrop-blur-md">
      <div className="flex h-[min(760px,calc(100vh-48px))] w-full max-w-6xl overflow-hidden rounded-2xl border border-primary/20 bg-panel-soft shadow-2xl shadow-black/40 ring-1 ring-white/5">
        {isHelp && (
          <aside className="hidden w-64 shrink-0 border-r border-border/80 bg-background/30 p-3 md:block">
            <div className="px-2 py-2">
              <div className="text-[10px] uppercase tracking-[0.22em] text-primary/85">
                Explorer
              </div>
              <div className="mt-1 text-sm font-semibold">Quick Guide</div>
            </div>
            <div className="mt-2 space-y-1">
              {GUIDE_PAGES.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => setGuidePageId(page.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left transition ${
                    guidePage.id === page.id
                      ? "bg-primary/12 text-foreground ring-1 ring-primary/30"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <div className="text-xs font-semibold">{page.title}</div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] opacity-70">
                    {page.kicker}
                  </div>
                </button>
              ))}
            </div>
            <a
              href="/quick-guide/"
              target="_blank"
              rel="noreferrer"
              className="mt-4 block rounded-lg border border-border/80 bg-panel/70 px-3 py-3 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            >
              Open SEO guide page →
            </a>
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-border/80 px-6 py-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-primary/85">
                {isHelp ? guidePage.kicker : "About"}
              </div>
              <div className="mt-1 text-xl font-semibold tracking-tight">
                {isHelp ? guidePage.title : "DeSonKuPik — Online Mastering"}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-md text-foreground/70 transition hover:bg-accent hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {isHelp ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 text-sm leading-6 text-foreground/82">
              <div className="md:hidden">
                <select
                  value={guidePage.id}
                  onChange={(e) => setGuidePageId(e.target.value as GuidePageId)}
                  className="mb-4 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  {GUIDE_PAGES.map((page) => (
                    <option key={page.id} value={page.id}>
                      {page.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-5">
                <div className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
                  {guidePage.title}
                </div>
                <p className="mt-3 max-w-3xl text-sm text-muted-foreground">{guidePage.summary}</p>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                {guidePage.steps.map((step, index) => (
                  <GuideCard key={`${guidePage.id}-${index}`} title={`${index + 1}`} text={step} />
                ))}
              </div>

              <div className="mt-5 rounded-xl border border-border/70 bg-background/35 px-4 py-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/80">
                  Pro note
                </div>
                <div className="mt-2 text-sm text-muted-foreground">{guidePage.proTip}</div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <a
                  href="/quick-guide/smart-headroom/"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-border/80 bg-panel/65 px-4 py-3 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                >
                  Smart Headroom SEO page
                </a>
                <a
                  href="/quick-guide/mastering-workflow/"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-border/80 bg-panel/65 px-4 py-3 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                >
                  Mastering Workflow SEO page
                </a>
                <a
                  href="/quick-guide/export-loudness/"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-border/80 bg-panel/65 px-4 py-3 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                >
                  Export Loudness SEO page
                </a>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 text-sm leading-6 text-foreground/82">
              <div className="rounded-xl border border-primary/25 bg-primary/5 px-5 py-5">
                <div className="flex items-center gap-3">
                  <img
                    src={desonIconUrl}
                    alt="DeSonKuPik"
                    className="h-12 w-12 rounded-xl object-contain ring-1 ring-white/10"
                  />
                  <div className="text-2xl font-semibold tracking-tight">DeSonKuPik</div>
                </div>
                <div className="mt-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Online mastering web app
                </div>
                <p className="mt-4 max-w-3xl text-sm text-muted-foreground">
                  DeSonKuPik membantu user menghasilkan audio yang clean, lebih hidup, loudness
                  terkontrol, dan siap export langsung dari browser.
                </p>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <GuideCard title="Author" text="Mas Ari" />
                <GuideCard
                  title="Purpose"
                  text="Membantu user non-DAW mendapatkan hasil mastering cepat dengan workflow yang rapi dan mudah dipahami."
                />
                <GuideCard
                  title="Engine"
                  text="Smart Headroom, Parametric EQ, Glue Compressor, Color, Width, Limiter, monitor output routing, dan Studio Loudness Finalizer."
                />
                <GuideCard
                  title="Deployment"
                  text="Desktop ready: npm run desktop:win / desktop:mac. Web ready: npm run build → dist."
                />
              </div>
              <div className="mt-5 rounded-xl border border-border/70 bg-background/35 px-4 py-4 text-xs text-muted-foreground">
                Official site target:{" "}
                <span className="ms-mono text-primary">desonkupik.pages.dev</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GuideCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/35 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary/80">
        {title}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">{text}</div>
    </div>
  );
}

async function saveBlob(
  blob: Blob,
  name: string,
  kind: "wav" | "mp3" | "json" | "binary" = "binary",
) {
  const desktop = window.desonkupikDesktop;
  if (desktop?.saveBlob) {
    const result = await desktop.saveBlob(blob, name, kind);
    return !result.canceled;
  }

  triggerDownload(blob, name);
  return true;
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
}
