import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

// In-memory user store (same as login route)
const USERS = new Map<string, { id: string; email: string; password: string; name: string }>();

USERS.set("demo@example.com", {
  id: "user_1",
  email: "demo@example.com",
  password: "demo123",
  name: "Demo User",
});

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("auth_session");

  if (!sessionCookie?.value) {
    return NextResponse.json({ user: null });
  }

  try {
    const session = JSON.parse(sessionCookie.value);
    const user = Array.from(USERS.values()).find((u) => u.id === session.userId);

    if (!user) {
      return NextResponse.json({ user: null });
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch {
    return NextResponse.json({ user: null });
  }
}
