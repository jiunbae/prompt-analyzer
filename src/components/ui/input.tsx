import { forwardRef, type InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={`
          flex h-10 w-full rounded-md
          border border-zinc-700 bg-zinc-900
          px-3 py-2 text-sm text-zinc-100
          placeholder:text-zinc-500
          transition-colors duration-150
          focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
          disabled:cursor-not-allowed disabled:opacity-50
          ${className}
        `}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";

export { Input, type InputProps };
