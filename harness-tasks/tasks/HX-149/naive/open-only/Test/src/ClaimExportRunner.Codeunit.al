codeunit 80561 "CGR Claim Export Runner"
{
    var
        SentCount: Integer;

    trigger OnRun()
    var
        ClaimExport: Codeunit "CGR Claim Export";
    begin
        SentCount := ClaimExport.ExportOpenDamages();
    end;

    procedure ExportedDamageCount(): Integer
    begin
        exit(SentCount);
    end;
}
