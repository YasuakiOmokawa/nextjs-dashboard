import Form from "@/app/ui/use-conform/create/confirm/form";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function Page() {
  const headerList = await headers();

  console.log(headerList.get("referer"));
  console.log(
    `${process.env.PROTOCOL}${headerList.get("host")}/use-conform/create`
  );

  if (
    headerList.get("referer") !==
    `${process.env.PROTOCOL}${headerList.get("host")}/use-conform/create`
  ) {
    // redirect("/use-conform/create");
  }

  return (
    <main>
      <Form />
    </main>
  );
}
