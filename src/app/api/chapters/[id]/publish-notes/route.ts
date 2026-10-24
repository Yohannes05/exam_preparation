import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, errorResponse, requireAdmin } from "@/lib/auth";
import { publishChapterNotes } from "@/lib/telegraph";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

/** POST /api/chapters/{id}/publish-notes — publish chapter notes to Telegraph. */
export async function POST(_request: Request, { params }: Params) {
  try {
    await requireAdmin();

    const chapterId = Number(params.id);
    const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) throw new ApiError(404, "Not found.");

    // Publishing failures surface as 422 with the reason, like the Laravel port.
    const page = await publishChapterNotes(prisma, chapterId).catch(
      (error: unknown) => {
        throw new ApiError(422, error instanceof Error ? error.message : "Publishing failed.");
      },
    );
    return NextResponse.json(page);
  } catch (error) {
    return errorResponse(error);
  }
}
