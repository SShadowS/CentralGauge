codeunit 80501 "CGR Overdue Fee Run Runner"
{
    var
        RunAsOf: Date;
        ChargedInRun: Integer;

    trigger OnRun()
    var
        FeeRun: Codeunit "CGR Overdue Fee Run";
    begin
        ChargedInRun := FeeRun.ChargeOverdueFees(RunAsOf);
    end;

    procedure SetRunAsOf(AsOf: Date)
    begin
        RunAsOf := AsOf;
        ChargedInRun := 0;
    end;

    procedure ContractsCharged(): Integer
    begin
        exit(ChargedInRun);
    end;
}
