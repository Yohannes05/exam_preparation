import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma as db } from "@/lib/db";
import { ApiError, errorResponse, requireAdmin } from "@/lib/auth";
import { getPage, paginateResponse, zodErrors } from "@/lib/paginate";
import { jsonify } from "@/lib/serialize";
export const dynamic = "force-dynamic";

import {
  RESOURCES,
  afterSave,
  listWhere,
  orderBy,
  toPrismaData,
  validateUniqueTuples,
} from "@/lib/resources";

/** GET /api/v1/{resource} — paginated list with filters and search. */
export async function GET(
  request: NextRequest,
  { params }: { params: { resource: string } },
) {
  try {
    await requireAdmin();
    const resource = params.resource;
    const cfg = RESOURCES[resource];
    if (!cfg) throw new ApiError(404, `Unknown resource [${resource}].`);

    const page = getPage(request);
    const url = new URL(request.url);
    const where = listWhere(resource, cfg, url.searchParams);

    const delegate = cfg.delegate(db);
    const [rows, total] = await Promise.all([
      delegate.findMany({
        where,
        orderBy: orderBy(cfg),
        include: cfg.include,
        skip: page.skip,
        take: page.take,
      }),
      delegate.count({ where }),
    ]);

    return NextResponse.json(paginateResponse(request, jsonify(rows), total));
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/v1/{resource} */
export async function POST(
  request: NextRequest,
  { params }: { params: { resource: string } },
) {
  try {
    await requireAdmin();
    const resource = params.resource;
    const cfg = RESOURCES[resource];
    if (!cfg) throw new ApiError(404, `Unknown resource [${resource}].`);

    const body = (await request.json()) as unknown;
    const parsed = cfg.create.safeParse(body);
    if (!parsed.success) throw zodErrors(parsed.error);
    const input = parsed.data as Record<string, unknown>;

    // Composite unique tuples (e.g. subject grade_id+name).
    await validateUniqueTuples(db, cfg, input, null);

    const data = toPrismaData(resource, input, false);
    const created = (await cfg.delegate(db).create({
      data,
      include: cfg.include,
    })) as Record<string, unknown>;
    await afterSave(db, resource, created.id as number, created, input);

    return NextResponse.json(jsonify(created), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
