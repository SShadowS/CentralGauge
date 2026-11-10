codeunit 80614 "CGR Hourly Minute Runner"
{
    var
        MinuteContractNo: Code[20];
        MinuteResult: Boolean;

    trigger OnRun()
    var
        HourlyBilling: Codeunit "CGR Hourly Billing";
    begin
        MinuteResult := HourlyBilling.BillHourly(MinuteContractNo);
    end;

    procedure SetMinuteContract(ContractNo: Code[20])
    begin
        MinuteContractNo := ContractNo;
        MinuteResult := false;
    end;

    procedure GetMinuteResult(): Boolean
    begin
        exit(MinuteResult);
    end;
}
