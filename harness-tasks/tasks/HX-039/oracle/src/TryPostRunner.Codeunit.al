codeunit 86242 "HX039 Try Post Runner"
{
    var
        RunContractNo: Code[20];
        ReturnFirst: Boolean;
        ReturnedFalseErr: Label 'HX039 TryPost returned false: %1', Comment = '%1 = the last error text after TryPost';

    trigger OnRun()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        if ReturnFirst then
            RentalMgt.Return(RunContractNo, 1100, '');
        if not RentalMgt.TryPost(RunContractNo) then
            Error(ReturnedFalseErr, GetLastErrorText());
    end;

    procedure SetContract(ContractNo: Code[20]; ReturnBeforePosting: Boolean)
    begin
        RunContractNo := ContractNo;
        ReturnFirst := ReturnBeforePosting;
    end;
}
