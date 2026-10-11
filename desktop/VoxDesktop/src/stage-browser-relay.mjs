/** A look cut down to what fits through the phone relay (about 20 KB), least important parts first. */
export function lookForRelay(look, maxBytes = 20_000) {
  if (!look) return null;
  const out = {
    url: String(look.url ?? "").slice(0, 500),
    title: String(look.title ?? "").slice(0, 160),
    text: String(look.text ?? "").slice(0, 2_400),
    elements: (Array.isArray(look.elements) ? look.elements : []).slice(0, 70).map((element) => ({
      ref: element.ref,
      kind: element.kind,
      label: String(element.label ?? "").slice(0, 70),
      value: String(element.value ?? "").slice(0, 40),
      hint: String(element.hint ?? "").slice(0, 40),
    })),
  };
  const size = () => Buffer.byteLength(JSON.stringify(out), "utf8");
  while (size() > maxBytes && out.text.length > 300) out.text = out.text.slice(0, Math.floor(out.text.length * 0.7));
  while (size() > maxBytes && out.elements.length > 10) out.elements.pop();
  return out;
}
