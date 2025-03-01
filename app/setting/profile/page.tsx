import { Button } from "@/app/ui/button";
import { auth } from "@/auth";

export default async function Page() {
  const session = await auth();

  return (
    <main>
      <div>this is user profile</div>
      <p>Welcome {session?.user?.name}</p>
      <form>
        <Button>delete your account</Button>
      </form>
    </main>
  );
}
