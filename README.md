# zod-to-openai-schema

[![npm version](https://badge.fury.io/js/@techery/zod-to-openai-schema.svg)](https://www.npmjs.com/package/@techery/zod-to-openai-schema)
![CI Status](https://github.com/techery/zod-to-openai-schema/actions/workflows/pr-checks.yml/badge.svg?branch=main)

Convert [Zod](https://github.com/colinhacks/zod) schemas to [OpenAI function calling](https://platform.openai.com/docs/guides/function-calling) compatible JSON Schema. This library helps you define your OpenAI function parameters using Zod's powerful schema definition system.

Developed by [Techery](https://techery.io).

## Features
- Convert Zod schemas to OpenAI-compatible JSON Schema
- Preserves property descriptions and structure
- Full TypeScript support
- Zero dependencies (except Zod)

## Type Compatibility

| Zod Type | OpenAI Schema Type | Notes |
|----------|-------------------|-------|
| `z.string()` | `string` | Basic string type |
| `z.number()` | `number` | Floating point numbers |
| `z.number().int()` | `integer` | Integer numbers |
| `z.boolean()` | `boolean` | Boolean values |
| `z.enum([...])` | `string` | With `enum: [...]` |
| `z.object({...})` | `object` | With `properties` and `required` |
| `z.array(...)` | `array` | With `items` schema |
| `z.union([...])` | N/A | Converted to `anyOf: [...]` |
| `z.discriminatedUnion(...)` | N/A | Converted to `anyOf: [...]` |
| `z.literal(string)` | `string` | With `enum: [value]` |
| `z.null()` | `string` | With `enum: [null]` |
| `someSchema.nullable()` | Same as base | With `type: ['type', 'null']` |
| `z.lazy(...)` | Supported | Using `$ref` and `$defs` |

## Installation

```bash
npm install zod-to-openai-schema
# or
yarn add zod-to-openai-schema
# or
pnpm add zod-to-openai-schema
```

## Usage

### Basic Example

```typescript
import { z } from 'zod';
import { zodToOpenAISchema } from 'zod-to-openai-schema';

const schema = z.object({
  name: z.string().describe('The name of the person'),
  age: z.number(),
  email: z.string().email(),
});

const jsonSchema = zodToOpenAISchema(schema);

// Resulting OpenAI schema:
{
  type: "object",
  properties: {
    name: { 
      type: "string",
      description: "The name of the person"
    },
    age: { type: "number" },
    email: { type: "string" }
  },
  required: ["name", "age", "email"],
  additionalProperties: false
}
```

### Using with OpenAI Function Calling

```typescript
import { z } from 'zod';
import { zodToOpenAISchema } from 'zod-to-openai-schema';
import OpenAI from 'openai';

const createTodoSchema = z.object({
  title: z.string().describe('The title of the todo item'),
  priority: z.enum(['low', 'medium', 'high']).describe('Priority level'),
  dueDate: z.string().describe('Due date in ISO format'),
});

const openai = new OpenAI();

const completion = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Create a high priority todo for reviewing code tomorrow' }],
  functions: [
    {
      name: 'createTodo',
      description: 'Create a new todo item',
      parameters: zodToOpenAISchema(createTodoSchema),
    },
  ],
});
```

### Advanced Examples

#### Recursive Types with References

```typescript
import { z } from 'zod';
import { zodToOpenAISchema, definition } from 'zod-to-openai-schema';

// Define a recursive comment schema
const commentSchema: z.ZodType<any> = z.lazy(() => 
  z.object({
    text: z.string(),
    replies: z.array(commentSchema)
  })
);

const schema = z.object({
  post: z.object({
    title: z.string(),
    content: z.string(),
  }),
  comments: z.array(commentSchema)
});

const jsonSchema = zodToOpenAISchema(schema);

// Resulting schema will use $ref and $defs for recursive types
```

#### Reusable Types with Named Definitions

```typescript
const todoItemSchema = z.object({
  name: z.string(),
  completed: z.boolean(),
});

const schema = z.object({
  pending: z.array(todoItemSchema),
  completed: z.array(todoItemSchema),
});

const jsonSchema = zodToOpenAISchema(schema, {
  definitions: [definition('TodoItem', todoItemSchema)],
});

// Resulting schema will use $ref: "#/$defs/TodoItem"
```

## Supported Features

- Basic Types:
  - `string`
  - `number` (with `int()` support)
  - `boolean`
  
- Complex Types:
  - Objects (`z.object()`)
  - Arrays (`z.array()`)
  - Enums (`z.enum()`)
  - Unions (`z.union()`)
  - Discriminated Unions (`z.discriminatedUnion()`)
  - Literals (`z.literal()`)
  - Recursive types (using `z.lazy()`)

- Modifiers:
  - Nullable fields (`nullable()`)
  - References (`$ref` and `$defs`)

- Metadata:
  - Description preservation
  - Custom type definitions

## Limitations

- Optional fields are not supported (OpenAI requires explicit handling of optional fields)
- Some Zod types are not supported:
  - `z.any()`
  - `z.never()`
  - `z.intersection()`
  - `z.tuple()`
  - `z.record()`
- Validation constraints (min, max, regex, etc.) are not included in the output schema

## API Reference

### `zodToOpenAISchema(schema: z.ZodTypeAny, config?: Config): OpenAIStructuredOutputSchema`

Converts a Zod schema into an OpenAI-compatible JSON Schema.

#### Config Options
```typescript
interface Config {
  definitions?: Definition[];
}

interface Definition {
  name: string;
  schema: z.ZodObject<any>;
}
```

### `definition(name: string, schema: z.ZodObject<any>): Definition`

Helper function to create named type definitions for reuse.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Authors

- [Serge Zenchenko](https://github.com/sergezenchenko) - CTO at [Techery](https://techery.io)

## License

MIT