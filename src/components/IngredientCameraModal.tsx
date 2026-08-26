import { useEffect, useRef, useState, useCallback } from "react";
import { X, Flashlight, RotateCw, Camera, AlertCircle, Sparkles, Loader2, Focus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import {
  findBestRearCamera,
  getOptimalCameraStream,
  optimizeTrackForReading,
  setTrackZoom,
  triggerRefocus,
  captureHighResPhoto,
  type CameraCapabilitiesInfo,
} from "@/lib/camera-utils";

interface IngredientCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (imageDataUrl: string) => void;
}

export function IngredientCameraModal({
  isOpen,
  onClose,
  onCapture,
}: IngredientCameraModalProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraCaps, setCameraCaps] = useState<CameraCapabilitiesInfo | null>(null);
  const [activeZoom, setActiveZoom] = useState<number>(1);
  const [focusRing, setFocusRing] = useState<{ x: number; y: number; visible: boolean } | null>(null);

  // Stop all media stream tracks cleanly
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {
            // ignore
          }
        });
      } catch {
        // ignore
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setTorchOn(false);
    setTorchAvailable(false);
    setCameraCaps(null);
    setFocusRing(null);
  }, []);

  // Initialize camera with best device selection and high resolution
  const startCamera = useCallback(async () => {
    stopStream();
    setIsInitializing(true);
    setError(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("La caméra n'est pas supportée par votre navigateur.");
      setIsInitializing(false);
      return;
    }

    try {
      let targetDeviceId: string | undefined;

      // When in environment mode, find the primary rear camera (avoiding ultra-wide / macro / front)
      if (facingMode === "environment") {
        const bestRear = await findBestRearCamera();
        if (bestRear?.deviceId) {
          targetDeviceId = bestRear.deviceId;
        }
      }

      // Acquire stream using high-res multi-tier negotiation
      const stream = await getOptimalCameraStream({
        facingMode,
        preferHighRes: true,
        deviceId: targetDeviceId,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const track = stream.getVideoTracks()[0];
      if (track) {
        // Apply continuous focus, auto-exposure, and retrieve capabilities
        const caps = await optimizeTrackForReading(track);
        setCameraCaps(caps);
        setTorchAvailable(caps.torchSupported);
        setActiveZoom(caps.currentZoom || 1);
      }

      setIsInitializing(false);
    } catch (err: unknown) {
      console.warn("Camera start error:", err);
      const str = String(err).toLowerCase();
      if (str.includes("permission") || str.includes("denied") || str.includes("notallowed")) {
        setError("Accès caméra refusé. Veuillez autoriser l'accès à la caméra dans vos réglages.");
      } else {
        setError("Impossible d'accéder à la caméra arrière. Réessayez.");
      }
      setIsInitializing(false);
    }
  }, [facingMode, stopStream]);

  useEffect(() => {
    if (isOpen) {
      void startCamera();
    } else {
      stopStream();
    }
    return () => {
      stopStream();
    };
  }, [isOpen, startCamera, stopStream]);

  // Toggle torch / flash
  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    try {
      const nextState = !torchOn;
      await (track as MediaStreamTrack & {
        applyConstraints: (c: MediaTrackConstraints) => Promise<void>;
      }).applyConstraints({
        advanced: [{ torch: nextState }] as unknown as MediaTrackConstraints[],
      });
      setTorchOn(nextState);
    } catch {
      setTorchAvailable(false);
    }
  };

  // Flip camera between environment and user
  const flipCamera = () => {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  };

  // Handle zoom change
  const handleZoomChange = async (targetZoom: number) => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    const ok = await setTrackZoom(track, targetZoom);
    if (ok) {
      setActiveZoom(targetZoom);
    }
  };

  // Handle tap-to-focus on viewfinder
  const handleViewfinderTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isInitializing || error || !streamRef.current) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setFocusRing({ x, y, visible: true });

    const track = streamRef.current.getVideoTracks()[0];
    if (track) {
      void triggerRefocus(track);
    }

    setTimeout(() => {
      setFocusRing((prev) => (prev ? { ...prev, visible: false } : null));
    }, 800);
  };

  // Capture frame in highest possible resolution
  const handleCapture = async () => {
    if (!videoRef.current || isCapturing) return;

    setIsCapturing(true);

    // Haptic feedback
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      try {
        navigator.vibrate(60);
      } catch {
        // ignore
      }
    }

    try {
      const track = streamRef.current ? streamRef.current.getVideoTracks()[0] : null;
      // High-resolution hardware capture via ImageCapture API with canvas fallback
      const highResDataUrl = await captureHighResPhoto(videoRef.current, track, facingMode);

      // Stop camera tracks immediately
      stopStream();

      // Send to callback
      onCapture(highResDataUrl);
      onClose();
    } catch (err) {
      console.error("Frame capture error:", err);
      setIsCapturing(false);
    }
  };

  if (!isOpen) return null;

  // Compute available zoom pills if supported
  const zoomOptions =
    cameraCaps?.zoomSupported && cameraCaps.maxZoom > 1
      ? [1, 1.5, 2, 3]
          .filter((z) => z <= cameraCaps.maxZoom && z >= cameraCaps.minZoom)
          .concat(
            // include max if not in list and <= 4
            cameraCaps.maxZoom > 2 && cameraCaps.maxZoom <= 4 && ![1, 1.5, 2, 3].includes(cameraCaps.maxZoom)
              ? [cameraCaps.maxZoom]
              : [],
          )
      : [];

  return (
    <div
      id="ingredient-camera-viewfinder"
      className="fixed inset-0 z-50 flex flex-col justify-between bg-black text-white select-none overflow-hidden"
    >
      {/* Top action bar */}
      <div className="relative z-20 flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))] bg-gradient-to-b from-black/80 via-black/40 to-transparent">
        <button
          type="button"
          onClick={() => {
            stopStream();
            onClose();
          }}
          className="flex size-11 items-center justify-center rounded-full bg-black/50 backdrop-blur-md text-white border border-white/20 hover:bg-black/70 active:scale-95 transition cursor-pointer"
          aria-label="Fermer la caméra"
        >
          <X className="size-6" />
        </button>

        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-xs font-semibold text-white/90 shadow-md">
          <Sparkles className="size-4 text-sky-400 animate-pulse" />
          <span>{t.photoIngredients || "Photographier les ingrédients"}</span>
        </div>

        <div className="flex items-center gap-2">
          {torchAvailable && (
            <button
              type="button"
              onClick={toggleTorch}
              className={`flex size-11 items-center justify-center rounded-full backdrop-blur-md border transition active:scale-95 cursor-pointer ${
                torchOn
                  ? "bg-amber-500 text-black border-amber-400 shadow-md shadow-amber-500/30"
                  : "bg-black/50 text-white border-white/20 hover:bg-black/70"
              }`}
              aria-label="Torche"
            >
              <Flashlight className="size-5" />
            </button>
          )}

          <button
            type="button"
            onClick={flipCamera}
            className="flex size-11 items-center justify-center rounded-full bg-black/50 backdrop-blur-md text-white border border-white/20 hover:bg-black/70 active:scale-95 transition cursor-pointer"
            aria-label="Changer de caméra"
          >
            <RotateCw className="size-5" />
          </button>
        </div>
      </div>

      {/* Main Viewfinder Area */}
      <div
        className="relative flex-1 flex items-center justify-center overflow-hidden cursor-crosshair"
        onClick={handleViewfinderTap}
      >
        {/* Live video with maximum sharpness */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover"
        />

        {/* Shutter flash animation when taking picture */}
        {isCapturing && <div className="absolute inset-0 bg-white z-30 animate-out fade-out duration-300" />}

        {/* Tap-to-focus ring animation */}
        {focusRing?.visible && (
          <div
            className="absolute z-30 pointer-events-none -translate-x-1/2 -translate-y-1/2 flex items-center justify-center animate-in zoom-in-50 duration-200"
            style={{ left: `${focusRing.x}px`, top: `${focusRing.y}px` }}
          >
            <div className="size-16 rounded-xl border-2 border-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.8)] animate-pulse flex items-center justify-center">
              <Focus className="size-6 text-emerald-300 opacity-80" />
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {isInitializing && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/75 p-6 text-center">
            <Loader2 className="size-10 text-emerald-400 animate-spin mb-3" />
            <p className="text-sm font-medium text-white/90">Optimisation de la caméra haute résolution...</p>
          </div>
        )}

        {/* Error overlay */}
        {error && !isInitializing && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/90 p-6 text-center space-y-4">
            <div className="size-14 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center border border-red-500/30">
              <AlertCircle className="size-8" />
            </div>
            <div className="max-w-xs space-y-1">
              <h4 className="text-base font-bold text-white">Accès caméra</h4>
              <p className="text-xs text-white/70">{error}</p>
            </div>
            <Button
              variant="default"
              size="sm"
              onClick={startCamera}
              className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-full px-5"
            >
              <RotateCw className="size-4 mr-2" />
              Réessayer
            </Button>
          </div>
        )}

        {/* Framing Guides Overlay */}
        {!error && !isInitializing && (
          <div className="pointer-events-none relative z-10 flex flex-col items-center w-full px-6">
            <div className="relative w-full max-w-xs sm:max-w-sm aspect-[4/3] rounded-2xl border-2 border-dashed border-white/60 bg-transparent flex flex-col justify-between p-3">
              {/* Corner markers */}
              <div className="absolute -top-1 -left-1 size-5 border-t-4 border-l-4 border-emerald-400 rounded-tl-lg shadow-[0_0_8px_#34d399]" />
              <div className="absolute -top-1 -right-1 size-5 border-t-4 border-r-4 border-emerald-400 rounded-tr-lg shadow-[0_0_8px_#34d399]" />
              <div className="absolute -bottom-1 -left-1 size-5 border-b-4 border-l-4 border-emerald-400 rounded-bl-lg shadow-[0_0_8px_#34d399]" />
              <div className="absolute -bottom-1 -right-1 size-5 border-b-4 border-r-4 border-emerald-400 rounded-br-lg shadow-[0_0_8px_#34d399]" />

              <div className="text-center w-full">
                <span className="inline-block px-3 py-1 rounded-full bg-black/65 backdrop-blur-md text-[11px] font-semibold text-emerald-300 border border-emerald-400/40 shadow-xs">
                  Cadrez la liste des ingrédients
                </span>
              </div>

              <div className="text-center w-full">
                <span className="text-[10px] text-white/80 drop-shadow-md">
                  Texte net et bien éclairé pour l'analyse IA
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Shutter Controls with Smart Zoom Selector */}
      <div className="relative z-20 flex flex-col items-center justify-center p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/90 via-black/50 to-transparent">
        {/* Smart Zoom Selector Pills if device supports hardware zoom */}
        {zoomOptions.length > 1 && !isInitializing && !error && (
          <div className="flex items-center gap-1.5 p-1 rounded-full bg-black/60 backdrop-blur-md border border-white/20 mb-4 shadow-lg animate-in fade-in duration-200">
            {zoomOptions.map((z) => (
              <button
                key={z}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleZoomChange(z);
                }}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer ${
                  Math.abs(activeZoom - z) < 0.1
                    ? "bg-emerald-500 text-slate-950 shadow-md scale-105"
                    : "text-white/80 hover:text-white hover:bg-white/10"
                }`}
              >
                {z}x
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleCapture();
          }}
          disabled={isInitializing || !!error || isCapturing}
          className="group relative flex size-20 items-center justify-center rounded-full bg-white/20 p-1.5 transition-all duration-200 active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          aria-label="Prendre la photo des ingrédients"
        >
          <div className="size-full rounded-full bg-white group-hover:scale-105 transition flex items-center justify-center shadow-lg shadow-white/20">
            <Camera className="size-7 text-slate-900 group-hover:scale-110 transition" />
          </div>
        </button>
        <span className="text-[11.5px] font-medium text-white/80 mt-3 drop-shadow-xs">
          Appuyez pour analyser les ingrédients
        </span>
      </div>
    </div>
  );
}
