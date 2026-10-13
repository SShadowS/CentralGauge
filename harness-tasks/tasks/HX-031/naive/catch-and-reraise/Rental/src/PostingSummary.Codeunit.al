codeunit 70217 "CGR Posting Summary"
{
    SingleInstance = true;

    var
        Posted: Integer;
        Amount: Decimal;
        Failed: Integer;

    procedure PostedCount(): Integer
    begin
        exit(Posted);
    end;

    procedure PostedAmount(): Decimal
    begin
        exit(Amount);
    end;

    procedure FailedCount(): Integer
    begin
        exit(Failed);
    end;

    procedure ResetSummary()
    begin
        ClearAll();
    end;

    internal procedure CountFailed()
    begin
        Failed += 1;
    end;

    internal procedure CountPosted(ContractNo: Code[20])
    var
        Entry: Record "CGR Rental Ledger Entry";
    begin
        Posted += 1;
        Entry.SetRange("Contract No.", ContractNo);
        if Entry.FindLast() then
            Amount += Entry.Amount;
    end;
}
