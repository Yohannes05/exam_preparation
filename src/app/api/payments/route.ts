import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";
import { getPage, paginateResponse } from "@/lib/paginate";
import { jsonify } from "@/lib/serialize";

/** GET /api/payments — receipt list with status filter. */
export async function GET(request: Request) {
  try {
    await requireAdmin();

    const url = new URL(request.url);
    const page = getPage(request);
    const status = url.searchParams.get("status");
    const validStatuses = ["pending", "approved", "rejected"];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { message: "The given data was invalid.", errors: { status: ["Invalid status."] } },
        { status: 422 },
      );
    }

    const where = status ? { status } : {};
    const [rows, total] = await Promise.all([
      prisma.telegramPayment.findMany({
        where,
        include: { student: { include: { grade: true } } },
        orderBy: { id: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      prisma.telegramPayment.count({ where }),
    ]);

    // Hide receipt_file_id from the admin UI (Laravel: makeHidden).
    const data = jsonify(rows).map(
      (payment: Record<string, unknown> & { receipt_file_id?: unknown }) => {
        const { receipt_file_id: _hidden, ...rest } = payment;
        return rest;
      },
    );

    return NextResponse.json(paginateResponse(request, data, total));
  } catch (error) {
    return errorResponse(error);
  }
}
