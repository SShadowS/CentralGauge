codeunit 80556 "CGR Desk Spy Data Runner"
{
    var
        SpyDataContractNo: Code[20];

    trigger OnRun()
    var
        DeskPosting: Codeunit "CGR Desk Posting";
    begin
        DeskPosting.PostAtDesk(SpyDataContractNo);
    end;

    procedure SetSpyDataContract(ContractNo: Code[20])
    begin
        SpyDataContractNo := ContractNo;
    end;
}
