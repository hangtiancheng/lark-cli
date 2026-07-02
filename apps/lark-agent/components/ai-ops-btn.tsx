"use client";
interface AIOpsButtonProps {
  onClick: () => void;
  disabled: boolean;
}

export default function AIOpsBtn({ onClick, disabled }: AIOpsButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-full bg-orange-500 px-4 py-2 text-sm font-medium text-white shadow-md transition hover:bg-orange-600 disabled:opacity-50"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>AI Ops</span>
    </button>
  );
}
