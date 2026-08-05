function attributeValue(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function stripBundledStylesheetLinks(html) {
  return html.replace(/<link\b[^>]*>/gi, (tag) => {
    const rel = attributeValue(tag, "rel").toLowerCase().split(/\s+/);
    const href = attributeValue(tag, "href").trim();
    const pathname = href.split(/[?#]/, 1)[0].toLowerCase();
    const isRemote = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href);
    return rel.includes("stylesheet") && !isRemote && pathname.endsWith(".css") ? "" : tag;
  });
}

export function withProjectStyles(html, styles) {
  const selfContainedHtml = stripBundledStylesheetLinks(html);
  if (!styles.trim()) return selfContainedHtml;
  const tag = `<style data-framediff-hosted-styles>${styles}</style>`;
  if (/<\/head\s*>/i.test(selfContainedHtml)) {
    return selfContainedHtml.replace(/<\/head\s*>/i, `${tag}</head>`);
  }
  if (/<html\b[^>]*>/i.test(selfContainedHtml)) {
    return selfContainedHtml.replace(/<html\b[^>]*>/i, `$&<head>${tag}</head>`);
  }
  return `${tag}${selfContainedHtml}`;
}
