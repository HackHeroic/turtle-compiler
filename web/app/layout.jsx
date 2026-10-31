import './globals.css';

export const metadata = {
  title: 'Turtle Compiler',
  description: 'A compiler for turtle graphics that shows all six phases live in your browser, from tokens to machine code.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" />
      </head>
      <body>
        <div id="dc-root">{children}</div>
      </body>
    </html>
  );
}
