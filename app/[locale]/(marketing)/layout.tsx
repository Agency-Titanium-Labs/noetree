export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-background">
      <div className="w-full max-w-3xl px-6">{children}</div>
    </div>
  );
}
