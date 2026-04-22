/**
 * GET /api/github/access — Check VCS access status.
 * Routes through VCS abstraction layer (GitHub or GitLab based on PLATFORM env).
 */

import { NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { getVCSProvider } from "@/core/vcs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const boardId = searchParams.get("boardId")?.trim();
  const board = boardId
    ? await getRoutaSystem().kanbanBoardStore.get(boardId)
    : undefined;
  const provider = getVCSProvider();
  const status = provider.getAccessStatus({ boardToken: board?.githubToken });
  return NextResponse.json(status);
}
