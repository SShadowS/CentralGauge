codeunit 80551 "CGR Desk Lock Runner"
{
    var
        DeskContractNo: Code[20];

    trigger OnRun()
    var
        DeskPosting: Codeunit "CGR Desk Posting";
    begin
        DeskPosting.PostAtDesk(DeskContractNo);
    end;

    procedure SetDeskContract(ContractNo: Code[20])
    begin
        DeskContractNo := ContractNo;
    end;
}
