import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma as db } from "@/lib/db";
import { ApiError, errorResponse, requireAdmin } from "@/lib/auth";
import { zodErrors } from "@/lib/paginate";
import { jsonify } from "@/lib/serialize";
import { RESOURCES, afterSave, toPrismaData, validateUniqueTuples } from "@/lib/resources";

export const dynamic = "force-dynamic";

type Params = { params: { resource: string; id: string } };

function resolve(resource: string) {
  const cfg = RESOURCES[resource];
  if (!cfg) throw new ApiError(404, `Unknown resource [${resource}].`);
  return cfg;
}

async function resourceId({ params }: Params, cfg: ReturnType<typeof resolve>): Promise<number> {
  const id = Number(params.id);
  if (!Number.isInteger(id)) throw new ApiError(404, "Not found.");
  const existing = await cfg.delegate(db).findUnique({ where: { id } });
  if (existing === null) throw new ApiError(404, "Not found.");
  return id;
}

/** GET /api/v1/{resource}/{id} */
export async function GET(_request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const cfg = resolve(params.resource);
    const id = await resourceId({ params }, cfg);

    const row = await cfg.delegate(db).findUnique({
      where: { id },
      include: cfg.include,
    });
    if (row === null) throw new ApiError(404, "Not found.");

    return NextResponse.json(jsonify(row));
  } catch (error) {
    return errorResponse(error);
  }
}

/** PUT /api/v1/{resource}/{id} */
export async function PUT(request: Request, { params }: Params) {
  return update(request, { params });
}

/** PATCH /api/v1/{resource}/{id} */
export async function PATCH(request: Request, { params }: Params) {
  return update(request, { params });
}

async function update(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const cfg = resolve(params.resource);
    const id = await resourceId({ params }, cfg);

    const body = (await request.json()) as unknown;
    const parsed = (cfg.partial as z.ZodTypeAny).safeParse(body);
    if (!parsed.success) {
      throw zodErrors(parsed.error);
    }

    const input = parsed.data as Record<string, unknown>;
    await validateUniqueTuples(db, cfg, input, id);

    const data = toPrismaData(params.resource, input, true);
    const saved = (await cfg.delegate(db).update({
      where: { id },
      data,
      include: cfg.include,
    })) as Record<string, unknown>;
    await afterSave(db, params.resource, id, saved, input);

    return NextResponse.json(jsonify(saved));
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/v1/{resource}/{id} */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const cfg = resolve(params.resource);
    const id = await resourceId({ params }, cfg);

    await cfg.delegate(db).delete({ where: { id } });
    return NextResponse.json({ message: "Deleted." });
  } catch (error) {
    return errorResponse(error);
  }
}
