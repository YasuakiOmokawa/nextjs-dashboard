import { EditForm } from "@/app/ui/profile/edit-form";

export default async function Page() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <EditForm />
    </div>
  );
}
