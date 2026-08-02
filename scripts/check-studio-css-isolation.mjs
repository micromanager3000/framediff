import { readFile } from "node:fs/promises";

const stylesheetPath = process.argv[2] ?? "packages/studio-ui/src/studio.css";
const source = await readFile(stylesheetPath, "utf8");

function matchingBrace(text, open) {
  let depth = 1;
  let quote = "";
  let comment = false;
  for (let index = open + 1; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (comment) {
      if (character === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "*") {
      comment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index;
  }
  throw new Error(`Unclosed CSS block at character ${open}`);
}

function splitSelectors(text) {
  const selectors = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  let quote = "";
  let comment = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (comment) {
      if (character === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "*") {
      comment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "," && parentheses === 0 && brackets === 0) {
      selectors.push(text.slice(start, index));
      start = index + 1;
    }
  }
  selectors.push(text.slice(start));
  return selectors;
}

function withoutComments(selector) {
  return selector.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\s+/gu, " ").trim();
}

function visitRules(text, rules = [], insideKeyframes = false) {
  let position = 0;
  while (position < text.length) {
    let token = -1;
    let parentheses = 0;
    let quote = "";
    let comment = false;
    for (let index = position; index < text.length; index += 1) {
      const character = text[index];
      const next = text[index + 1];
      if (comment) {
        if (character === "*" && next === "/") {
          comment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (character === "\\") index += 1;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === "/" && next === "*") {
        comment = true;
        index += 1;
        continue;
      }
      if (character === '"' || character === "'") quote = character;
      else if (character === "(") parentheses += 1;
      else if (character === ")") parentheses -= 1;
      else if (parentheses === 0 && (character === "{" || character === ";")) {
        token = index;
        break;
      }
    }
    if (token < 0) break;
    if (text[token] === ";") {
      position = token + 1;
      continue;
    }

    const close = matchingBrace(text, token);
    const prelude = text.slice(position, token).trim();
    const body = text.slice(token + 1, close);
    if (insideKeyframes) {
      // Keyframe steps are inert animation selectors, not document or component rules.
    } else if (prelude.startsWith("@keyframes ") || prelude.startsWith("@-webkit-keyframes ")) {
      visitRules(body, rules, true);
    } else if (prelude.startsWith("@")) {
      visitRules(body, rules, false);
    } else {
      for (const selector of splitSelectors(prelude).map(withoutComments)) {
        if (selector) rules.push({ selector, prelude });
      }
    }
    position = close + 1;
  }
  return rules;
}

const rules = visitRules(source);
const violations = [];
const hasRootWorkspaceRule = rules.some(({ selector }) => selector.includes(".workspace") && selector.includes(".framediff-studio"));

for (const { selector } of rules) {
  if (/(^|[\s>+~,(])(?:html|body)(?=$|[\s.#:[>+~,(])|(^|[\s>+~,(])#svelte(?=$|[\s.#:[>+~,(])|:root(?=$|[\s.#:[>+~,(])/u.test(selector)) {
    violations.push(`host-document selector: ${selector}`);
  }
  if (!selector.includes(".framediff-studio") && !selector.includes(".dedicated-render-window")) {
    violations.push(`unrooted Studio selector: ${selector}`);
  }
  if (selector.includes(".workspace") && !selector.includes(".framediff-studio")) {
    violations.push(`unscoped workspace selector: ${selector}`);
  }
  if (selector.includes(".render-window-close") && !selector.includes(".dedicated-render-window")) {
    violations.push(`unscoped dedicated-render selector: ${selector}`);
  }
}

if (!hasRootWorkspaceRule) violations.push("missing .framediff-studio workspace rules");

if (violations.length) {
  console.error(["Studio CSS isolation check failed.", ...violations.map((violation) => `- ${violation}`)].join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Studio CSS isolation check passed (${rules.length} rooted selectors).`);
}
