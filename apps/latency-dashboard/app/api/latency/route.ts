import { NextResponse } from "next/server";
import { latencyDataset } from "../../lib/latency-data";

export const revalidate = 60;

export const GET = async () => {
  return NextResponse.json({
    endpoints: latencyDataset,
    generatedAt: new Date().toISOString(),
  });
};
