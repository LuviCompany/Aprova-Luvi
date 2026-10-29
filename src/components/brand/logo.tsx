import Image from "next/image";
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  /** Mostra o nome do produto ao lado do logo da agência. */
  withProductName?: boolean;
  size?: "sm" | "md" | "lg";
}

const HEIGHTS = { sm: 32, md: 40, lg: 56 } as const;

export function Logo({ className, withProductName = true, size = "md" }: LogoProps) {
  const height = HEIGHTS[size];
  const width = Math.round(height * 2.4);
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <Image
        src="/brand/logo-luvi.png"
        alt="Luvi Company"
        width={width}
        height={height}
        priority
        className="object-contain"
        style={{ height, width }}
      />
      {withProductName && (
        <>
          <span aria-hidden className="h-6 w-px bg-white/15" />
          <span className="font-heading text-base font-bold tracking-tight text-white">
            Aprova Luvi
          </span>
        </>
      )}
    </span>
  );
}
