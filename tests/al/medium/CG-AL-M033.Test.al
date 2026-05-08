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
        ExcelStr: Text;
        HtmlStr: Text;
        PdfStr: Text;
        WordStr: Text;
        XmlStr: Text;
    begin
        ExcelStr := Format(ReportFormat::Excel);
        HtmlStr := Format(ReportFormat::Html);
        PdfStr := Format(ReportFormat::Pdf);
        WordStr := Format(ReportFormat::Word);
        XmlStr := Format(ReportFormat::Xml);

        Assert.AreNotEqual(ExcelStr, HtmlStr, 'Excel and Html should be distinct ReportFormat values');
        Assert.AreNotEqual(HtmlStr, PdfStr, 'Html and Pdf should be distinct ReportFormat values');
        Assert.AreNotEqual(PdfStr, WordStr, 'Pdf and Word should be distinct ReportFormat values');
        Assert.AreNotEqual(WordStr, XmlStr, 'Word and Xml should be distinct ReportFormat values');
        Assert.AreNotEqual(ExcelStr, XmlStr, 'Excel and Xml should be distinct ReportFormat values');
    end;
}
