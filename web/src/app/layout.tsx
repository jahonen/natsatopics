import '@/styles/main.scss';

export const metadata = {
  title: 'Natsastore — sisältöpipeline',
  description: 'Editorin muokkaus- ja julkaisutyökalu Natsastore-postauksille.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fi">
      <body>{children}</body>
    </html>
  );
}
