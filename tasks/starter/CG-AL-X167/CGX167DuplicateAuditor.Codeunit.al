codeunit 71514 "CG X167 Duplicate Auditor"
{
    procedure RunAudit(SourceCode: Code[20]; var AuditResult: Record "CG X167 Audit Result" temporary)
    var
        ImportKey: Record "CG X167 Import Entry";
        ImportEntry: Record "CG X167 Import Entry";
        PostedEntry: Record "CG X167 Posted Entry";
        NewStatus: Enum "CG X167 Audit Status";
        PostedAmount: Decimal;
    begin
        AuditResult.Reset();
        AuditResult.DeleteAll();

        // A first, narrow pass over just the keys of this source's import
        // entries, then the full row is fetched per entry once its amount is
        // actually needed for classification.
        ImportKey.SetRange("Source Code", SourceCode);
        ImportKey.SetLoadFields("Entry No.");
        if ImportKey.FindSet() then
            repeat
                ImportEntry.Get(ImportKey."Entry No.");

                PostedEntry.SetRange("External Ref", ImportEntry."External Ref");
                if PostedEntry.FindFirst() then begin
                    PostedAmount := PostedEntry.Amount;
                    if PostedAmount = ImportEntry.Amount then
                        NewStatus := NewStatus::"Already Posted"
                    else
                        NewStatus := NewStatus::"Amount Differs";
                end else begin
                    PostedAmount := 0;
                    NewStatus := NewStatus::New;
                end;

                if AuditResult.Get(ImportEntry."External Ref") then begin
                    AuditResult.Status := NewStatus;
                    AuditResult."Import Amount" := ImportEntry.Amount;
                    AuditResult."Posted Amount" := PostedAmount;
                    AuditResult.Modify();
                end else begin
                    AuditResult.Init();
                    AuditResult."External Ref" := ImportEntry."External Ref";
                    AuditResult.Status := NewStatus;
                    AuditResult."Import Amount" := ImportEntry.Amount;
                    AuditResult."Posted Amount" := PostedAmount;
                    AuditResult.Insert();
                end;
            until ImportKey.Next() = 0;
    end;
}
