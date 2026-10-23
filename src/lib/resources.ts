import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { ApiError } from "./auth";

/**
 * === Port of backend/config/platform.php ===
 * Drives the generic REST CRUD: /api/v1/{resource} and /api/v1/{resource}/{id}.
 * Each entry defines validation rules, searchable columns, sort, includes and
 * filters — mirroring the Laravel admin API resource registry.
 */

type ResourceName =
  | "grades" | "subjects" | "chapters" | "topics" | "notes"
  | "questions" | "exams" | "announcements";

const gradeCreate = z.object({
  name: z.string().trim().min(1).max(100),
  level: z.coerce.number().int().min(1).max(100),
  description: z.string().max(1000).nullish(),
  is_active: z.boolean().optional(),
});

const subjectCreate = z.object({
  grade_id: z.coerce.number().int(),
  name: z.string().max(100),
  language: z.enum(["en", "am"]).optional(),
  description: z.string().max(1000).nullish(),
  order: z.coerce.number().int().min(0).nullish(),
  is_active: z.boolean().optional(),
  stream: z.enum(["natural", "social"]).nullish(),
});

const chapterCreate = z.object({
  subject_id: z.coerce.number().int(),
  title: z.string().max(200),
  description: z.string().max(2000).nullish(),
  order: z.coerce.number().int().min(0).nullish(),
  is_active: z.boolean().optional(),
  requires_activation: z.boolean().optional(),
  telegraph_url: z.string().url().max(2000).nullish(),
  pdf_file: z.string().max(1000).nullish(),
  stream: z.enum(["natural", "social"]).nullish(),
});

const topicCreate = z.object({
  chapter_id: z.coerce.number().int(),
  title: z.string().max(200),
  description: z.string().max(2000).nullish(),
  order: z.coerce.number().int().min(0).nullish(),
});

const noteCreate = z.object({
  grade_id: z.coerce.number().int(),
  subject_id: z.coerce.number().int(),
  chapter_id: z.coerce.number().int(),
  topic_id: z.coerce.number().int().nullish(),
  title: z.string().max(200),
  content: z.string(),
  order: z.coerce.number().int().min(0).nullish(),
});

const optionSchema = z.object({
  label: z.string().max(4),
  text: z.string(),
  is_correct: z.boolean(),
});

const questionCreate = z.object({
  grade_id: z.coerce.number().int(),
  subject_id: z.coerce.number().int(),
  chapter_id: z.coerce.number().int().nullish(),
  topic_id: z.coerce.number().int().nullish(),
  question_text: z.string(),
  question_type: z.enum(["multiple_choice", "true_false"]),
  difficulty: z.enum(["easy", "medium", "hard"]),
  explanation: z.string().nullish(),
  source: z.string().max(200).nullish(),
  year: z.coerce.number().int().min(1900).max(2100).nullish(),
  is_active: z.boolean().optional(),
  options: z.array(optionSchema).min(2),
});

const examCreate = z.object({
  title: z.string().max(200),
  type: z.enum(["chapter_test", "mock"]),
  grade_id: z.coerce.number().int(),
  subject_id: z.coerce.number().int(),
  chapter_id: z.coerce.number().int().nullish(),
  question_count: z.coerce.number().int().min(1).max(200),
  time_limit_minutes: z.coerce.number().int().min(1).max(600),
  pass_mark: z.coerce.number().int().min(0).max(100),
  distribution: z.record(z.string(), z.any()).nullish(),
  is_active: z.boolean().optional(),
  question_ids: z.array(z.coerce.number().int()).nullish(),
});

const announcementCreate = z.object({
  title: z.string().max(200),
  body: z.string(),
  audience: z.enum(["all", "grade", "activated"]),
  grade_id: z.coerce.number().int().nullish(),
  is_published: z.boolean().optional(),
  published_at: z.string().datetime().nullish(),
});

type ResourceConfig = {
  /** Prisma model delegate on the prisma client. */
  delegate: (prisma: PrismaClient) => GenericDelegate;
  search: string[];
  sort: string; // leading '-' = descending
  include?: Record<string, unknown>;
  withCount?: string[];
  filters: string[];
  /** Where to install nested filters: filter name -> nested prisma filter path. */
  nestedFilters?: Record<string, Record<string, unknown>>;
  create: z.ZodTypeAny;
  partial: z.ZodTypeAny;
  /** Composite unique tuples (validated before create/update). */
  uniqueTuples?: string[][];
};

