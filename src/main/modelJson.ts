/** Some compatible gateways wrap JSON despite JSON mode. Accept only a single complete fence. */
export function parseModelJson(text:string):unknown {
  const trimmed=text.trim(),fence=/^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return JSON.parse(fence?fence[1]:trimmed)
}
