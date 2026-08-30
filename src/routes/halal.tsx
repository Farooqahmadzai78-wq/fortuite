import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import {
  AlertCircle,
  AlertTriangle,
  Barcode,
  Camera,
  CheckCircle2,
  Flashlight,
  Folder,
  HelpCircle,
  Images,
  Loader2,
  PackageSearch,
  Pencil,
  RotateCw,
  ScanLine,
  Search,
  SearchX,
  ShieldCheck,
  Sparkles,
  Star,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { appToast } from "@/lib/app-toast";
import { PermissionBanner } from "@/components/PermissionBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { useSettings } from "@/lib/app-settings";
import { getWidgetThemeById } from "@/lib/customization-themes";
import { getHalalGuide } from "@/lib/halal-guide";
import { fetchByBarcode, searchByName, type ProductResult } from "@/lib/halal";
import {
  runResilientIngredientAnalysis,
  recoverActiveAnalysis,
  getActiveIngredientAnalysis,
  clearActiveIngredientAnalysis,
} from "@/lib/ingredient-analysis-tracker";
import { IngredientCameraModal } from "@/components/IngredientCameraModal";
import { HalalIngredientsHint } from "@/components/AppFeatureHints";
import { findBestRearCamera, optimizeTrackForReading } from "@/lib/camera-utils";

export const Route = createFileRoute("/halal")({
  head: () => ({
    meta: [
      { title: "Scanner Halal / Haram — Islam-Noor" },
      {
        name: "description",
        content:
          "Scannez un code-barres ou cherchez un produit pour obtenir un verdict halal, haram ou douteux avec ses sources.",
      },
      { property: "og:title", content: "Scanner Halal / Haram — Islam-Noor" },
      { property: "og:description", content: "Verdict à trois niveaux avec sources affichées." },
    ],
  }),
  component: HalalPage,
});

type BarcodeDetectorLike = {
  detect: (src: CanvasImageSource | Blob) => Promise<{ rawValue: string }[]>;
};

type ActivePanel = "scanner" | "manual" | "saved" | null;

/** Plays Web Audio API sound for instant feedback */
function playVerdictSound(verdict: ProductResult["verdict"]) {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    if (verdict === "halal") {
      // Ascending triple tone (C5 -> E5 -> G5)
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.08);
      osc.frequency.setValueAtTime(783.99, now + 0.16);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.start(now);
      osc.stop(now + 0.45);
    } else if (verdict === "haram") {
      // Low warning double-beep (Ab3 -> F3)
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(207.65, now);
      osc.frequency.setValueAtTime(174.61, now + 0.12);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
    } else {
      // Doubtful / unknown: soft notification chime
      osc.type = "triangle";
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(554.37, now + 0.1);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    }
  } catch {
    /* ignore audio error */
  }
}

