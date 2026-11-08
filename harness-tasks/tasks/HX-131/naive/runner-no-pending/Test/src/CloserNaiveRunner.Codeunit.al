codeunit 80179 "CGR Closer Naive Runner"
{
    var
        RunAsOf: Date;
        RunClosed: Integer;

    trigger OnRun()
    var
        ContractCloser: Codeunit "CGR Contract Closer";
    begin
        RunClosed := ContractCloser.CloseExpired(RunAsOf);
    end;

    procedure SetAsOf(AsOf: Date)
    begin
        RunAsOf := AsOf;
    end;

    procedure ClosedInRun(): Integer
    begin
        exit(RunClosed);
    end;
}
