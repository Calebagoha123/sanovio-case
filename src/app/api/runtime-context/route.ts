import { getCurrentHospitalDate, getHospitalTimezone } from "@/lib/dates/resolve-requested-by-date";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest): Promise<Response> {
  const timezone = req.nextUrl.searchParams.get("timezone") ?? undefined;
  return Response.json({
    currentDate: getCurrentHospitalDate(timezone),
    timezone: getHospitalTimezone(timezone),
  });
}
