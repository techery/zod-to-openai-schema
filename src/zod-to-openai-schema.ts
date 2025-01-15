import { z, ZodTypeAny } from 'zod';

type JSONSchemaType = 'string' | 'number' | 'boolean' | 'integer' | 'object' | 'array' | 'null';

/**
 * Minimal JSON Schema for OpenAI structured outputs,
 * excluding unsupported fields (minItems, maxItems, min/max, etc.).
 */
export interface OpenAIStructuredOutputSchema {
  $ref?: string;
  type?: JSONSchemaType;
  enum?: any[];
  anyOf?: OpenAIStructuredOutputSchema[];
  description?: string;
  properties?: Record<string, OpenAIStructuredOutputSchema>;
  required?: string[];
  items?: OpenAIStructuredOutputSchema;
  additionalProperties?: boolean;
  $defs?: Record<string, OpenAIStructuredOutputSchema>;
}

const MAX_DEPTH = 100;

/**
 * 1) Collect usage counts for all Zod nodes within "rootSchema".
 */
function collectUsageCounts(rootSchema: ZodTypeAny) {
  const usageCount = new Map<ZodTypeAny, number>();

  function visit(schema: ZodTypeAny, depth: number) {
    if (depth > MAX_DEPTH) {
      return;
    }

    usageCount.set(schema, (usageCount.get(schema) || 0) + 1);

    const def: any = schema?._def;
    const typeName: string = def?.typeName;

    switch (typeName) {
      case 'ZodObject': {
        const shape = def.shape();
        for (const key of Object.keys(shape)) {
          visit(shape[key], depth + 1);
        }
        break;
      }
      case 'ZodArray': {
        visit(def.type, depth + 1);
        break;
      }
      case 'ZodUnion': {
        (def.options || []).forEach((option: ZodTypeAny) => visit(option, depth + 1));
        break;
      }
      case 'ZodDiscriminatedUnion': {
        for (const opt of def.optionsMap?.values() || []) {
          visit(opt, depth + 1);
        }
        break;
      }
      case 'ZodLazy': {
        const inner = def.getter();
        visit(inner, depth + 1);
        break;
      }
      case 'ZodDefault':
      case 'ZodOptional':
      case 'ZodNullable': {
        const inner = def.innerType || def._def?.innerType;
        if (inner) {
          visit(inner, depth + 1);
        }
        break;
      }
      // For ZodString, ZodNumber, ZodBoolean, ZodEnum, etc.: no children
      default:
        break;
    }
  }

  visit(rootSchema, 0);
  return usageCount;
}

export interface Definition {
  name: string;
  schema: z.ZodObject<any>;
}

export function definition(name: string, schema: z.ZodObject<any>): Definition {
  return { name, schema };
}

interface Config {
  definitions?: Definition[];
}

/**
 * 2) Convert the root Zod schema into JSONSchema:
 *    - If a ZodObject node is repeated (usage>1), place it in $defs and reference it.
 *    - All other node types (array, union, lazy, etc.) are inlined, even if repeated.
 *    - The root schema is never just "$ref".
 *    - additionalProperties=false for objects.
 */
