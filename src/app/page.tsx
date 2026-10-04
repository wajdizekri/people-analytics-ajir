import { redirect } from "next/navigation";
import { getContext, homePath } from "@/lib/dal/context";

export default async function Home() {
  const ctx = await getContext();
  redirect(ctx ? homePath(ctx.role) : "/login");
}
