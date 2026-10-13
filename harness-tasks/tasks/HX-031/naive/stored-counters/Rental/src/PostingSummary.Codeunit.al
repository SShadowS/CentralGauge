codeunit 70217 "CGR Posting Summary"
{
    procedure PostedCount(): Integer
    var
        Figures: Record "CGR Posting Figures";
    begin
        if Figures.Get() then
            exit(Figures."Posted Count");
    end;

    procedure PostedAmount(): Decimal
    var
        Figures: Record "CGR Posting Figures";
    begin
        if Figures.Get() then
            exit(Figures."Posted Amount");
    end;

    procedure FailedCount(): Integer
    var
        Figures: Record "CGR Posting Figures";
    begin
        if Figures.Get() then
            exit(Figures."Attempted Count" - Figures."Posted Count");
    end;

    procedure ResetSummary()
    var
        Figures: Record "CGR Posting Figures";
    begin
        Figures.DeleteAll();
    end;

    internal procedure CountAttempt()
    var
        Figures: Record "CGR Posting Figures";
    begin
        GetFigures(Figures);
        Figures."Attempted Count" += 1;
        Figures.Modify();
    end;

    internal procedure CountPosted(ContractNo: Code[20])
    var
        Figures: Record "CGR Posting Figures";
        Entry: Record "CGR Rental Ledger Entry";
    begin
        GetFigures(Figures);
        Figures."Posted Count" += 1;
        Entry.SetRange("Contract No.", ContractNo);
        if Entry.FindLast() then
            Figures."Posted Amount" += Entry.Amount;
        Figures.Modify();
    end;

    local procedure GetFigures(var Figures: Record "CGR Posting Figures")
    begin
        if not Figures.Get() then begin
            Figures.Init();
            Figures.Insert();
        end;
    end;
}
