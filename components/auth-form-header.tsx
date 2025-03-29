import Link from "next/link";
import MyServiceLogo from "./my-service-logo";
import MyServiceName from "./my-service-name";

export default function AuthFormHeader() {
  return (
    <Link href="/" className="flex flex-col items-center gap-2 font-medium">
      <div className="flex -mb-12 items-center justify-center rounded-md">
        <MyServiceLogo width={300} height={150} />
      </div>
      <span className="sr-only">
        <MyServiceName />
      </span>
    </Link>
  );
}
