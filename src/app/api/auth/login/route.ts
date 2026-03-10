import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

interface LoginRequest {
  email: string;
  password: string;
}

// Simple in-memory user store (in production, use a proper database)
const USERS = new Map<string, { id: string; email: string; password: string; name: string }>();

// Initialize with a demo user
USERS.set("demo@example.com", {
  id: "user_1",
  email: "demo@example.com",
  password: "demo123",
  name: "Demo User",
});

export async function POST(request: NextRequest) {
  try {
    const body: LoginRequest = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const user = USERS.get(email);

    if (!user || user.password !== password) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Set session cookie
    const cookieStore = await cookies();
    cookieStore.set("auth_session", JSON.stringify({ userId: user.id, email: user.email }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
