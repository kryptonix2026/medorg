import { useState, useRef, useEffect } from "react";

interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: boolean;
}

export default function OtpInput({ length = 6, value, onChange, disabled, error }: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(Array(length).fill(""));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (value.length === length) {
      setDigits(value.split(""));
    }
  }, [value, length]);

  const handleChange = (index: number, digit: string) => {
    if (digit.length > 1) {
      // Paste handling
      const pasted = digit.slice(0, length).split("");
      const newDigits = Array(length).fill("");
      pasted.forEach((d, i) => {
        if (i < length) newDigits[i] = d;
      });
      setDigits(newDigits);
      onChange(newDigits.join(""));
      // Focus last filled
      const lastFilled = pasted.length - 1;
      inputRefs.current[Math.min(lastFilled, length - 1)]?.focus();
      return;
    }

    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);
    onChange(newDigits.join(""));

    // Auto-focus next
    if (digit && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  return (
    <div className="otp-container">
      {Array.from({ length }).map((_, index) => (
        <input
          key={index}
          ref={el => inputRefs.current[index] = el}
          type="text"
          inputMode="numeric"
          maxLength={1}
          className={`otp-box ${error ? "error" : ""}`}
          value={digits[index]}
          onChange={e => handleChange(index, e.target.value)}
          onKeyDown={e => handleKeyDown(index, e)}
          disabled={disabled}
          aria-label={`Digit ${index + 1}`}
        />
      ))}
    </div>
  );
}