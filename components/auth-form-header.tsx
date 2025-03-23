import Link from "next/link";
import NoMoreBakusokuLogo from "./no-more-bakusoku-logo";

export default function AuthFormHeader() {
  return (
    <Link href="/" className="flex flex-col items-center gap-2 font-medium">
      <div className="flex h-8 w-8 items-center justify-center rounded-md">
        <NoMoreBakusokuLogo />
      </div>
      <span className="sr-only">No more 爆速</span>
    </Link>
  );
}
