report 70033 "CG Report Render Demo"
{
    Caption = 'CG Report Render Demo';
    UsageCategory = None;
    ApplicationArea = All;

    dataset
    {
        dataitem(Customer; Customer)
        {
        }
    }

    trigger OnPreRendering(var RenderingPayload: JsonObject)
    var
        Fmt: ReportFormat;
        FmtText: Text;
    begin
        Fmt := CurrReport.TargetFormat();

        case Fmt of
            ReportFormat::Excel:
                FmtText := 'excel';
            ReportFormat::Html:
                FmtText := 'html';
            ReportFormat::Pdf:
                FmtText := 'pdf';
            ReportFormat::Word:
                FmtText := 'word';
            ReportFormat::Xml:
                FmtText := 'xml';
        end;

        RenderingPayload.Add('targetFormat', FmtText);
    end;
}