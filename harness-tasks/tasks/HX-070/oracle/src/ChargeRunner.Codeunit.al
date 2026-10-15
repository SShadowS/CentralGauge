codeunit 86861 "HX070 Charge Runner"
{
    var
        ContractNo: Code[20];

    procedure SetHX070Contract(NewContractNo: Code[20])
    begin
        ContractNo := NewContractNo;
    end;

    trigger OnRun()
    var
        StartCharge: Codeunit "CGR Lease Start Charge";
    begin
        StartCharge.FirstInstallment(ContractNo);
    end;
}
