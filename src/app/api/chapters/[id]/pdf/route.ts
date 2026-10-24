import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, errorResponse, requireAdmin } from "@/lib/auth";
import { upload, deleteFile, url } from "@/lib/storage";
import { isUploadedFile } from "@/lib/uploaded-file";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

/** POST /api/chapters/{id}/pdf — upload a chapter PDF (max 20 MB). */
export async function POST(request: Request, { params }: Params) {
  try {
    await requireAdmin();

    const chapterId = Number(params.id);
    const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) throw new ApiError(404, "Not found.");

    const form = await request.formData();
    const pdf = form.get("pdf");
    if (!isUploadedFile(pdf)) {
      throw new ApiError(422, "The pdf field is required.");
    }
    if (pdf.type !== "application/pdf" && !pdf.name.toLowerCase().endsWith(".pdf")) {
      throw new ApiError(422, "The pdf must be a file of type: pdf.");
    }
    if (pdf.size > 20 * 1024 * 1024) {
      throw new ApiError(422, "The pdf may not be greater than 20 MB.");
    }

    const storedPath = await upload(
      { bytes: await pdf.arrayBuffer(), name: pdf.name || "chapter.pdf", contentType: "application/pdf" },
      "chapter-pdfs",
    );

    const oldPath = chapter.pdfFile;
    await prisma.chapter.update({ where: { id: chapterId }, data: { pdfFile: storedPath } });
    if (oldPath) await deleteFile(oldPath);

    return NextResponse.json({ pdf_file: storedPath, url: url(storedPath) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/chapters/{id}/pdf — remove the chapter PDF. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    await requireAdmin();

    const chapterId = Number(params.id);
    const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) throw new ApiError(404, "Not found.");

    await deleteFile(chapter.pdfFile);
    await prisma.chapter.update({ where: { id: chapterId }, data: { pdfFile: null } });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
