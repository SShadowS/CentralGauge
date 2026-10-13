codeunit 86082 "HX031 Post Runner"
{
    var
        ContractNo: Code[20];
        ReturnFirst: Boolean;

    procedure PostContract(NewContractNo: Code[20])
    begin
        ContractNo := NewContractNo;
        ReturnFirst := false;
    end;

    procedure ReturnAndPostContract(NewContractNo: Code[20])
    begin
        ContractNo := NewContractNo;
        ReturnFirst := true;
    end;

    trigger OnRun()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        if ReturnFirst then
            RentalMgt.Return(ContractNo, 1100, '');
        RentalMgt.Post(ContractNo);
    end;
}
