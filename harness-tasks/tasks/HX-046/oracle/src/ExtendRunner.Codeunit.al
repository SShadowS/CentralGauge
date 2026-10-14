codeunit 86381 "HX046 Extend Runner"
{
    var
        ContractNo: Code[20];
        ExtraMonths: Integer;

    procedure SetExtension(NewContractNo: Code[20]; NewExtraMonths: Integer)
    begin
        ContractNo := NewContractNo;
        ExtraMonths := NewExtraMonths;
    end;

    trigger OnRun()
    var
        LeaseExtension: Codeunit "CGR Lease Extension";
    begin
        LeaseExtension.ExtendLease(ContractNo, ExtraMonths);
    end;
}
