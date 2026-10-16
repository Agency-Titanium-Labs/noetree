import MarketplaceHeader from "@/components/MarketplaceHeader";

export default function MarketplaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-background">
      <MarketplaceHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        {children}
      </main>
    </div>
  );
}
