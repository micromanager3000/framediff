const STYLE_SCOPE_ATTRIBUTE = "data-framediff-style-scope";

/** Split a selector list without treating commas inside :is(), :not(), attributes, or strings as separators. */
function splitSelectorList(value: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") round += 1;
    else if (character === ")") round = Math.max(0, round - 1);
    else if (character === "[") square += 1;
    else if (character === "]") square = Math.max(0, square - 1);
    else if (character === "," && round === 0 && square === 0) {
      selectors.push(value.slice(start, index));
      start = index + 1;
    }
  }
  selectors.push(value.slice(start));
  return selectors;
}

function trailingPseudoElement(selector: string): { selector: string; pseudo: string } {
  const match = selector.match(/^(.*?)(::[a-zA-Z-]+(?:\([^)]*\))?)\s*$/s);
  return match ? { selector: match[1].trim(), pseudo: match[2] } : { selector, pseudo: "" };
}

function normalizeDocumentSelector(selector: string): string {
  const trimmed = selector.trim();
  if (/^(?::root|html|body)$/i.test(trimmed)) return "[data-fd-composition]";
  return trimmed
    .replace(/^html\s+body\s+/i, "")
    .replace(/^(?::root|html|body)\s+/i, "");
}

/**
 * Constrain an authored selector to elements belonging to one composition mount.
 *
 * Every authored element receives the same unique attribute. Intersecting the selector's
 * target with that attribute prevents both sibling and parent composition styles from crossing
 * a nested-composition boundary. The two variants cover descendants and the composition root.
 */
export function scopeCompositionSelectorList(selectorText: string, token: string): string {
  const scope = `[${STYLE_SCOPE_ATTRIBUTE}="${CSS.escape(token)}"]`;
  return splitSelectorList(selectorText).flatMap((raw) => {
    const normalized = normalizeDocumentSelector(raw);
    if (!normalized) return [];
    const { selector, pseudo } = trailingPseudoElement(normalized);
    const target = `:is(${selector}):where(${scope})${pseudo}`;
    return [`:where(${scope}) ${target}`, `:where(${scope})${target}`];
  }).join(", ");
}

type RuleWithChildren = CSSRule & { cssRules?: CSSRuleList };

function scopeRule(rule: CSSRule, token: string): void {
  const styleRule = rule as CSSRule & { selectorText?: string };
  if (typeof styleRule.selectorText === "string") {
    styleRule.selectorText = scopeCompositionSelectorList(styleRule.selectorText, token);
  }
  const children = (rule as RuleWithChildren).cssRules;
  if (children) for (const child of Array.from(children)) scopeRule(child, token);
}

function scopeStyleElement(style: HTMLStyleElement, token: string): void {
  if (style.dataset.framediffStyleScoped === token) return;
  const sheet = style.sheet;
  if (!sheet) return;
  try {
    for (const rule of Array.from(sheet.cssRules)) scopeRule(rule, token);
    // Persist the CSSOM mutations into the node text. The capture pipeline clones style nodes,
    // so leaving only a mutated live sheet would restore the original global selectors in export.
    style.textContent = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
    style.dataset.framediffStyleScoped = token;
  } catch (error) {
    console.warn("FrameDiff could not isolate a composition stylesheet.", error);
  }
}

function belongsTo(root: HTMLElement, element: Element): boolean {
  return element.closest("[data-fd-composition]") === root;
}

function scopeSubtree(root: HTMLElement, node: Node, token: string): void {
  if (!(node instanceof Element)) return;
  const elements = [node, ...Array.from(node.querySelectorAll("*"))];
  for (const element of elements) {
    if (!belongsTo(root, element)) continue;
    element.setAttribute(STYLE_SCOPE_ATTRIBUTE, token);
  }
  for (const style of elements.filter((element): element is HTMLStyleElement => element instanceof HTMLStyleElement)) {
    if (belongsTo(root, style)) scopeStyleElement(style, token);
  }
}

/** Isolate inline composition CSS and keep dynamically-created authored elements in that scope. */
export function isolateCompositionStyles(root: HTMLElement, token: string): () => void {
  scopeSubtree(root, root, token);
  const observer = new MutationObserver((records) => {
    for (const record of records) for (const node of Array.from(record.addedNodes)) scopeSubtree(root, node, token);
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
