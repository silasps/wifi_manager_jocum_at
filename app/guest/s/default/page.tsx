import { redirect } from "next/navigation";

export default async function GuestRedirect({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; url?: string; ap?: string; t?: string; ssid?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.id) query.set("id", params.id);
  if (params.url) query.set("url", params.url);

  redirect(`/hotspot?${query.toString()}`);
}
