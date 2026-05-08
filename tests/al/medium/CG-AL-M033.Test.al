codeunit 80033 "CG-AL-M033 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestReportObjectIdResolves()
    begin
        // Compile_pass also validates the OnPreRendering trigger signature
        // (var RenderingPayload: JsonObject) and the CurrReport.TargetFormat()
        // call inside the trigger body. Reaching this assertion proves the
        // report compiled with the expected ID.
        Assert.AreEqual(70033, Report::"CG Report Render Demo", 'Report object ID should be 70033');
    end;

    [Test]
    procedure TestReportFormatEnumHasFiveDocumentedValues()
    var
        ExcelOrd: Integer;
        HtmlOrd: Integer;
        PdfOrd: Integer;
        WordOrd: Integer;
        XmlOrd: Integer;
    begin
        ExcelOrd := ReportFormat::Excel.AsInteger();
        HtmlOrd := ReportFormat::Html.AsInteger();
        PdfOrd := ReportFormat::Pdf.AsInteger();
        WordOrd := ReportFormat::Word.AsInteger();
        XmlOrd := ReportFormat::Xml.AsInteger();

        Assert.AreNotEqual(ExcelOrd, HtmlOrd, 'Excel and Html should be distinct ReportFormat values');
        Assert.AreNotEqual(HtmlOrd, PdfOrd, 'Html and Pdf should be distinct ReportFormat values');
        Assert.AreNotEqual(PdfOrd, WordOrd, 'Pdf and Word should be distinct ReportFormat values');
        Assert.AreNotEqual(WordOrd, XmlOrd, 'Word and Xml should be distinct ReportFormat values');
        Assert.AreNotEqual(ExcelOrd, XmlOrd, 'Excel and Xml should be distinct ReportFormat values');
    end;
}
