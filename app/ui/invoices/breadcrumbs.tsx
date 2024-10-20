import { clsx } from "clsx";
import Link from "next/link";
import { lusitana } from "@/app/ui/fonts";

interface Breadcrumb {
  label: string;
  href: string;
  active?: boolean;
}

export default function Breadcrumbs({
  breadcrumbs,
}: {
  breadcrumbs: Breadcrumb[];
}) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6 block">
      <ol className={clsx(lusitana.className, "flex text-xl md:text-2xl")}>
        {breadcrumbs.map((breadcrumb) => (
          <li
            key={breadcrumb.href}
            aria-current={breadcrumb.active}
            className={clsx(
              breadcrumb.active ? "text-gray-900" : "text-gray-500"
            )}
          >
            <Link href={breadcrumb.href}>{breadcrumb.label}</Link>
            {breadcrumb === breadcrumbs.at(-1) ? null : (
              <span className="mx-3 inline-block">/</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
