import { NextResponse } from "next/server";

type HealthResponse = {
  success: true;
  data: {
    service: "ololua-mis";
    status: "ok";
    timestamp: string;
  };
};

export function GET() {
  const body: HealthResponse = {
    success: true,
    data: {
      service: "ololua-mis",
      status: "ok",
      timestamp: new Date().toISOString(),
    },
  };

  return NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
