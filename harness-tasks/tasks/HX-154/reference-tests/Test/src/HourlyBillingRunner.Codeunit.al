codeunit 80611 "CGR Hourly Billing Runner"
{
    var
        RunContractNo: Code[20];
        BilledInRun: Boolean;

    trigger OnRun()
    var
        HourlyBilling: Codeunit "CGR Hourly Billing";
    begin
        BilledInRun := HourlyBilling.BillHourly(RunContractNo);
    end;

    procedure SetHourlyContract(ContractNo: Code[20])
    begin
        RunContractNo := ContractNo;
        BilledInRun := false;
    end;

    procedure HourlyBillResult(): Boolean
    begin
        exit(BilledInRun);
    end;
}
