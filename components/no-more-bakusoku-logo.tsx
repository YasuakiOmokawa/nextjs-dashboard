import Image from "next/image";
import noMoreBakusokuLogo from "@/app/ui/icons/no-more-bakusoku-logo.png";

interface NoMoreBakusokuLogoProps {
  width?: number;
  height?: number;
  className?: string;
}

export default function NoMoreBakusokuLogo({
  width = 200,
  height = 200,
  className = "",
}: NoMoreBakusokuLogoProps) {
  return (
    <div
      className={`relative inline-block ${className}`}
      style={{ width, height }}
    >
      {/* 書道画像 */}
      <Image
        src={noMoreBakusokuLogo}
        alt="bakusoku"
        fill
        className="object-contain"
        priority
      />

      {/* 禁止マーク */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative h-4/5 w-4/5">
          <svg viewBox="0 0 100 100" className="h-full w-full opacity-90">
            {/* 赤い円 */}
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="#FF0000"
              strokeWidth="8"
            />
            {/* 斜め線 */}
            <line
              x1="20"
              y1="80"
              x2="80"
              y2="20"
              stroke="#FF0000"
              strokeWidth="8"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
