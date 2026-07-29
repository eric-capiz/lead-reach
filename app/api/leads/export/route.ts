import { NextResponse } from "next/server";
import { LeadModel } from "@/server/db/models";
import { requireCurrentUserId } from "@/server/auth/session";
import { connectDB } from "@/server/db/connect";

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cell(value: unknown): string {
  return `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
}

/**
 * Excel-friendly export (SpreadsheetML .xls). Opens in Excel / Google Sheets with
 * sized columns for business name, address, Instagram, and Facebook.
 */
export async function GET() {
  try {
    await connectDB();
    const userId = await requireCurrentUserId();

    const leads = await LeadModel.find({ userId, isSample: { $ne: true } })
      .sort({ updatedAt: -1 })
      .select("businessName location instagram facebook")
      .lean();

    const header = [
      cell("Business Name"),
      cell("Address"),
      cell("Instagram"),
      cell("Facebook"),
    ].join("");

    const rows = leads
      .map(
        (l) =>
          `<Row>${[
            cell(l.businessName),
            cell(l.location),
            cell(l.instagram),
            cell(l.facebook),
          ].join("")}</Row>`,
      )
      .join("\n");

    // Column widths are in Excel character units so names/addresses/URLs are readable.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#F3E9C8" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Leads">
  <Table>
   <Column ss:AutoFitWidth="0" ss:Width="200"/>
   <Column ss:AutoFitWidth="0" ss:Width="320"/>
   <Column ss:AutoFitWidth="0" ss:Width="260"/>
   <Column ss:AutoFitWidth="0" ss:Width="260"/>
   <Row ss:StyleID="Header">${header}</Row>
   ${rows}
  </Table>
 </Worksheet>
</Workbook>`;

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": `attachment; filename="leads-${stamp}.xls"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
