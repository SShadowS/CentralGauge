codeunit 86561 "HX055 Keep Runner"
{
    var
        ContractNo: Code[20];

    procedure SetContract(NewContractNo: Code[20])
    begin
        ContractNo := NewContractNo;
    end;

    trigger OnRun()
    var
        Preview: Codeunit "CGR Rental Invoice Preview";
    begin
        Preview.KeepPreview(ContractNo);
    end;
}
