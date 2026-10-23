codeunit 80126 "CGR Rate Change Test Runner"
{
    var
        RunContractNo: Code[20];
        RunNewBaseRate: Decimal;
        RunRepricedLines: Integer;

    trigger OnRun()
    var
        RateChange: Codeunit "CGR Lease Rate Change";
    begin
        RunRepricedLines := RateChange.ChangeBaseRate(RunContractNo, RunNewBaseRate);
    end;

    procedure SetRateChange(ContractNo: Code[20]; NewBaseRate: Decimal)
    begin
        RunContractNo := ContractNo;
        RunNewBaseRate := NewBaseRate;
        RunRepricedLines := 0;
    end;

    procedure RepricedLineCount(): Integer
    begin
        exit(RunRepricedLines);
    end;
}