function HalalPage() {
  const { t, locale } = useI18n();
  const { settings, update } = useSettings();
  const activeWidgetTheme = getWidgetThemeById(settings.widgetTheme);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [manualInputCode, setManualInputCode] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [camDenied, setCamDenied] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [isIngredientCameraOpen, setIsIngredientCameraOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [torchOn, setTorchOn] = useState(false);
  const [verdictOverlay, setVerdictOverlay] = useState<ProductResult | null>(null);

  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  const stopScan = useCallback(() => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          html5QrCodeRef.current.stop().catch(() => {});
        }
        html5QrCodeRef.current.clear();
      } catch {
        /* ignore cleanup */
      }
      html5QrCodeRef.current = null;
    }
    setTorchOn(false);
    setScanning(false);
  }, []);

  const startScan = useCallback(() => {
    setCamDenied(false);
    setScanning(true);
  }, []);

  const toggleTorch = async () => {
    if (!html5QrCodeRef.current) return;
    try {
      const nextState = !torchOn;
      await html5QrCodeRef.current.applyVideoConstraints({
        advanced: [{ torch: nextState }] as unknown as MediaTrackConstraints[],
      });
      setTorchOn(nextState);
    } catch {
      appToast.error(t.cannotOpenCamera || "Flash non disponible sur cette caméra", {
        category: "scanner",
      });
    }
  };

  const toggleCamera = () => {
    stopScan();
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
    setTimeout(() => {
      startScan();
    }, 150);
  };

  const togglePanel = useCallback(
    (panel: ActivePanel) => {
      if (activePanel === panel) {
        if (activePanel === "scanner") stopScan();
        setShowSaved(false);
        setActivePanel(null);
      } else {
        if (activePanel === "scanner") stopScan();
        setActivePanel(panel);

        if (panel === "scanner") {
          setShowSaved(false);
          startScan();
        } else if (panel === "saved") {
          setShowSaved(true);
        } else {
          setShowSaved(false);
        }
      }
    },
    [activePanel, startScan, stopScan],
  );

  // Smooth scroll to guide section if requested from home screen
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (
      url.searchParams.get("guide") === "true" ||
      url.hash === "#guide-section" ||
      window.location.hash === "#guide-section"
    ) {
      const timer = setTimeout(() => {
        const el = document.getElementById("guide-section");
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          el.classList.add("ring-2", "ring-emerald-400", "transition-all", "duration-500");
          setTimeout(() => el.classList.remove("ring-2", "ring-emerald-400"), 2200);
        }
      }, 200);
      return () => clearTimeout(timer);
    }
  }, []);

  const searchReqIdRef = useRef(0);

  const triggerProductVerdict = useCallback((product: ProductResult) => {
    playVerdictSound(product.verdict);
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      try {
        if (product.verdict === "halal") {
          navigator.vibrate([80, 40, 80]);
        } else if (product.verdict === "haram") {
          navigator.vibrate([200, 80, 200]);
        } else {
          navigator.vibrate([100, 50]);
        }
      } catch {
        /* ignore */
      }
    }
    setVerdictOverlay(product);
  }, []);

  const executeSearch = useCallback(
    async (searchTerm: string) => {
      const trimmed = searchTerm.trim();
      if (trimmed.length < 2) {
        setResults([]);
        setNotFound(false);
        setBusy(false);
        return;
      }

      const currentReqId = ++searchReqIdRef.current;
      setBusy(true);

      try {
        const r = await searchByName(trimmed);
        if (currentReqId === searchReqIdRef.current) {
          setResults(r);
          setShowSaved(false);
          setNotFound(r.length === 0);
          if (r.length === 1) {
            triggerProductVerdict(r[0]);
          }
        }
      } catch {
        if (currentReqId === searchReqIdRef.current) {
          appToast.error(t.searchUnavailable || "Search unavailable", { category: "scanner" });
        }
      } finally {
        if (currentReqId === searchReqIdRef.current) {
          setBusy(false);
        }
      }
    },
    [t, triggerProductVerdict],
  );

  // Live search as user types with 350ms debounce
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setNotFound(false);
      setBusy(false);
      return;
    }

    setBusy(true);

    const timer = setTimeout(() => {
      void executeSearch(query);
    }, 350);

    return () => clearTimeout(timer);
  }, [query, executeSearch]);

  const runName = () => {
    void executeSearch(query);
  };

  const runCode = useCallback(
    async (code: string) => {
      setBusy(true);
      try {
        const r = await fetchByBarcode(code);
        setResults(r ? [r] : []);
        setShowSaved(false);
        setNotFound(!r);
        if (r) {
          triggerProductVerdict(r);
        }
      } catch {
        appToast.error(t.searchUnavailable || "Search unavailable", { category: "scanner" });
      } finally {
        setBusy(false);
      }
    },
    [t, triggerProductVerdict],
  );

  /* Camera initialization & continuous ultra-fast detection loop using Html5Qrcode */
  useEffect(() => {
    if (activePanel !== "scanner" || !scanning) return;
    let isCancelled = false;

    const initCamera = async () => {
      const el = document.getElementById("halal-barcode-reader");
      if (!el) return;

      try {
        const qr = new Html5Qrcode("halal-barcode-reader");
        html5QrCodeRef.current = qr;

        // Discover best rear camera ID if in environment mode
        let cameraConfig: MediaTrackConstraints | { facingMode: string } = { facingMode };
        if (facingMode === "environment") {
          try {
            const bestRear = await findBestRearCamera();
            if (bestRear?.deviceId) {
              cameraConfig = {
                deviceId: { exact: bestRear.deviceId },
                facingMode: { ideal: "environment" },
                width: { ideal: 1920, min: 1280 },
                height: { ideal: 1080, min: 720 },
              } as MediaTrackConstraints;
            } else {
              cameraConfig = {
                facingMode: { ideal: "environment" },
                width: { ideal: 1920, min: 1280 },
                height: { ideal: 1080, min: 720 },
              } as MediaTrackConstraints;
            }
          } catch {
            cameraConfig = { facingMode };
          }
        }

        await qr.start(
          cameraConfig,
          {
            fps: 30,
            qrbox: (viewWidth, viewHeight) => {
              const minSize = 50;
              const w = Math.max(minSize, Math.min((viewWidth || 300) * 0.88, 360));
              const h = Math.max(minSize, Math.min((viewHeight || 250) * 0.65, 260));
              return { width: Math.floor(w), height: Math.floor(h) };
            },
            aspectRatio: 1.333333,
            videoConstraints: {
              facingMode: { ideal: facingMode },
              width: { ideal: 1920, min: 1280 },
              height: { ideal: 1080, min: 720 },
            },
            experimentalFeatures: {
              useBarCodeDetectorIfSupported: true,
            },
            formatsToSupport: [
              Html5QrcodeSupportedFormats.EAN_13,
              Html5QrcodeSupportedFormats.EAN_8,
              Html5QrcodeSupportedFormats.UPC_A,
              Html5QrcodeSupportedFormats.UPC_E,
              Html5QrcodeSupportedFormats.CODE_128,
              Html5QrcodeSupportedFormats.CODE_39,
              Html5QrcodeSupportedFormats.ITF,
              Html5QrcodeSupportedFormats.CODABAR,
              Html5QrcodeSupportedFormats.QR_CODE,
            ],
          },
          (decodedText) => {
            if (isCancelled) return;
            if (decodedText && decodedText.trim().length >= 4) {
              isCancelled = true;
              stopScan();
              togglePanel(null);
              void runCode(decodedText.trim());
            }
          },
          () => {
            /* frame tick error, normal */
          },
        );

        // Optimize active video track for continuous autofocus and sharpness
        try {
          const videoElem = el.querySelector("video") as HTMLVideoElement | null;
          if (videoElem && videoElem.srcObject) {
            const stream = videoElem.srcObject as MediaStream;
            const track = stream.getVideoTracks()[0];
            if (track) {
              void optimizeTrackForReading(track);
            }
          }
        } catch {
          // ignore if not supported
        }
      } catch (err: unknown) {
        console.warn("Camera barcode scanner error:", err);
        const errStr = String(err).toLowerCase();
        if (
          errStr.includes("notallowederror") ||
          errStr.includes("permission") ||
          errStr.includes("denied")
        ) {
          setCamDenied(true);
        } else {
          appToast.error(t.cannotOpenCamera || "Cannot open camera", { category: "scanner" });
        }
        setScanning(false);
      }
    };

    const timer = setTimeout(() => {
      void initCamera();
    }, 100);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
      if (html5QrCodeRef.current) {
        try {
          if (html5QrCodeRef.current.isScanning) {
            html5QrCodeRef.current.stop().catch(() => {});
          }
          html5QrCodeRef.current.clear();
        } catch {
          /* ignore */
        }
        html5QrCodeRef.current = null;
      }
    };
  }, [activePanel, scanning, facingMode, runCode, stopScan, togglePanel, t]);

  const fromGallery = async (file: File) => {
    setBusy(true);
    try {
      let detectedCode: string | null = null;

      // 1. High-speed native BarcodeDetector if supported in browser
      if ("BarcodeDetector" in window) {
        try {
          const detector = new (
            window as unknown as { BarcodeDetector: new (o?: unknown) => BarcodeDetectorLike }
          ).BarcodeDetector();
          const bitmap = await createImageBitmap(file);
          const codes = await detector.detect(bitmap);
          if (codes && codes.length > 0 && codes[0].rawValue) {
            detectedCode = codes[0].rawValue;
          }
        } catch {
          /* proceed to Html5Qrcode */
        }
      }

      // 2. High-precision Html5Qrcode file scan
      if (!detectedCode) {
        try {
          const qr = new Html5Qrcode("halal-barcode-reader-hidden");
          const result = await qr.scanFile(file, true);
          if (result) {
            detectedCode = result;
          }
        } catch (e) {
          console.log("Html5Qrcode scanFile pass 1 failed:", e);
        }
      }

      // 3. Fallback for large high-res images: render and sharpen in canvas
      if (!detectedCode) {
        try {
          const imgBitmap = await createImageBitmap(file);
          const maxDim = 1600;
          let w = imgBitmap.width;
          let h = imgBitmap.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(imgBitmap, 0, 0, w, h);

            if ("BarcodeDetector" in window) {
              const detector = new (
                window as unknown as { BarcodeDetector: new (o?: unknown) => BarcodeDetectorLike }
              ).BarcodeDetector();
              const codes = await detector.detect(canvas);
              if (codes && codes.length > 0 && codes[0].rawValue) {
                detectedCode = codes[0].rawValue;
              }
            }
          }
        } catch {
          /* ignore */
        }
      }

      if (detectedCode) {
        const msg = (t.barcodeExtracted || "Barcode extracted from photo: {code}").replace(
          "{code}",
          detectedCode,
        );
        appToast.success(msg, { category: "scanner" });
        void runCode(detectedCode);
      } else {
        setResults([]);
        setNotFound(true);
        appToast.error(
          t.noBarcodeFoundInPhoto || "No readable barcode found in this photo. Try manual input.",
          { category: "scanner" },
        );
      }
    } catch {
      appToast.error(t.imageAnalysisError || "Image analysis error", { category: "scanner" });
    } finally {
      setBusy(false);
    }
  };

  // Recovery of background / persistent ingredient analysis if app reloaded
  useEffect(() => {
    let isMounted = true;

    const checkActiveAnalysis = async () => {
      try {
        const active = getActiveIngredientAnalysis();
        if (!active) return;

        if (active.status === "completed" && active.product) {
          setResults([active.product]);
          setNotFound(false);
          setShowSaved(false);
          triggerProductVerdict(active.product);
          clearActiveIngredientAnalysis();
          return;
        }

        if (active.status === "processing" || active.status === "pending") {
          setAnalysing(true);

          let polls = 0;
          while (polls < 35 && isMounted) {
            const recovery = await recoverActiveAnalysis(t.photoIngredients || "Ingrédients analysés");
            if (!isMounted) return;

            if (recovery.product) {
              setResults([recovery.product]);
              setNotFound(false);
              setShowSaved(false);
              triggerProductVerdict(recovery.product);
              setAnalysing(false);
              return;
            }

            if (recovery.error) {
              appToast.error(recovery.error, { category: "scanner" });
              setAnalysing(false);
              return;
            }

            if (!recovery.active) {
              setAnalysing(false);
              return;
            }

            polls++;
            await new Promise((resolve) => setTimeout(resolve, 1200));
          }

          if (isMounted) setAnalysing(false);
        }
      } catch (err) {
        console.warn("Analysis recovery check error:", err);
        if (isMounted) setAnalysing(false);
      }
    };

    void checkActiveAnalysis();

    return () => {
      isMounted = false;
    };
  }, [t.photoIngredients, triggerProductVerdict]);

  const handleCaptureIngredientPhoto = async (imageDataUrl: string) => {
    setAnalysing(true);
    setNotFound(false);
    try {
      const product = await runResilientIngredientAnalysis(imageDataUrl, {
        lang: locale || "fr",
        fallbackTitle: t.photoIngredients || "Ingrédients analysés",
      });

      setResults([product]);
      setNotFound(false);
      setShowSaved(false);
      triggerProductVerdict(product);
    } catch (err: unknown) {
      console.error("Ingredient analysis failure:", err);
      appToast.error(t.analysisUnavailable || "Analyse indisponible", { category: "scanner" });
    } finally {
      setAnalysing(false);
    }
  };

  const list = showSaved ? (settings.savedProducts as ProductResult[]) : results;

  return (
    <div className="space-y-5 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <div
        data-widget-card
        className={`widget relative rounded-3xl p-4 sm:p-5 shadow-md border border-white/20 transition-all duration-500 ease-in-out ${
          activeWidgetTheme.animClass || ""
        }`}
        style={{
          background:
            activeWidgetTheme.gradient ||
            `linear-gradient(135deg, ${activeWidgetTheme.from}, ${activeWidgetTheme.to})`,
          color: activeWidgetTheme.fg,
        }}
      >
        <h1
          className="text-2xl font-extrabold tracking-tight drop-shadow-xs"
          style={{ color: activeWidgetTheme.fg }}
        >
          {t.halalTitle}
        </h1>
        <p
          className="text-xs font-medium opacity-90 drop-shadow-2xs mt-0.5"
          style={{ color: activeWidgetTheme.fg }}
        >
          {t.halalSub}
        </p>
      </div>

      {/* Search Input Bar - Neutral White */}
      <div
        data-widget-card
        className="glass flex items-center gap-2 p-2 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800"
      >
        <Search className="ml-1 size-4 text-muted-foreground" />
        <Input
          value={query}
          maxLength={60}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runName()}
          placeholder={t.searchPlaceholder}
          className="border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <Button variant="widget" size="icon-lg" onClick={runName} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
        </Button>
      </div>

      {/* Widget Scanner Caméra Plein Écran - Thème et Bordures dynamiques des paramètres */}
      <button
        type="button"
        data-widget-card
        onClick={() => togglePanel("scanner")}
        className={`widget w-full text-left relative rounded-3xl p-5 shadow-md border border-white/20 transition-all duration-500 ease-in-out cursor-pointer active:scale-[0.98] select-none group overflow-hidden ${
          activeWidgetTheme.animClass || ""
        }`}
        style={{
          background:
            activeWidgetTheme.gradient ||
            `linear-gradient(135deg, ${activeWidgetTheme.from}, ${activeWidgetTheme.to})`,
          color: activeWidgetTheme.fg,
        }}
      >
        <div className="relative z-10 flex items-center justify-between gap-4">
          <div className="space-y-1.5 flex-1 min-w-0">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md border border-white/25 text-[11px] font-bold tracking-wide uppercase shadow-xs">
              <Zap className="size-3.5 fill-current shrink-0" />
              <span className="truncate">SCANNER CAMÉRA PLEIN ÉCRAN</span>
            </div>
            <h2
              className="text-xl font-bold font-display tracking-tight leading-tight"
              style={{ color: activeWidgetTheme.fg }}
            >
              Ouvrir le Scanner
            </h2>
            <p
              className="text-xs leading-relaxed max-w-[280px] opacity-90"
              style={{ color: activeWidgetTheme.fg }}
            >
              Pointez la caméra vers n'importe quel code-barres : détection ultra-rapide en 1 seconde.
            </p>
          </div>

          <div className="size-16 sm:size-18 rounded-2xl sm:rounded-3xl bg-white text-slate-900 flex items-center justify-center shrink-0 shadow-lg shadow-black/15 group-hover:scale-105 transition-transform duration-200">
            <ScanLine className="size-8 text-slate-800" strokeWidth={2.2} />
          </div>
        </div>
      </button>

      {/* Action Widgets Container - Neutral White (Does NOT inherit Halal Title theme color) */}
      <div
        data-widget-card
        className="relative rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-4 shadow-sm text-slate-900 dark:text-slate-100 overflow-hidden"
      >
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          <ActionTile
            label={t.photoIngredients}
            sublabel={t.ingredientsAI}
            disabled={analysing}
            onClick={() => setIsIngredientCameraOpen(true)}
            icon={
              analysing ? (
                <Loader2 className="size-6 text-sky-600 dark:text-sky-400 animate-spin" />
              ) : (
                <span className="relative grid place-items-center">
                  <Camera className="size-7" strokeWidth={1.9} />
                  <Sparkles className="absolute -right-1.5 -bottom-1.5 size-3.5 fill-current text-sky-500 dark:text-sky-400" />
                </span>
              )
            }
          />
          <ActionTile
            label={t.manual}
            active={activePanel === "manual"}
            onClick={() => togglePanel("manual")}
            icon={
              <span className="relative grid place-items-center">
                <Barcode className="size-7" strokeWidth={1.9} />
                <Pencil className="absolute -right-2 -bottom-2 size-4" strokeWidth={2.4} />
              </span>
            }
          />
          <ActionTile
            label={t.barcodePhoto || "Code-barres photo"}
            disabled={busy}
            onClick={() => galleryInputRef.current?.click()}
            icon={
              busy ? (
                <Loader2 className="size-6 text-emerald-600 dark:text-emerald-400 animate-spin" />
              ) : (
                <Images className="size-7" strokeWidth={1.9} />
              )
            }
          />
          <ActionTile
            label={t.savedProducts}
            active={activePanel === "saved"}
            onClick={() => togglePanel("saved")}
            icon={
              <span className="relative grid place-items-center">
                <Folder className="size-7" strokeWidth={1.9} />
                <Star className="absolute mt-1 size-3 fill-current" strokeWidth={0} />
              </span>
            }
          />
        </div>
      </div>

      {/* Feature Guide Hint: Photo des ingrédients (Halal / Haram) */}
      <HalalIngredientsHint onTakePhoto={() => setIsIngredientCameraOpen(true)} />

      {/* Fullscreen Camera Scanner Overlay (100% full screen window) */}
      {activePanel === "scanner" && (
        <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col justify-between overflow-hidden overscroll-contain animate-in fade-in duration-200">
          {camDenied ? (
            <div className="flex-1 p-6 flex items-center justify-center">
              <PermissionBanner
                side="left"
                message={t.cameraDenied}
                actionLabel={t.allow}
                onDismiss={() => setCamDenied(false)}
                onRetry={() => {
                  setCamDenied(false);
                  startScan();
                }}
              />
            </div>
          ) : (
            <div className="relative w-full h-full flex-1 flex flex-col justify-between overflow-hidden">
              {/* Top Control Bar */}
              <div className="relative z-30 p-4 sm:p-5 bg-gradient-to-b from-black/90 via-black/60 to-transparent flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="size-11 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/30">
                    <ScanLine className="size-6" strokeWidth={2.5} />
                  </div>
                  <div className="text-white min-w-0">
                    <h3 className="text-base font-bold leading-tight font-display tracking-tight text-white drop-shadow-sm truncate">
                      Scanner ultra-rapide
                    </h3>
                    <p className="text-xs text-emerald-300/90 font-medium truncate">
                      Pointez vers n'importe quel code-barres
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={toggleTorch}
                    title="Activer le Flash"
                    className={`size-10 rounded-full flex items-center justify-center backdrop-blur-md transition-all cursor-pointer ${
                      torchOn
                        ? "bg-amber-400 text-slate-950 shadow-lg shadow-amber-400/40 scale-105"
                        : "bg-white/15 hover:bg-white/25 text-white border border-white/20"
                    }`}
                  >
                    <Flashlight className="size-5" />
                  </button>

                  <button
                    type="button"
                    onClick={toggleCamera}
                    title="Changer de caméra"
                    className="size-10 rounded-full bg-white/15 hover:bg-white/25 text-white backdrop-blur-md border border-white/20 flex items-center justify-center transition active:scale-95 cursor-pointer"
                  >
                    <RotateCw className="size-5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      stopScan();
                      togglePanel(null);
                    }}
                    title="Fermer"
                    className="size-10 rounded-full bg-white/15 hover:bg-white/25 text-white backdrop-blur-md border border-white/20 flex items-center justify-center transition active:scale-95 cursor-pointer"
                  >
                    <X className="size-6" />
                  </button>
                </div>
              </div>

              {/* Fullscreen Camera Video Feed */}
              <div
                id="halal-barcode-reader"
                className="absolute inset-0 w-full h-full object-cover bg-slate-950 [&_img]:hidden [&_img]:!opacity-0 [&>video]:w-full [&>video]:h-full [&>video]:object-cover"
              />

              {/* Viseur plein écran repensé : coins aux bords, anneau pulsé, laser animé */}
              <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
                {/* Vignettage doux pour la profondeur */}
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(2,6,23,0.6)_100%)]" />

                {/* Grille de scan subtile */}
                <div
                  className="absolute inset-0 opacity-[0.12]"
                  style={{
                    backgroundImage:
                      "linear-gradient(rgba(16,185,129,0.55) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,0.55) 1px, transparent 1px)",
                    backgroundSize: "44px 44px",
                  }}
                />

                {/* Coins lumineux aux 4 bords de l'écran */}
                <div className="absolute top-4 left-4 h-16 w-16 sm:h-20 sm:w-20 rounded-tl-3xl border-t-[6px] border-l-[6px] border-emerald-400/90 shadow-[0_0_30px_rgba(16,185,129,0.8)]" />
                <div className="absolute top-4 right-4 h-16 w-16 sm:h-20 sm:w-20 rounded-tr-3xl border-t-[6px] border-r-[6px] border-emerald-400/90 shadow-[0_0_30px_rgba(16,185,129,0.8)]" />
                <div className="absolute bottom-4 left-4 h-16 w-16 sm:h-20 sm:w-20 rounded-bl-3xl border-b-[6px] border-l-[6px] border-emerald-400/90 shadow-[0_0_30px_rgba(16,185,129,0.8)]" />
                <div className="absolute bottom-4 right-4 h-16 w-16 sm:h-20 sm:w-20 rounded-br-3xl border-b-[6px] border-r-[6px] border-emerald-400/90 shadow-[0_0_30px_rgba(16,185,129,0.8)]" />

                {/* Badge SCAN AUTO ACTIF */}
                <div className="absolute top-[20%] inset-x-0 flex items-center justify-center">
                  <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] font-extrabold tracking-widest uppercase text-emerald-300 bg-slate-950/70 backdrop-blur-md border border-emerald-400/50 shadow-lg shadow-emerald-500/20 animate-pulse">
                    <span className="relative flex size-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full size-2.5 bg-emerald-500" />
                    </span>
                    Scan auto actif
                  </span>
                </div>

                {/* Anneau central pulsé avec réticule */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="relative size-44 sm:size-52 rounded-full border-2 border-emerald-400/40 animate-pulse shadow-[0_0_60px_rgba(16,185,129,0.35)] flex items-center justify-center">
                    <div className="absolute left-4 right-4 h-px bg-gradient-to-r from-transparent via-emerald-400/70 to-transparent" />
                    <div className="absolute top-4 bottom-4 w-px bg-gradient-to-b from-transparent via-emerald-400/70 to-transparent" />
                    <div className="size-24 sm:size-28 rounded-full border border-emerald-300/30 flex items-center justify-center">
                      <div className="size-3 rounded-full bg-emerald-400 shadow-[0_0_16px_#34d399]" />
                    </div>
                  </div>
                </div>

                {/* Faisceau laser vertical continu pleine largeur */}
                <div className="absolute left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_28px_#34d399] animate-laser-scan" />

                {/* Texte d'instruction en bas */}
                <div className="absolute bottom-[16%] inset-x-0 flex items-center justify-center px-6">
                  <p className="text-xs sm:text-sm font-semibold text-white/95 text-center bg-slate-950/75 backdrop-blur-md px-5 py-2.5 rounded-full border border-emerald-400/30 shadow-lg">
                    Placez le code-barres au centre du cadre
                  </p>
                </div>
              </div>

              {/* Bottom bar helper */}
              <div className="relative z-30 p-4 bg-gradient-to-t from-black/90 via-black/50 to-transparent text-center">
                <p className="text-xs text-emerald-300/90 font-medium">
                  {t.scannerHint || "Pointez la caméra vers un code-barres pour le scanner automatiquement"}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Accordion Content Panel (For manual input, saved products) */}
      {activePanel && activePanel !== "scanner" && (
        <section className="glass p-4 rounded-3xl border border-emerald-500/30 shadow-md animate-in slide-in-from-top-3 fade-in duration-200">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-border/50">
            <h3 className="text-xs font-extrabold text-foreground uppercase tracking-wider">
              {activePanel === "manual" && t.panelManual}
              {activePanel === "saved" && t.panelSaved}
            </h3>
            <button
              type="button"
              onClick={() => togglePanel(null)}
              aria-label={t.close || "Fermer"}
              className="grid size-7 place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition active:scale-90 cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* 2. Saisir manuellement */}
          {activePanel === "manual" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">{t.manualHint}</p>
              <div className="flex gap-2">
                <Input
                  inputMode="numeric"
                  maxLength={14}
                  value={manualInputCode}
                  onChange={(e) => setManualInputCode(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && manualInputCode.length >= 6) {
                      void runCode(manualInputCode);
                      togglePanel(null);
                    }
                  }}
                  placeholder="3017620422003"
                  className="font-mono text-sm"
                />
                <Button
                  variant="widget"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shrink-0 cursor-pointer"
                  onClick={() => {
                    if (manualInputCode.length < 6)
                      return appToast.error(t.codeTooShort || "Barcode must be at least 6 digits", {
                        category: "scanner",
                      });
                    void runCode(manualInputCode);
                    togglePanel(null);
                  }}
                >
                  <Search className="size-3.5 mr-1" />
                  {t.searchBtn}
                </Button>
              </div>
            </div>
          )}

          {/* 4. Produits Sauvegardés */}
          {activePanel === "saved" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-foreground">
                <span>{t.favoritesList}</span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {settings.savedProducts.length} {t.itemsSaved}
                </span>
              </div>
              {!settings.savedProducts.length && (
                <p className="text-xs text-center text-muted-foreground py-4 italic">
                  {t.noSavedProducts}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* Hidden element for gallery file barcode scanning */}
      <div id="halal-barcode-reader-hidden" className="hidden" />

      {/* Hidden file input for Barcode Photo Scan */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) {
            void fromGallery(e.target.files[0]);
            e.target.value = "";
          }
        }}
      />

      {/* In-App Direct Camera Viewfinder for Ingredient Analysis */}
      <IngredientCameraModal
        isOpen={isIngredientCameraOpen}
        onClose={() => setIsIngredientCameraOpen(false)}
        onCapture={handleCaptureIngredientPhoto}
      />

      {/* Active AI Analysis In-Progress Indicator */}
      {analysing && (
        <section className="glass rounded-3xl p-4 border border-sky-500/30 bg-sky-500/10 dark:bg-sky-950/30 shadow-md flex items-center gap-3.5 animate-pulse">
          <div className="size-11 rounded-2xl bg-sky-500/20 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
            <Loader2 className="size-6 animate-spin" />
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Analyse IA des ingrédients en cours...
            </h4>
            <p className="text-xs text-muted-foreground">
              Détection des dérivés, E-numbers et statut halal/haram sans rechargement.
            </p>
          </div>
        </section>
      )}

      {notFound && !showSaved && (
        <section className="glass rounded-3xl p-5 sm:p-6 border-2 border-amber-500/40 bg-gradient-to-b from-amber-500/10 via-slate-900/40 to-amber-950/20 shadow-xl anim-pop space-y-4">
          <div className="flex items-start gap-4">
            <div className="size-13 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-500 flex items-center justify-center shrink-0 shadow-inner">
              <PackageSearch className="size-7" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                <AlertCircle className="size-3" />
                Informations insuffisantes / Non répertorié
              </div>
              <h3 className="text-lg font-extrabold text-foreground tracking-tight">
                PRODUIT NON TROUVÉ
              </h3>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed">
            Ce produit n'a pas été trouvé dans notre base de données. Faites défiler vers le bas pour analyser les ingrédients.
          </p>

          <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              disabled={analysing}
              onClick={() => setIsIngredientCameraOpen(true)}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl px-4 py-4 text-center transition-all duration-200 active:scale-[0.98] bg-slate-100/90 dark:bg-slate-800/90 hover:bg-slate-200/90 dark:hover:bg-slate-700/90 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700/80 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span className="grid size-12 place-items-center rounded-full bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 shadow-sm border border-slate-200/60 dark:border-slate-600">
                {analysing ? (
                  <Loader2 className="size-6 text-emerald-600 dark:text-emerald-400 animate-spin" />
                ) : (
                  <span className="relative grid place-items-center">
                    <Camera className="size-6" strokeWidth={2} />
                    <Sparkles className="absolute -right-1.5 -bottom-1.5 size-3.5 fill-current text-amber-500" />
                  </span>
                )}
              </span>
              <span className="text-xs sm:text-sm font-bold leading-tight">
                {analysing ? t.analysing : "Analyser les ingrédients"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => togglePanel("manual")}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl px-4 py-4 text-center transition-all duration-200 active:scale-[0.98] bg-slate-100/90 dark:bg-slate-800/90 hover:bg-slate-200/90 dark:hover:bg-slate-700/90 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700/80 shadow-sm"
            >
              <span className="grid size-12 place-items-center rounded-full bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 shadow-sm border border-slate-200/60 dark:border-slate-600">
                <span className="relative grid place-items-center">
                  <Barcode className="size-6" strokeWidth={2} />
                  <Pencil className="absolute -right-1.5 -bottom-1.5 size-3.5" strokeWidth={2.4} />
                </span>
              </span>
              <span className="text-xs sm:text-sm font-bold leading-tight">
                Saisie manuelle
              </span>
            </button>
          </div>
        </section>
      )}

      <div className="space-y-3">
        {list.map((p) => (
          <article key={p.code + p.name} className="glass p-4">
            <div className="flex gap-3">
              {p.image && <img src={p.image} alt="" className="size-16 rounded-xl object-cover" />}
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-bold">{p.name}</h2>
                <p className="truncate text-[11px] text-muted-foreground">{p.brand}</p>
                <VerdictBadge verdict={p.verdict} />
              </div>
            </div>
            {"reasons" in p && p.reasons && p.reasons.length > 0 && (
              <ul className="mt-2.5 space-y-1.5 text-[11px] rounded-xl p-2.5 bg-slate-100/60 dark:bg-slate-800/60 border border-slate-200/50 dark:border-slate-700/50">
                {p.reasons.map((r, i) => {
                  const isHaramReason = r.toLowerCase().includes("interdit");
                  const isDoubtReason = r.toLowerCase().includes("vérification") || r.toLowerCase().includes("indisponible");
                  const isHalalReason = r.toLowerCase().includes("aucun") || r.toLowerCase().includes("certifi");

                  return (
                    <li
                      key={i}
                      className={`flex items-start gap-1.5 leading-relaxed font-medium ${
                        isHaramReason
                          ? "text-rose-600 dark:text-rose-400 font-semibold"
                          : isDoubtReason
                            ? "text-amber-600 dark:text-amber-400"
                            : isHalalReason
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-muted-foreground"
                      }`}
                    >
                      <span className="shrink-0">•</span>
                      <span>{r}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-[10px] text-muted-foreground">
              {t.source}: Open Food Facts {p.certified ? "· certification halal déclarée" : ""} —{" "}
              {t.disclaimer}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                variant="soft"
                size="sm"
                onClick={() => {
                  const exists = settings.savedProducts.some((s) => s.code === p.code);
                  update({
                    savedProducts: exists
                      ? settings.savedProducts.filter((s) => s.code !== p.code)
                      : [
                          ...settings.savedProducts,
                          {
                            code: p.code,
                            name: p.name,
                            brand: p.brand,
                            verdict: p.verdict,
                            image: p.image,
                          },
                        ],
                  });
                  appToast.success(
                    exists ? t.removedFromFavorites || t.remove : t.addedToFavorites || t.saved,
                    { category: "scanner" },
                  );
                }}
              >
                {settings.savedProducts.some((s) => s.code === p.code) ? t.remove : t.save}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  appToast.success(
                    t.reportSentThanks || "Report submitted, thank you for your help!",
                    { category: "scanner" },
                  )
                }
              >
                {t.report}
              </Button>
            </div>
          </article>
        ))}
      </div>

      <section id="guide-section" className="widget p-4">
        <h2 className="text-sm font-bold">{t.howTitle}</h2>
        <div className="mt-3 space-y-3">
          {getHalalGuide(locale).map((b) => (
            <div key={b.title}>
              <h3 className="text-xs font-bold">{b.title}</h3>
              <ul className="mt-1 space-y-0.5 text-[11px] opacity-90">
                {b.lines.map((l) => (
                  <li key={l}>• {l}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Fullscreen Verdict Animation Overlay on Product Detect */}
      {verdictOverlay && (
        <VerdictAnimationOverlay
          product={verdictOverlay}
          onClose={() => setVerdictOverlay(null)}
        />
      )}
    </div>
  );
}

function VerdictAnimationOverlay({
  product,
  onClose,
}: {
  product: ProductResult;
  onClose: () => void;
}) {
  const isHalal = product.verdict === "halal";
  const isHaram = product.verdict === "haram";
  const isDoubtful = product.verdict === "doubtful";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-xl animate-in fade-in duration-300">
      {/* Background radial glow */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-700 ${
          isHalal
            ? "bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.35)_0%,transparent_70%)]"
            : isHaram
              ? "bg-[radial-gradient(circle_at_center,rgba(244,63,94,0.35)_0%,transparent_70%)]"
              : "bg-[radial-gradient(circle_at_center,rgba(245,158,11,0.35)_0%,transparent_70%)]"
        }`}
      />

      {/* Main Verdict Card */}
      <div
        className={`relative w-full max-w-md rounded-3xl p-6 sm:p-8 text-center text-white shadow-2xl border backdrop-blur-2xl transition-all duration-300 animate-in zoom-in-95 ${
          isHalal
            ? "bg-gradient-to-b from-emerald-950/95 via-slate-950 to-emerald-950/95 border-emerald-500/50 shadow-emerald-500/20"
            : isHaram
              ? "bg-gradient-to-b from-rose-950/95 via-slate-950 to-rose-950/95 border-rose-500/50 shadow-rose-500/20"
              : "bg-gradient-to-b from-amber-950/95 via-slate-950 to-amber-950/95 border-amber-500/50 shadow-amber-500/20"
        }`}
      >
        {/* Top Close X */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 size-9 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white flex items-center justify-center transition cursor-pointer"
        >
          <X className="size-5" />
        </button>

        {/* Giant Animated Badge */}
        <div className="relative mx-auto my-3 size-24 sm:size-28 flex items-center justify-center">
          {/* Ripple rings */}
          <div
            className={`absolute inset-0 rounded-full animate-ping opacity-40 ${
              isHalal ? "bg-emerald-500" : isHaram ? "bg-rose-500" : "bg-amber-500"
            }`}
          />
          <div
            className={`absolute inset-2 rounded-full animate-pulse opacity-60 ${
              isHalal ? "bg-emerald-400" : isHaram ? "bg-rose-400" : "bg-amber-400"
            }`}
          />

          {/* Core Icon Box */}
          <div
            className={`relative size-20 sm:size-24 rounded-full flex items-center justify-center shadow-xl border-2 ${
              isHalal
                ? "bg-emerald-500 text-slate-950 border-emerald-300 shadow-emerald-500/50"
                : isHaram
                  ? "bg-rose-600 text-white border-rose-300 shadow-rose-600/50"
                  : "bg-amber-500 text-slate-950 border-amber-300 shadow-amber-500/50"
            }`}
          >
            {isHalal && <ShieldCheck className="size-12 sm:size-14" strokeWidth={2.3} />}
            {isHaram && <XCircle className="size-12 sm:size-14" strokeWidth={2.3} />}
            {isDoubtful && <AlertTriangle className="size-12 sm:size-14" strokeWidth={2.3} />}
            {!isHalal && !isHaram && !isDoubtful && (
              <HelpCircle className="size-12 sm:size-14" strokeWidth={2.3} />
            )}
          </div>
        </div>

        {/* Verdict Title & Subtitle */}
        <div className="space-y-1.5 mt-4">
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider ${
              isHalal
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                : isHaram
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                  : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
            }`}
          >
            {isHalal && <Sparkles className="size-3.5" />}
            <span>
              {isHalal && "PRODUIT HALAL (CONFORME)"}
              {isHaram && "PRODUIT HARAM (NON CONFORME)"}
              {!isHalal && !isHaram && "VÉRIFICATION NÉCESSAIRE (À VÉRIFIER)"}
            </span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-black font-display tracking-tight text-white leading-tight">
            {product.name}
          </h2>
          {product.brand && <p className="text-sm font-medium text-white/70">{product.brand}</p>}
        </div>

        {/* Reasons list if available */}
        {product.reasons && product.reasons.length > 0 && (
          <div className="mt-4 p-3.5 rounded-2xl bg-white/10 border border-white/15 text-left space-y-2 text-xs text-white/90 max-h-40 overflow-y-auto">
            {product.reasons.map((r, i) => (
              <p key={i} className="flex items-start gap-2 leading-relaxed">
                <span
                  className={`font-bold shrink-0 text-sm leading-none mt-0.5 ${
                    isHaram ? "text-rose-400" : isHalal ? "text-emerald-400" : "text-amber-400"
                  }`}
                >
                  •
                </span>
                <span
                  className={
                    r.toLowerCase().includes("interdit")
                      ? "font-semibold text-rose-200"
                      : r.toLowerCase().includes("vérification")
                        ? "text-amber-200"
                        : "text-white/90"
                  }
                >
                  {r}
                </span>
              </p>
            ))}
          </div>
        )}

        {/* Action button */}
        <div className="mt-6 flex gap-3">
          <Button
            variant="widget"
            onClick={onClose}
            className={`w-full py-6 rounded-2xl font-bold text-sm shadow-lg transition-transform active:scale-95 cursor-pointer ${
              isHalal
                ? "bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black shadow-emerald-500/30"
                : isHaram
                  ? "bg-rose-600 hover:bg-rose-500 text-white font-black shadow-rose-600/30"
                  : "bg-amber-500 hover:bg-amber-400 text-slate-950 font-black shadow-amber-500/30"
            }`}
          >
            Voir la fiche produit
          </Button>
        </div>
      </div>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: ProductResult["verdict"] }) {
  const { t } = useI18n();
  const map = {
    halal: { label: t.verdictHalal, color: "var(--halal)" },
    haram: { label: t.verdictHaram, color: "var(--haram)" },
    doubtful: { label: t.verdictDoubt, color: "var(--doubt)" },
    unknown: { label: t.verdictUnknown, color: "var(--muted-foreground)" },
  }[verdict];

  return (
    <span
      className="mt-1 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white"
      style={{ backgroundColor: map.color }}
    >
      {map.label}
    </span>
  );
}

/** Big rounded action tile with a round pictogram badge on top. */
function ActionTile({
  label,
  sublabel,
  icon,
  active = false,
  onClick,
  disabled = false,
  as = "button",
  children,
}: {
  label: string;
  sublabel?: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  as?: "button" | "label";
  children?: React.ReactNode;
}) {
  const baseCls =
    "flex cursor-pointer flex-col items-center justify-start gap-1.5 sm:gap-2 rounded-2xl px-2.5 py-3 sm:px-3 sm:py-3.5 text-center transition-all duration-300 active:scale-[0.98]";

  const colorCls = active
    ? "bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-600"
    : "bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700/80";

  const badgeCls = active
    ? "bg-white/20 text-white"
    : "bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 shadow-2xs border border-slate-200/60 dark:border-slate-600";

  const cls = `${baseCls} ${colorCls} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`;

  const inner = (
    <>
      <span className={`grid size-14 place-items-center rounded-full ${badgeCls}`}>{icon}</span>
      <span className="text-[12.5px] leading-tight font-semibold">{label}</span>
      {sublabel && (
        <span
          className={`text-[10.5px] leading-tight -mt-0.5 ${
            active ? "text-emerald-100" : "text-muted-foreground"
          }`}
        >
          {sublabel}
        </span>
      )}
      {children}
    </>
  );

  if (as === "label") {
    return (
      <label data-widget-card className={cls}>
        {inner}
      </label>
    );
  }

  return (
    <button
      data-widget-card
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cls}
    >
      {inner}
    </button>
  );
}
