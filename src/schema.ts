import { z } from "zod";

type JS = { type: string; properties: Record<string, any>; required: string[] };

// Map wrekenfile/CLI type names onto JSON Schema types. Lowercase keys already in
// JSON Schema form (e.g. "string", "integer") map to themselves so a nested
// `schema` block from `swytchcode info` passes through unchanged.
const TYPE_MAP: Record<string, string> = {
  int: "integer", integer: "integer",
  float: "number", number: "number", double: "number",
  bool: "boolean", boolean: "boolean",
  object: "object", any: "object",
  string: "string", array: "array",
};

function jsonType(raw: any): string {
  const t = String(raw ?? "string").trim().toLowerCase();
  if (t.startsWith("[]")) return "array";
  if (t.startsWith("struct(") || t.startsWith("map(")) return "object";
  return TYPE_MAP[t] ?? "string";
}

// `swytchcode info` nests an object body's fields under a `schema` key
// ({ TYPE: "OBJECT", schema: { properties: {...}, required: [...] } }), while a
// plain JSON Schema keeps `properties` inline. Handle both.
function nested(spec: any): any | null {
  const inner = spec.schema;
  if (inner && typeof inner === "object" && inner.properties && typeof inner.properties === "object") return inner;
  if (spec.properties && typeof spec.properties === "object") return spec;
  return null;
}

function isRequired(spec: any): boolean {
  const r = spec.required ?? spec.REQUIRED;
  return r === true || (typeof r === "string" && r.trim().toLowerCase() === "true");
}

function isValidName(name: string): boolean {
  if (!name || name.startsWith("$")) return false;
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

// Convert one field spec into a JSON Schema fragment, recursing into nested object
// properties and array items so the model sees the full shape instead of an
// opaque object.
function expand(spec: any): any {
  if (!spec || typeof spec !== "object") return { type: "string" };

  const t = jsonType(spec.TYPE ?? spec.type);
  const out: any = { type: t };

  const desc = spec.DESC ?? spec.description;
  if (desc) out.description = desc;

  if (t === "object") {
    const n = nested(spec);
    if (n) {
      out.properties = {};
      for (const [name, child] of Object.entries<any>(n.properties)) {
        if (isValidName(name)) out.properties[name] = expand(child);
      }
      const explicit = Array.isArray(n.required) ? [...n.required] : [];
      for (const [name, child] of Object.entries<any>(n.properties)) {
        if (isValidName(name) && child && typeof child === "object" && isRequired(child) && !explicit.includes(name)) {
          explicit.push(name);
        }
      }
      out.required = explicit.filter((name) => name in out.properties);
    }
  } else if (t === "array") {
    const items = spec.items ?? (spec.schema && typeof spec.schema === "object" ? spec.schema.items : undefined);
    if (items && typeof items === "object") out.items = expand(items);
  }

  return out;
}

export function simplify(inputs: any): JS {
  if (Array.isArray(inputs)) {
    const properties: Record<string,any> = {};
    const required: string[] = [];

    for (const item of inputs) {
      if (!item || typeof item !== "object") continue;
      for (const [name, spec] of Object.entries<any>(item)) {
        if (!spec || typeof spec !== "object" || !isValidName(name)) continue;

        // Expand into full JSON Schema, keeping nested object/array shape
        // (a body's fields live under spec.schema and were previously dropped,
        // leaving the model blind to what to send).
        properties[name] = expand(spec);

        const req = spec.REQUIRED;
        const loc = String(spec.LOCATION || spec.location || "").toLowerCase();
        const isReq = loc === "path" || req === true || (typeof req === "string" && req.trim().toLowerCase() === "true");
        if (isReq) required.push(name);
      }
    }
    // rule: expose ALL fields to the model and list only the
    // truly-required ones in `required`. A required-only approach hid optional
    // fields - which left all-optional tools (e.g. Stripe) with an empty schema
    // so the model called them with no arguments, and blinded the model to
    // optional fields on tools that do have some required ones.
    return { type:"object", properties, required };
  }

  if (!inputs || typeof inputs !== "object") {
    return { type:"object", properties:{}, required:[] };
  }

  const properties = inputs.properties || {};
  const required: string[] = Array.isArray(inputs.required) ? inputs.required : [];
  const keep: Record<string, any> = {};

  // Expose ALL fields (same rule as the array branch above); use the original
  // required list only for the `required` key so optional/nested fields stay
  // optional instead of being dropped or forced required.
  for (const name of Object.keys(properties)) {
    if (!isValidName(name)) continue;
    let spec = properties[name] || {};

    // JSON-Schema tools might have LOCATION metadata. Mark path params as required.
    const loc = String(spec.LOCATION || spec.location || "").toLowerCase();
    if (loc === "path" && !required.includes(name)) {
      required.push(name);
    }

    if (typeof spec === "object" && spec !== null && (jsonType(spec.type ?? spec.TYPE) === "object" || jsonType(spec.type ?? spec.TYPE) === "array")) {
        spec = expand(spec); // expand nested objects/arrays
    }
    keep[name] = spec;
  }
  return { type: "object", properties: keep, required: required.filter((n) => n in keep) };
}

// Build a zod type for a single JSON Schema field spec, recursing into nested
// objects and array items.
function zodFor(spec: any): z.ZodTypeAny {
  let t: z.ZodTypeAny;
  if (spec.type === "integer" || spec.type === "number") {
    t = z.number();
  } else if (spec.type === "boolean") {
    t = z.boolean();
  } else if (spec.type === "array") {
    t = z.array(spec.items ? zodFor(spec.items) : z.any());
  } else if (spec.type === "object") {
    // Build a real object schema when the fields are known so the model is told
    // what to send; fall back to a permissive record for freeform objects.
    if (spec.properties && Object.keys(spec.properties).length > 0) {
      const shape: Record<string, z.ZodTypeAny> = {};
      const req: string[] = Array.isArray(spec.required) ? spec.required : [];
      for (const [name, child] of Object.entries<any>(spec.properties)) {
        const ct = zodFor(child);
        shape[name] = req.includes(name) ? ct : ct.optional();
      }
      t = z.object(shape);
    } else {
      t = z.record(z.string(), z.any());
    }
  } else {
    t = z.string();
  }
  if (spec.description) t = t.describe(spec.description);
  return t;
}

export function toZod(s: JS) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, spec] of Object.entries(s.properties)) {
    const t = zodFor(spec);
    shape[name] = s.required.includes(name) ? t : t.optional();
  }
  return z.object(shape);
}
