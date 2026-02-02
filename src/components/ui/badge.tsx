import { forwardRef, type HTMLAttributes } from "react";

type BadgeVariant = "default" | "secondary" | "success" | "warning" | "error" | "outline";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-blue-600/20 text-blue-400 border-blue-600/30",
  secondary: "bg-zinc-700/50 text-zinc-300 border-zinc-600/30",
  success: "bg-green-600/20 text-green-400 border-green-600/30",
  warning: "bg-yellow-600/20 text-yellow-400 border-yellow-600/30",
  error: "bg-red-600/20 text-red-400 border-red-600/30",
  outline: "bg-transparent text-zinc-400 border-zinc-600",
};

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className = "", variant = "default", children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={`
          inline-flex items-center
          rounded-full border px-2.5 py-0.5
          text-xs font-medium
          transition-colors
          ${variantStyles[variant]}
          ${className}
        `}
        {...props}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = "Badge";

export { Badge, type BadgeProps, type BadgeVariant };
