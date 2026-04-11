import { NextResponse } from "next/server";
import { getGitHubAccessStatus } from "@/core/kanban/github-issues";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = getGitHubAccessStatus();
  return NextResponse.json(status);
}