export function zodToOpenAISchema(
  rootSchema: ZodTypeAny,
  config: Config = {}
): OpenAIStructuredOutputSchema {
  const usageCount = collectUsageCounts(rootSchema);

  // Map "ZodObject" => definition name
  const objectDefs = new Map<ZodTypeAny, string>();
  const defs: Record<string, OpenAIStructuredOutputSchema> = {};
  let defCounter = 1;

  function build(node: ZodTypeAny, isRoot: boolean): OpenAIStructuredOutputSchema {
    const def: any = node?._def;
    const typeName: string = def?.typeName;

    // Only store repeated ZodObject nodes in $defs
    const isObject = typeName === 'ZodObject';
    const count = usageCount.get(node) || 0;

    if (!isRoot && isObject && count > 1) {
      if (!objectDefs.has(node)) {
        if (config.definitions) {
          const existingDef = config.definitions.find((d) => d.schema === node);
          if (existingDef) {
            objectDefs.set(node, existingDef.name);
          } else {
            objectDefs.set(node, `Def_${defCounter++}`);
          }
        } else {
          objectDefs.set(node, `Def_${defCounter++}`);
        }
      }
      return { $ref: `#/$defs/${objectDefs.get(node)}` };
    }

    // Inline everything else
    return parseNode(node);
  }

  function parseNode(node: ZodTypeAny): OpenAIStructuredOutputSchema {
    const def: any = node?._def;
    const typeName: string = def?.typeName;
    const schema: OpenAIStructuredOutputSchema = {};

    if (node.description) {
      schema.description = node.description;
    }

    switch (typeName) {
      case 'ZodString':
        schema.type = 'string';
        break;
      case 'ZodNumber': {
        const checks = def.checks || [];
        const isInt = checks.some((c: any) => c.kind === 'int');
        schema.type = isInt ? 'integer' : 'number';
        break;
      }
      case 'ZodBoolean':
        schema.type = 'boolean';
        break;
      case 'ZodBigInt':
        schema.type = 'integer';
        break;
      case 'ZodObject': {
        schema.type = 'object';
        schema.additionalProperties = false;
        schema.properties = {};
        const shape = def.shape();
        const requiredKeys: string[] = [];

        for (const key of Object.keys(shape)) {
          const propSchema = shape[key];

          requiredKeys.push(key);

          if (propSchema.isNullable()) {
            schema.properties[key] = build(z.union([propSchema, z.null()]), false);
          } else {
            schema.properties[key] = build(propSchema, false);
          }

          if (propSchema.isOptional()) {
            throw new Error('Optional fields are not allowed');
          }
        }
        if (requiredKeys.length > 0) {
          schema.required = requiredKeys;
        }
        break;
      }
      case 'ZodArray':
        schema.type = 'array';
        schema.items = build(def.type, false);
        break;
      case 'ZodUnion':
        schema.anyOf = (def.options || []).map((o: ZodTypeAny) => build(o, false));
        break;
      case 'ZodDiscriminatedUnion': {
        const optionsMap = def.optionsMap;
        schema.anyOf = Array.from(optionsMap.values()).map((o) => build(o as ZodTypeAny, false));
        break;
      }
      case 'ZodLazy': {
        const inner = def.getter();
        return build(inner, false);
      }
      case 'ZodEnum':
        schema.type = 'string';
        schema.enum = def.values;
        break;
      case 'ZodLiteral': {
        const litVal = def.value;
        const valType = typeof litVal;
        if (valType === 'string') {
          schema.type = 'string';
          schema.enum = [litVal];
        } else if (valType === 'number') {
          schema.type = 'number';
          schema.enum = [litVal];
        } else if (valType === 'boolean') {
          schema.type = 'boolean';
          schema.enum = [litVal];
        } else {
          // e.g. null
          schema.type = 'string';
          schema.enum = [String(litVal)];
        }
        break;
      }
      case 'ZodNull':
        schema.type = 'null';
        break;
      case 'ZodDefault':
      case 'ZodOptional':
      case 'ZodNullable': {
        const inner: ZodTypeAny = def.innerType || def._def?.innerType;
        return parseNode(inner);
      }
      default:
        throw new Error(`Unsupported or unknown Zod type: ${typeName}`);
    }

    return schema;
  }

  // Build the top-level schema
  const rootJson = build(rootSchema, true);

  // Fill $defs for repeated objects
  for (const [node, defName] of objectDefs) {
    const schemaObj = parseNode(node);
    defs[defName] = schemaObj;
  }

  // Attach $defs if any
  if (Object.keys(defs).length > 0) {
    rootJson.$defs = defs;
  }

  // If the root is just {"$ref": "..."} => inline
  if (rootJson.$ref && Object.keys(rootJson).length === 1) {
    const refName = rootJson.$ref.replace(/^#\/\$defs\//, '');
    const realRoot = defs[refName];
    if (realRoot) {
      delete rootJson.$ref;
      Object.assign(rootJson, realRoot);
    }
  }

  return rootJson;
}
