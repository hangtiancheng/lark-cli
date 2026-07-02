"use client";
interface LoadingOverlayProps {
  overlay: { show: boolean; text: string; subtext: string };
}

export default function LoadingOverlay({ overlay }: LoadingOverlayProps) {
  if (!overlay.show) return null;
  return (
    <div className="fixed inset-0 z-9999 flex items-center justify-center bg-black/70 backdrop-blur">
      <div className="rounded-2xl bg-white/95 px-12 py-10 text-center shadow-2xl">
        <div className="mx-auto mb-5 h-12 w-12 animate-spin rounded-full border-4 border-sky-200 border-t-sky-500" />
        <div className="text-lg font-semibold text-sky-600">{overlay.text}</div>
        <div className="mt-2 text-sm text-zinc-600">{overlay.subtext}</div>
      </div>
    </div>
  );
}
