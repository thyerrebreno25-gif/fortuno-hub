type Props = { title: string; html: string; className?: string };

/** All email HTML, including sent mail synced from Gmail, is untrusted. */
export function EmailMessageHtml({ title, html, className }: Props) {
  return <iframe title={title} sandbox="" referrerPolicy="no-referrer" srcDoc={html} className={className} />;
}
