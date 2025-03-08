import { deleteUser } from "@/app/lib/actions";
import DeleteAccountButton from "@/app/ui/profile/delete-account-button";
import { EditSheet } from "@/app/ui/profile/edit-sheet";
import { auth } from "@/auth";

export default async function Page() {
  const session = await auth();

  return (
    <main>
      <div>this is user profile</div>
      <p>Welcome {session?.user?.name}</p>
      <EditSheet />
      <form action={deleteUser.bind(null, session?.user?.id)}>
        <DeleteAccountButton />
      </form>
    </main>
  );
}