export type GenericDelegate = {
  findMany: (args?: Record<string, unknown>) => Promise<unknown[]>;
  findFirst: (args?: Record<string, unknown>) => Promise<unknown>;
  findUnique: (args: { where: { id: number }; include?: unknown }) => Promise<unknown>;
  update: (args: { where: { id: number }; data: unknown; include?: unknown }) => Promise<unknown>;
  delete: (args: { where: { id: number } }) => Promise<unknown>;
  count: (args?: unknown) => Promise<number>;
  create: (args: { data: unknown; include?: unknown }) => Promise<unknown>;
};

export const RESOURCES: Record<string, ResourceConfig> = {
  grades: {
    delegate: (p) => p.grade as never,
    search: ["name"],
    sort: "level",
    filters: [],
    create: gradeCreate,
    partial: gradeCreate.partial(),
  },
  subjects: {
    delegate: (p) => p.subject as never,
    search: ["name"],
    sort: "order",
    include: { grade: true, chapters: { select: { id: true, title: true, order: true } } },
    filters: ["grade_id"],
    uniqueTuples: [["grade_id", "name"]],
    create: subjectCreate,
    partial: subjectCreate.partial(),
  },
  chapters: {
    delegate: (p) => p.chapter as never,
    search: ["title"],
    sort: "order",
    include: { subject: { include: { grade: true } }, _count: { select: { notes: true } } },
    filters: ["grade_id", "subject_id"],
    nestedFilters: { grade_id: { subject: { gradeId: undefined } } },
    create: chapterCreate,
    partial: chapterCreate.partial(),
  },
  topics: {
    delegate: (p) => p.topic as never,
    search: ["title"],
    sort: "order",
    include: { chapter: { include: { subject: true } } },
    filters: ["grade_id", "subject_id", "chapter_id"],
    nestedFilters: {
      grade_id: { chapter: { subject: { gradeId: undefined } } },
      subject_id: { chapter: { subjectId: undefined } },
    },
    create: topicCreate,
    partial: topicCreate.partial(),
  },
  notes: {
    delegate: (p) => p.note as never,
    search: ["title"],
    sort: "order",
    include: { grade: true, subject: true, chapter: true, topic: true },
    filters: ["grade_id", "subject_id", "chapter_id", "topic_id"],
    create: noteCreate,
    partial: noteCreate.partial(),
  },
  questions: {
    delegate: (p) => p.question as never,
    search: ["question_text"],
    sort: "-id",
    include: { grade: true, subject: true, chapter: true, topic: true, options: { orderBy: { label: "asc" } } },
    filters: ["grade_id", "subject_id", "chapter_id", "topic_id", "difficulty", "question_type", "source", "year"],
    create: questionCreate,
    partial: questionCreate.partial(),
  },
  exams: {
    delegate: (p) => p.exam as never,
    search: ["title"],
    sort: "-id",
    include: { grade: true, subject: true, chapter: true, pins: { include: { question: true }, orderBy: { position: "asc" } } },
    filters: ["grade_id", "subject_id", "type"],
    create: examCreate,
    partial: examCreate.partial(),
  },
  announcements: {
    delegate: (p) => p.announcement as never,
    search: ["title"],
    sort: "-id",
    include: { grade: true },
    filters: ["audience", "is_published"],
    create: announcementCreate,
    partial: announcementCreate.partial(),
  },
};

export type { ResourceName };

/** Build a Prisma where clause for list requests (filters + search). */
export function listWhere(
  resource: string,
  cfg: ResourceConfig,
  params: URLSearchParams,
): Prisma.GradeWhereInput {
  const where: Record<string, unknown> = {};

  for (const filter of cfg.filters) {
    const raw = params.get(filter);
    if (raw === null || raw === "") continue;
    const nested = cfg.nestedFilters?.[filter];
    if (nested) {
      // e.g. grade_id on chapters -> subject: { gradeId }
      const key = Object.keys(nested)[0];
      const innerKey = Object.keys(nested[key] as Record<string, unknown>)[0];
      where[key] = { [innerKey]: Number(raw) };
    } else if (filter === "is_published") {
      where.isPublished = raw === "1" || raw === "true";
    } else if (filter === "source" && resource === "questions") {
      where.source = { contains: raw };
    } else {
      where[camel(filter)] = raw === "true" || raw === "false" ? raw === "true" : coerceId(filter, raw);
    }
  }

  const search = params.get("search");
  if (search && cfg.search.length > 0) {
    where.OR = cfg.search.map((column) => ({
      [camel(column)]: { contains: search },
    }));
  }

  return where as Prisma.GradeWhereInput;
}

