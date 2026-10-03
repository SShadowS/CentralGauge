codeunit 85842 "HX019 Preview Runner"
{
    TableNo = "CGR Rental Contract";

    trigger OnRun()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
    begin
        Preview.BuildPreview(Rec."No.", PreviewLine);
    end;
}
