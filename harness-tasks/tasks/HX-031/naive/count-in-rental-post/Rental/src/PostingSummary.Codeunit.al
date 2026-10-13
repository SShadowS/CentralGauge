codeunit 70217 "CGR Posting Summary"
{
    SingleInstance = true;

    var
        Attempted: Integer;
        Posted: Integer;
        Amount: Decimal;

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
        exit(Attempted - Posted);
    end;

    procedure ResetSummary()
    begin
        ClearAll();
    end;

    internal procedure CountAttempt()
    begin
        Attempted += 1;
    end;

    internal procedure CountPosted(PostedAmount: Decimal)
    begin
        Posted += 1;
        Amount += PostedAmount;
    end;
}
