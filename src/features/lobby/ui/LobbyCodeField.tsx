import { useRef } from "react";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

interface LobbyCodeFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

/**
 * Four big digit boxes backed by one hidden input, so mobile keyboards open
 * with the number pad and paste of "4821" just works.
 */
export function LobbyCodeField({ value, onChange, onSubmit, disabled, autoFocus }: LobbyCodeFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const digits = value.padEnd(4, " ").slice(0, 4).split("");

  return (
    <div
      role="group"
      className="relative flex items-center gap-[8px]"
      onClick={() => inputRef.current?.focus()}
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => {
          const next = event.target.value.replace(/\D/g, "").slice(0, 4);
          onChange(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSubmit?.();
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={4}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label="Lobby code"
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
      />
      {digits.map((digit, index) => (
        <span
          key={index}
          className={`flex h-[52px] flex-1 items-center justify-center rounded-lg border border-solid text-[24px] font-[600] tabular-nums ${
            digit.trim()
              ? "border-text-primary/35 bg-border-alpha-14 text-text-primary"
              : "border-border-primary bg-border-alpha-08 text-text-tertiary"
          } ${disabled ? "opacity-50" : ""}`}
          style={font}
        >
          {digit.trim() || "–"}
        </span>
      ))}
    </div>
  );
}
