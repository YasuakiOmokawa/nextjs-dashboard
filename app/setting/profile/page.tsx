import { deleteUser } from "@/app/lib/actions";
import DeleteAccountButton from "@/app/ui/profile/delete-account-button";
import { EditForm } from "@/app/ui/profile/edit-form";
import { auth } from "@/auth";

export default async function Page() {
  const session = await auth();

  return (
    <main>
      <div>this is user profile</div>
      <p>Welcome {session?.user?.name}</p>
      <EditForm />
      <form action={deleteUser.bind(null, session?.user?.id)}>
        <DeleteAccountButton />
      </form>
    </main>
  );
}
