import { z } from "zod";
import { ReminderConditionSchema, ReminderScheduleSchema, TimeZoneSchema } from "./reminderSchedule";

export const CardVariantSchema = z.enum(["minimal", "standard", "expanded"]);

export const EvidenceRefSchema = z.strictObject({
  title: z.string().max(500),
  url: z.string().regex(/^https?:\/\//),
  fetchedAt: z.iso.datetime(),
  provider: z.string().max(80),
  readFullPage: z.boolean(),
});

const cardId = z.string().min(1).max(128);

/** Row-bound notes are embedded in their parent, so delete/undo/export stay atomic. */
export const SubcardSchema = z.strictObject({
  id: cardId,
  itemId: cardId.optional(),
  anchor: z.string().max(128).optional(),
  text: z.string().trim().min(1).max(2000),
});
export type Subcard = z.infer<typeof SubcardSchema>;

export const LayoutSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number().min(80),
  height: z.number().min(56),
  pinned: z.boolean(),
});

export const MetadataSchema = z.strictObject({
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  aliases: z.array(z.string().max(80)).max(12).optional(),
  subcards: z.array(SubcardSchema).max(24).refine(items => new Set(items.map(item => item.id)).size === items.length).optional(),
});

const CommonShape = {
  id: cardId,
  variant: CardVariantSchema,
  sources: z.array(EvidenceRefSchema).max(15),
  layout: LayoutSchema,
  metadata: MetadataSchema,
};

const OpenSourceData = z.looseObject({});

export const CountdownSourceDataSchema = z.strictObject({
  targetAt: z.iso.datetime(),
  startedAt: z.iso.datetime().optional(),
  pausedAt: z.iso.datetime().nullable().optional(),
  /** Validated task text for the reminder list, Control and due announcement. */
  reminderText: z.string().min(1).max(160).optional(),
  notifiedAt: z.iso.datetime().nullable().optional(),
  schedule: ReminderScheduleSchema.nullable().optional(),
  condition: ReminderConditionSchema.nullable().optional(),
  conditionMetAt: z.iso.datetime().nullable().optional(),
  lastDeliveredTargetAt: z.iso.datetime().nullable().optional(),
  lastFiredAt: z.iso.datetime().nullable().optional(),
  timeZone: TimeZoneSchema.optional(),
}).refine(value => !(value.schedule && value.condition), "重复计划与完成条件不能同时存在。");

export const CountdownCardSchema = z.strictObject({
  ...CommonShape,
  type: z.literal("CountdownCard"),
  // Pure timers render digits; named reminders use sourceData.reminderText in
  // the shared reminder list. No arbitrary title/footer/advice display fields.
  displayProps: z.strictObject({}),
  sourceData: CountdownSourceDataSchema,
});

export const TodoItemSchema = z.strictObject({
  id: z.string().min(1).max(128),
  text: z.string().min(1).max(160),
  done: z.boolean(),
});

export const TodoCardSchema = z.strictObject({
  ...CommonShape,
  type: z.literal("TodoCard"),
  displayProps: z.strictObject({
    items: z.array(TodoItemSchema).min(1).max(12),
  }),
  sourceData: OpenSourceData,
});

export const WeatherCardSchema = z.strictObject({
  ...CommonShape,
  type: z.literal("WeatherCard"),
  displayProps: z.strictObject({
    tempC: z.number().min(-100).max(65),
    conditionIcon: z.enum([
      "sun",
      "cloud",
      "rain",
      "snow",
      "wind",
      "fog",
      "storm",
      "night",
    ]),
  }),
  sourceData: OpenSourceData,
});

export const NoteCardSchema = z.strictObject({
  ...CommonShape,
  type: z.literal("NoteCard"),
  displayProps: z
    .strictObject({
      text: z.string().max(500).optional(),
      bullets: z.array(z.string().max(180)).max(5).optional(),
    })
    .refine((v) => v.text !== undefined || v.bullets !== undefined, {
      message: "NoteCard needs text or bullets",
    }),
  sourceData: OpenSourceData,
});

export const SearchResultCardSchema = z.strictObject({
  ...CommonShape,
  type: z.literal("SearchResultCard"),
  displayProps: z.strictObject({
    title: z.string().min(1).max(140),
    summary: z.string().max(240),
    sourceLabel: z.string().max(70),
  }),
  sourceData: OpenSourceData,
  sources: z.array(EvidenceRefSchema).min(1).max(15),
});

export const TableCardSchema = z.strictObject({
  ...CommonShape,
  type: z.literal("TableCard"),
  displayProps: z.strictObject({
    columns: z.array(z.string().max(80)).min(1).max(8),
    rows: z
      .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).min(1).max(8))
      .max(100),
  }),
  sourceData: OpenSourceData,
});

export const ChartPointSchema = z.strictObject({
  x: z.union([z.string(), z.number()]),
  y: z.number(),
});

export const ChartCardSchema = z.strictObject({
  ...CommonShape,
  type: z.literal("ChartCard"),
  displayProps: z.strictObject({
    chartKind: z.enum(["line", "bar", "pie"]),
    points: z.array(ChartPointSchema).min(1).max(100),
    xLabel: z.string().max(60).optional(),
    yLabel: z.string().max(60).optional(),
  }),
  sourceData: OpenSourceData,
});

export const CardRecordSchema = z.discriminatedUnion("type", [
  CountdownCardSchema,
  TodoCardSchema,
  WeatherCardSchema,
  NoteCardSchema,
  SearchResultCardSchema,
  TableCardSchema,
  ChartCardSchema,
]);

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type CardVariant = z.infer<typeof CardVariantSchema>;
export type TodoItem = z.infer<typeof TodoItemSchema>;
export type CountdownCard = z.infer<typeof CountdownCardSchema>;
export type TodoCard = z.infer<typeof TodoCardSchema>;
export type SearchResultCard = z.infer<typeof SearchResultCardSchema>;
export type CardRecord = z.infer<typeof CardRecordSchema>;
