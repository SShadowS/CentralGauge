codeunit 71205 "CG X144 Intake Pipeline"
{
    /// Imports one inbound partner document, stages its order lines for
    /// validation, and logs whatever the validation step finds.
    procedure ProcessDocument(DocumentNo: Code[20]; ExternalRef: Text[100]; Amount: Decimal)
    var
        IntakeLine: Record "CG X144 Intake Line";
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        Matcher: Codeunit "CG X138 Doc Matcher";
        Problems: List of [Text];
        Msg: Text;
        BatchCode: Code[20];
    begin
        Matcher.ImportInboundDoc(DocumentNo, ExternalRef, Amount);

        BatchCode := DocumentNo;

        IntakeLine.SetRange("Document No.", DocumentNo);
        if IntakeLine.FindSet() then
            repeat
                ImportLine.Init();
                ImportLine."Batch Code" := BatchCode;
                ImportLine."Line No." := IntakeLine."Line No.";
                ImportLine."Item No." := IntakeLine."Item No.";
                ImportLine.Quantity := IntakeLine.Quantity;
                ImportLine."Unit Cost" := IntakeLine."Unit Cost";
                ImportLine.Insert();
            until IntakeLine.Next() = 0;

        Checker.CheckBatch(BatchCode, Problems);

        foreach Msg in Problems do
            LogProblem(DocumentNo, Msg);
    end;

    local procedure LogProblem(DocumentNo: Code[20]; Msg: Text)
    var
        IntakeLog: Record "CG X144 Intake Log";
    begin
        IntakeLog.Init();
        IntakeLog."Entry No." := NextLogEntryNo();
        IntakeLog."Document No." := DocumentNo;
        IntakeLog.Message := CopyStr(Msg, 1, MaxStrLen(IntakeLog.Message));
        IntakeLog.Insert();
    end;

    local procedure NextLogEntryNo(): Integer
    var
        IntakeLog: Record "CG X144 Intake Log";
    begin
        if IntakeLog.FindLast() then
            exit(IntakeLog."Entry No." + 1);
        exit(1);
    end;
}
