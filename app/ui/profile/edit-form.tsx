"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useActionState } from "react";
import { useSession } from "next-auth/react";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
import { userSchema } from "@/app/lib/schema/profile/schema";
import { updateUser } from "@/app/lib/actions";
import { withCallbacks } from "@/lib/with-callbacks";
import { toast } from "sonner";

export function EditForm() {
  const { data: session } = useSession();
  const [lastResult, action] = useActionState(
    withCallbacks(updateUser.bind(null, String(session?.user?.id)), {
      onSuccess() {
        toast.success("profile updated");
      },
    }),
    undefined
  );
  const [form, fields] = useForm({
    lastResult,

    onValidate({ formData }) {
      return parseWithZod(formData, { schema: userSchema });
    },

    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Profile</h3>
        <p className="text-sm text-muted-foreground">
          This is how others will see you on the site.
        </p>
      </div>
      <Separator />
      <form
        className="space-y-8"
        id={form.id}
        onSubmit={form.onSubmit}
        action={action}
        noValidate
      >
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            type="text"
            key={fields.name.key}
            name={fields.name.name}
            defaultValue={fields.name.value ?? String(session?.user?.name)}
            placeholder="John Doe"
          />
          <p className="text-xs text-muted-foreground">
            This is your public display name.
          </p>
          <div className="text-red-500">{fields.name.errors}</div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Select>
            <SelectTrigger id="email">
              <SelectValue placeholder="Select a verified email to display" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="m@example.com">m@example.com</SelectItem>
              <SelectItem value="m@google.com">m@google.com</SelectItem>
              <SelectItem value="m@support.com">m@support.com</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            You can manage verified email addresses in your email settings.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bio">Bio</Label>
          <Textarea
            id="bio"
            placeholder="Tell us a little bit about yourself"
            className="min-h-[100px]"
            defaultValue="I own a computer."
          />
          <p className="text-xs text-muted-foreground">
            You can @mention other users and organizations to link to them.
          </p>
        </div>

        <Button type="submit">Update</Button>
      </form>
    </div>
  );
}
