codeunit 71514 "CG X167 Duplicate Auditor"
{
    procedure RunAudit(SourceCode: Code[20]; var AuditResult: Record "CG X167 Audit Result" temporary)
    var
        ImportEntry: Record "CG X167 Import Entry";
        PostedEntry: Record "CG X167 Posted Entry";
        PostedAmounts: Dictionary of [Code[30], Decimal];
        PostedAmount: Decimal;
        NewStatus: Enum "CG X167 Audit Status";
    begin
        AuditResult.Reset();
        AuditResult.DeleteAll();

        if PostedEntry.FindSet() then
            repeat
                if not PostedAmounts.ContainsKey(PostedEntry."External Ref") then
                    PostedAmounts.Add(PostedEntry."External Ref", PostedEntry.Amount);
            until PostedEntry.Next() = 0;

        ImportEntry.SetRange("Source Code", SourceCode);
        if ImportEntry.FindSet() then
            repeat
                if PostedAmounts.ContainsKey(ImportEntry."External Ref") then begin
                    PostedAmount := PostedAmounts.Get(ImportEntry."External Ref");
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
            until ImportEntry.Next() = 0;
    end;
}
