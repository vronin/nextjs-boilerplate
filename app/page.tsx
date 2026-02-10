import Image from "next/image";

export const dynamic = "force-dynamic";

export default async function Home() {
  const res = await fetch("/api/oidc", { cache: "no-store" });
  const data: { claims: any | null; error?: string } = await res.json();

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <Image
          className="dark:invert"
          src="/next.svg"
          alt="Next.js logo"
          width={100}
          height={20}
          priority
        />

        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
            To get started, edit the page.tsx file.
          </h1>

          <div className="w-full max-w-md rounded-lg border border-black/10 p-4 text-left dark:border-white/20">
            <div className="mb-2 font-semibold text-black dark:text-zinc-50">
              Vercel OIDC claims (runtime)
            </div>

            {data.claims ? (
              <pre className="whitespace-pre-wrap break-all text-xs text-zinc-700 dark:text-zinc-300">
                {JSON.stringify(data.claims, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                No claims available.{" "}
                {data.error
                  ? `Error: ${data.error}`
                  : "Make sure OIDC is enabled in Vercel project settings and you’re running on Vercel."}
              </p>
            )}
          </div>
        </div>

        {/* ...rest of your existing buttons/links... */}
        <div className="flex flex-col gap-4 text-base font-medium sm:flex-row">
          {/* unchanged */}
        </div>
      </main>
    </div>
  );
}