export function orderBy(cfg: ResourceConfig): Prisma.GradeOrderByWithRelationInput {
  const descending = cfg.sort.startsWith("-");
  const field = camel(descending ? cfg.sort.slice(1) : cfg.sort);
  return { [field]: descending ? "desc" : "asc" } as Prisma.GradeOrderByWithRelationInput;
}

function camel(field: string): string {
  return field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function coerceId(filter: string, raw: string): string | number {
  return filter.endsWith("_id") || filter === "year" ? Number(raw) : raw;
}

/** Coerce create/update payload to Prisma data shape. */
export function toPrismaData(resource: string, input: Record<string, unknown>, forUpdate: boolean, existingUpdatedAt?: Date): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "question_ids") continue; // handled after save (exam pins)
    if (key === "options" && resource === "questions") continue;
    if (key === "distribution") {
      data.distribution = value == null ? null : JSON.stringify(value);
      continue;
    }
    data[camel(key)] = value;
  }

  if (resource === "subjects" && data.language == null && !forUpdate) data.language = "en";

  // 'order' columns are NOT NULL default 0: coerce explicit nulls.
  if (data.order === null) data.order = 0;

  if (resource === "questions" && data.year === 0) data.year = null;

  if (resource === "announcements") {
    const published = data.isPublished ?? false;
    if (published && !forUpdate && !data.publishedAt) data.publishedAt = new Date();
  }

  return data;
}

/** Post-save nested writes (questions.options, exams.pins, announcements.sync). */
export async function afterSave(prisma: import("@prisma/client").PrismaClient, resource: string, id: number, saved: Record<string, unknown>, input: Record<string, unknown>): Promise<unknown> {
  if (resource === "questions" && Array.isArray(input.options)) {
    const correct = input.options.filter((o: { is_correct: boolean }) => o.is_correct);
    if (correct.length !== 1) {
      throw new ApiError(422, "Exactly one option must be correct.");
    }
    await prisma.questionOption.deleteMany({ where: { questionId: id } });
    await prisma.questionOption.createMany({
      data: input.options.map((o: { label: string; text: string; is_correct: boolean }) => ({
        questionId: id,
        label: o.label,
        text: o.text,
        isCorrect: Boolean(o.is_correct),
      })),
    });
  }

  if (resource === "exams" && Array.isArray(input.question_ids)) {
    const ids = Array.from(new Set(input.question_ids.map(Number)));
    await prisma.examQuestion.deleteMany({ where: { examId: id } });
    if (ids.length) {
      await prisma.examQuestion.createMany({
        data: ids.map((questionId, position) => ({ examId: id, questionId, position })),
      });
    }
  }

  if (resource === "announcements" && input.is_published === true && !saved.publishedAt) {
    await prisma.announcement.update({
      where: { id },
      data: { publishedAt: new Date() },
    });
  }

  return prisma;
}

/**
 * Composite unique tuples: reject create/update that would violate them.
 * Prisma throws a P2002 on the constraint, but the Laravel port reports it as
 * a 422 validation error keyed on the first tuple field instead.
 */
export async function validateUniqueTuples(
  prisma: PrismaClient,
  cfg: ResourceConfig,
  input: Record<string, unknown>,
  ignoreId: number | null,
): Promise<void> {
  for (const tuple of cfg.uniqueTuples ?? []) {
    if (tuple.some((field) => input[field] == null)) continue;

    const composite: Record<string, number | string> = {};
    for (const field of tuple) {
      composite[camel(field)] = input[field] as number | string;
    }

    const existing = (await cfg.delegate(prisma).findFirst({
      where: composite,
    })) as { id: number } | null;

    if (existing && existing.id !== ignoreId) {
      throw new ApiError(
        422,
        `This combination (${tuple.join(" + ")}) already exists.`,
        { [camel(tuple[0])]: [`The ${tuple.join(" + ")} combination is already taken.`] },
      );
    }
  }
}
