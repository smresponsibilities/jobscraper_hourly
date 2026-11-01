/** Apply the workspace design to private, generated batches without changing
 * their content, action links, or publication workflow. */
export function decorateOutreachHtml(html: string): string {
  const presentation = '<link rel="stylesheet" href="/outreach-theme.css"><script>try{document.documentElement.dataset.theme=localStorage.getItem("jobradar-theme")==="dark"?"dark":"light"}catch(e){}</script>';
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, presentation + '</head>') : presentation + html;
}
