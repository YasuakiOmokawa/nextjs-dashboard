import { deleteUser } from "@/app/lib/actions";
import DeleteAccountButton from "@/app/ui/profile/delete-account-button";
import { auth } from "@/auth";

export default async function Page() {
  const session = await auth();

  return (
    <main>
      <div>this is user profile</div>
      <p>Welcome {session?.user?.name}</p>
      <form action={deleteUser.bind(null, session?.user?.email)}>
        <DeleteAccountButton />
      </form>
    </main>
  );
}
