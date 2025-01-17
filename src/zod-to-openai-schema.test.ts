import { z } from 'zod';
import { definition, zodToOpenAISchema } from './zod-to-openai-schema';

describe('zod-to-openai-schema', () => {
  it('should convert zod schema to openai schema', () => {
    const schema = z.object({
      name: z.string(),
    });

    const openaiSchema = zodToOpenAISchema(schema);

    expect(openaiSchema).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
      additionalProperties: false,
    });
  });

  it('should convert complex zod schema to openai schema', () => {
    const todoItemSchema = z.object({
      name: z.string(),
    });

    const schema = z.object({
      todos: z.array(todoItemSchema),
    });

    const openaiSchema = zodToOpenAISchema(schema);

    expect(openaiSchema).toEqual({
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
            additionalProperties: false,
          },
        },
      },
      required: ['todos'],
      additionalProperties: false,
    });
  });

  it('should convert complex zod schema with repeated object types to openai schema', () => {
    const todoItemSchema = z.object({
      name: z.string(),
    });

    const schema = z.object({
      pending: z.array(todoItemSchema),
      completed: z.array(todoItemSchema),
    });

    const openaiSchema = zodToOpenAISchema(schema);
    expect(openaiSchema).toEqual({
      type: 'object',
      properties: {
        pending: {
          type: 'array',
          items: {
            $ref: '#/$defs/Def_1',
          },
        },
        completed: {
          type: 'array',
          items: {
            $ref: '#/$defs/Def_1',
          },
        },
      },
      required: ['pending', 'completed'],
      additionalProperties: false,
      $defs: {
        Def_1: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
          additionalProperties: false,
        },
      },
    });
  });

  it('should convert zod schema with union to openai schema', () => {
    const schema = z.object({
      name: z.union([z.string(), z.number()]),
    });

    const openaiSchema = zodToOpenAISchema(schema);

    expect(openaiSchema).toEqual({
      type: 'object',
      properties: {
        name: {
          anyOf: [
            {
              type: 'string',
            },
            {
              type: 'number',
            },
          ],
        },
      },
      required: ['name'],
      additionalProperties: false,
    });
  });

  it('should convert zod schema with discriminated union to openai schema', () => {
    const schema = z.object({
      name: z.discriminatedUnion('type', [
        z.object({ type: z.literal('string'), name: z.string() }),
        z.object({ type: z.literal('number'), name: z.number() }),
      ]),
    });

    const openaiSchema = zodToOpenAISchema(schema);

    expect(openaiSchema).toEqual({
      type: 'object',
      properties: {
        name: {
          anyOf: [
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['string'] },
                name: { type: 'string' },
              },
              required: ['type', 'name'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['number'] },
                name: { type: 'number' },
              },
              required: ['type', 'name'],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ['name'],
      additionalProperties: false,
    });
  });

  it('should convert zod schema with descriptions to openai schema', () => {
    const schema = z.object({
      name: z.string().describe('The name of the person'),
      group: z.object({
        name: z.string().describe('The name of the group'),
      }),
    });

    const openaiSchema = zodToOpenAISchema(schema);

    expect(openaiSchema).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name of the person' },
        group: {
          type: 'object',
          properties: { name: { type: 'string', description: 'The name of the group' } },
          required: ['name'],
          additionalProperties: false,
        },
      },
      required: ['name', 'group'],
      additionalProperties: false,
    });
  });

  it('should convert recursive zod schema to openai schema', () => {
    const schema: z.ZodTypeAny = z.object({
      name: z.string(),
      children: z.array(z.lazy(() => schema)),
    });

    const openaiSchema = zodToOpenAISchema(schema);

    expect(openaiSchema).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        children: { type: 'array', items: { $ref: '#/$defs/Def_1' } },
      },
      required: ['name', 'children'],
      additionalProperties: false,
      $defs: {
        Def_1: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            children: { type: 'array', items: { $ref: '#/$defs/Def_1' } },
          },
          required: ['name', 'children'],
          additionalProperties: false,
        },
      },
    });
  });

  describe('optional vs. nullable fields', () => {
    it('should throw an error if the field is optional (z.string().optional())', () => {
      const schema = z.object({
        name: z.string().optional(),
      });
      expect(() => zodToOpenAISchema(schema)).toThrowError(/Optional fields are not allowed/);
    });

    it('should convert schema successfully if the field is nullable (z.string().nullable())', () => {
      const schema = z.object({
        name: z.string().nullable(),
      });

      const openaiSchema = zodToOpenAISchema(schema);
      // We interpret "string | null" as a type union: 'string' or 'null'.
      // For JSON Schema, it's typically "type: ['string', 'null']".
      expect(openaiSchema).toEqual({
        type: 'object',
        properties: {
          name: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
          },
        },
        required: ['name'],
        additionalProperties: false,
      });
    });

    it('should throw an error for ZodDefault (equivalent to optional + default)', () => {
      const schema = z.object({
        count: z.number().default(0),
      });
      // By default, ZodDefault wraps an optional type, so we treat this as "optional" in code.
      expect(() => zodToOpenAISchema(schema)).toThrowError(/Optional fields are not allowed/);
    });
  });

  it('should throw an error for unsupported Zod types (e.g. z.any())', () => {
    const schema = z.object({
      // z.any() is not explicitly handled in our switch, so it should throw.
      anything: z.any(),
    });
    expect(() => zodToOpenAISchema(schema)).toThrowError(
      /Unsupported or unknown Zod type: ZodAny/i
    );
  });

  it('should throw an error for ZodNever', () => {
    const schema = z.object({
      impossible: z.never(),
    });
    expect(() => zodToOpenAISchema(schema)).toThrowError(
      /Unsupported or unknown Zod type: ZodNever/
    );
  });

  it('should handle intersections if you decide to support them (currently will throw)', () => {
    const first = z.object({ foo: z.string() });
    const second = z.object({ bar: z.number() });
    const schema = first.and(second);

    // By default, this will throw "Unsupported or unknown Zod type: ZodIntersection".
    // If you add a handler for ZodIntersection, adapt and remove the .toThrowError assertion.
    expect(() => zodToOpenAISchema(schema)).toThrowError(
      /Unsupported or unknown Zod type: ZodIntersection/
    );
  });

  it('should handle tuples if you decide to support them (currently will throw)', () => {
    const schema = z.tuple([z.string(), z.number()]);

    // Will throw: "Unsupported or unknown Zod type: ZodTuple"
    expect(() => zodToOpenAISchema(schema)).toThrowError(
      /Unsupported or unknown Zod type: ZodTuple/
    );
  });

  it('should handle records if you decide to support them (currently will throw)', () => {
    // z.record => an object with arbitrary keys of a certain type
    const schema = z.record(z.string());

    // Will throw: "Unsupported or unknown Zod type: ZodRecord"
    expect(() => zodToOpenAISchema(schema)).toThrowError(
      /Unsupported or unknown Zod type: ZodRecord/
    );
  });

  it('should handle a top-level array schema', () => {
    const schema = z.array(z.string());
    const openaiSchema = zodToOpenAISchema(schema);

    expect(openaiSchema).toEqual({
      type: 'array',
      items: {
        type: 'string',
      },
    });
  });

  it('should allow definitions to be provided', () => {
    const todoItemSchema = z.object({
      name: z.string(),
    });

    const schema = z.object({
      pending: z.array(todoItemSchema),
      completed: z.array(todoItemSchema),
    });

    const openaiSchema = zodToOpenAISchema(schema, {
      definitions: [definition('todoItem', todoItemSchema)],
    });

    expect(openaiSchema).toEqual({
      type: 'object',
      properties: {
        pending: { type: 'array', items: { $ref: '#/$defs/todoItem' } },
        completed: { type: 'array', items: { $ref: '#/$defs/todoItem' } },
      },
      required: ['pending', 'completed'],
      additionalProperties: false,
      $defs: {
        todoItem: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
          additionalProperties: false,
        },
      },
    });
  });

  it('should handle very complex schemas', () => {
    const stringFieldSchema = z.object({
      type: z.literal('string').describe('string field'),
      description: z.string().describe('The description of the field'),
      enum: z.array(z.string()).nullable().describe('The enum values'),
    });

    const numberFieldSchema = z.object({
      type: z.literal('number').describe('number field'),
      description: z.string().describe('The description of the field'),
    });

    const booleanFieldSchema = z.object({
      type: z.literal('boolean').describe('boolean field'),
      description: z.string().describe('The description of the field'),
    });

    const jsonPrimitivesSchema = z.union([
      stringFieldSchema,
      numberFieldSchema,
      booleanFieldSchema,
    ]);

    const baseArrayFieldSchema = z.object({
      type: z.literal('array').describe('array field'),
      description: z.string().describe('The description of the field'),
    });

    type ArrayField = z.infer<typeof baseArrayFieldSchema> & {
      items: JsonFieldType;
    };

    const arrayFieldSchema: z.ZodType<ArrayField> = baseArrayFieldSchema.extend({
      items: z
        .lazy(() => jsonFieldTypeSchema)
        .describe('The reference to the items definition of array or object from definitions'),
    });

    const baseObjectPropertySchema = z.object({
      name: z.string().describe('The name of the property'),
      required: z.boolean().describe('Whether the property is required'),
    });

    type ObjectProperty = z.infer<typeof baseObjectPropertySchema> & {
      definition: JsonFieldType;
    };

    const objectPropertySchema: z.ZodType<ObjectProperty> = baseObjectPropertySchema.extend({
      definition: z.lazy(() => jsonPrimitivesSchema),
    });

    const objectFieldSchema = z.object({
      type: z.literal('object').describe('object field'),
      description: z.string().describe('The description of the field'),
      properties: z.array(objectPropertySchema).describe('The properties of the object'),
    });

    const jsonFieldTypeSchema = z.union([
      stringFieldSchema,
      numberFieldSchema,
      booleanFieldSchema,
      arrayFieldSchema,
      objectFieldSchema,
    ]);

    type JsonFieldType = z.infer<typeof jsonFieldTypeSchema>;

    const zodSchemaComponentSchema = z.object({
      type: z.literal('zod-schema').describe('zod schema component'),
      id: z.string().describe('The id of the component'),
      name: z.string().describe('The name of the component'),
      description: z.string().describe('The description of the component'),
      schema: jsonFieldTypeSchema,
    });

    const openaiSchema = zodToOpenAISchema(zodSchemaComponentSchema);

    console.log(JSON.stringify(openaiSchema, null, 2));
  });
});
