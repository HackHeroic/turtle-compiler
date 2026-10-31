'use client';
/* Loads a converted design page in the browser only, like the design runtime does. */
import dynamic from 'next/dynamic';

const PAGES = {
  home: dynamic(() => import('./generated/TurtleCompiler'), { ssr: false }),
  reference: dynamic(() => import('./generated/LanguageReference'), { ssr: false }),
  team: dynamic(() => import('./generated/Team'), { ssr: false }),
  present: dynamic(() => import('./generated/Present'), { ssr: false })
};

export default function Client({ page }) {
  const Page = PAGES[page];
  return <Page />;
}
