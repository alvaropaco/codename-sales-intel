import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive/10 text-destructive border-destructive/20 dark:bg-destructive/20 dark:text-destructive dark:border-destructive/30",
        outline: "text-foreground border-border",
        qualified:
          "border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
        prospect:
          "border-amber-200 bg-amber-50 text-amber-700 font-semibold dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
        lead:
          "border-blue-200 bg-blue-50 text-blue-700 font-semibold dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-400",
        closed:
          "border-purple-200 bg-purple-50 text-purple-700 font-semibold dark:border-purple-500/30 dark:bg-purple-500/10 dark:text-purple-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
